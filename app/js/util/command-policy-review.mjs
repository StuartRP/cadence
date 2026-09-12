/**
 * command-policy-review.mjs
 *
 * Shared "Command Policy Review" modal. Renders a table of every program that
 * has an allow/block rule in a given policy scope (global or session), with a
 * risk chip, the program name, a status selector, and a remove (bin) button —
 * a direct replica of the per-segment approval card, but listing ALL programs
 * that have a policy (not just the ones in a single command).
 *
 * Row layout: [ risk chip | program | status selector | remove bin ]
 *
 * The status selector options are scope-filtered:
 *   - global scope : Allow always / Block always
 *   - session scope: Allow this session / Allow always / Block this session /
 *                    Block always
 * The "always" options in session scope write to the GLOBAL policy (cross-
 * scope), so the caller supplies getGlobalPolicy / onPersistGlobal for that.
 *
 * An "add program" form lets the user add a program to either list directly.
 *
 * The modal is scope-agnostic. The caller supplies:
 *   - getPolicy(): the live policy object for the displayed scope (canonical or
 *     legacy shape; normalized on read).
 *   - onPersist(): called after a mutation to the displayed scope.
 *   - getGlobalPolicy() / onPersistGlobal(): for cross-scope "always" writes
 *     (session scope only).
 * After every change/remove the table rebuilds to reflect the live policy.
 */

import { Block, Inline } from "../elements/element.mjs";
import { Button } from "../elements/button.mjs";
import { classifyProgram } from "./command-parser.mjs";
import { normalizePolicy, programCoversSegment, subChipsFor } from "./command-rules.mjs";

// Selector options per scope. Each entry: [value, label, target, status] where
// target is "session" or "global" and status is "allow" or "block".
const GLOBAL_OPTIONS = [
    ["allow_always", "Allow always", "global", "allow"],
    ["block_always", "Block always", "global", "block"]
];

const SESSION_OPTIONS = [
    ["allow_session", "Allow this session", "session", "allow"],
    ["allow_always", "Allow always", "global", "allow"],
    ["block_session", "Block this session", "session", "block"],
    ["block_always", "Block always", "global", "block"]
];

/**
 * Collects the distinct program names present in a policy (allow + block),
 * sorted alphabetically. Tolerates program rules ({ program }), legacy
 * full-command rules ({ command } / bare string), and bare strings.
 * @param {object} policy canonical or legacy policy
 * @returns {string[]}
 */
export function programsWithPolicy(policy) {
    const norm = normalizePolicy(policy);
    const set = new Set();
    for (const rule of [...norm.allow, ...norm.block]) {
        if (rule.program) {
            set.add(rule.program);
        } else if (rule.command) {
            // Legacy full-command rule: use its leading word as a best-effort
            // program name so it still appears in the review table.
            const first = String(rule.command).trim().split(/\s+/)[0];
            if (first) set.add(first.toLowerCase());
        }
    }
    return [...set].sort((a, b) => a.localeCompare(b));
}

/**
 * Determines the status for a program within a single-scope policy.
 * "allow" if in allow (and not block), "block" if in block (block wins),
 * else "none".
 * @param {string} program
 * @param {object} policy
 * @returns {"allow"|"block"|"none"}
 */
export function statusFor(program, policy) {
    const norm = normalizePolicy(policy);
    const p = String(program).toLowerCase();
    const inAllow = norm.allow.some(r => r.program === p);
    const inBlock = norm.block.some(r => r.program === p);
    if (inBlock) return "block"; // block wins over allow
    if (inAllow) return "allow";
    return "none";
}

/**
 * Sets a program's status within a policy object, mutating it in place.
 *
 * Subcommand (subs) handling: when `subs` is `undefined`, the program's
 * existing subs (if any) are carried over so switching a rule's status does
 * not silently broaden it (e.g. allow `git status` -> block `git status`
 * keeps the `status` filter). Pass `subs: null` to clear the filter (broad
 * program rule), or `subs: [...]` to set it explicitly.
 * @param {object} policy canonical or legacy policy (mutated)
 * @param {string} program
 * @param {string} status "allow" | "block" | "none"
 * @param {string[]|null|undefined} [subs] subcommand filter
 */
export function setProgramStatus(policy, program, status, subs) {
    const norm = normalizePolicy(policy);
    const p = String(program).trim().toLowerCase();
    // Preserve the program's existing subs when the caller didn't specify.
    let existingSubs = null;
    for (const r of [...norm.allow, ...norm.block]) {
        if (r.program === p && Array.isArray(r.subs) && r.subs.length) { existingSubs = r.subs; break; }
    }
    const subsArr = subs === undefined ? existingSubs : (Array.isArray(subs) ? subs : null);
    norm.allow = norm.allow.filter(r => !(r.program && r.program === p));
    norm.block = norm.block.filter(r => !(r.program && r.program === p));
    if (status === "allow") norm.allow.push(subsArr ? { program: p, subs: subsArr } : { program: p });
    else if (status === "block") norm.block.push(subsArr ? { program: p, subs: subsArr } : { program: p });
    // "none" -> removed from both (no rule).
    policy.allow = norm.allow;
    policy.block = norm.block;
    return policy;
}

/**
 * Edits the subcommand (subs) filter on a program's rule within a policy.
 * Targets the rule matching `status` ("allow"/"block"); if that rule has no
 * subs yet, they are added. An empty `subs` list clears the filter (broad
 * program rule).
 * @param {object} policy canonical or legacy policy (mutated)
 * @param {string} program
 * @param {string} status "allow" | "block"
 * @param {string[]} subs new subcommand list (empty = clear)
 */
export function editSubs(policy, program, status, subs) {
    const norm = normalizePolicy(policy);
    const p = String(program).trim().toLowerCase();
    const list = status === "block" ? norm.block : norm.allow;
    const rule = list.find(r => r.program === p);
    if (!rule) return;
    const cleaned = (Array.isArray(subs) ? subs : [])
        .map(s => String(s).trim().toLowerCase()).filter(Boolean);
    if (cleaned.length) rule.subs = cleaned;
    else delete rule.subs;
    policy.allow = norm.allow;
    policy.block = norm.block;
    return policy;
}

/**
 * Maps a program's current status to the default selector value for a scope.
 * @param {string} status "allow"|"block"|"none"
 * @param {string} scope "global"|"session"
 * @returns {string}
 */
function defaultSelectorValue(status, scope) {
    if (scope === "global") {
        return status === "allow" ? "allow_always" : "block_always";
    }
    // Session scope: prefer the session-scoped option for the current status.
    if (status === "allow") return "allow_session";
    if (status === "block") return "block_session";
    return "allow_session";
}

function buildRow(program, status, scope, policy, onRemove, onEditSubs) {
    const row = new Block();
    row.className = "agent-cmd-program-row cmd-policy-review-row";

    const { category: risk, reason } = classifyProgram(program);
    const chip = new Inline();
    chip.className = `agent-cmd-risk-chip risk-${risk}`;
    chip.textContent = risk.toUpperCase();
    chip.title = reason;

    const name = new Inline();
    name.className = "agent-cmd-program-name";
    name.textContent = program;

    // Auditability: show the subcommand (first-arg) filters carried by the
    // allow and block rules for this program, e.g. allow `git status` and
    // block `git reset`. A program with no subs renders an empty cell so the
    // columns stay aligned.
    const subsCell = new Inline();
    subsCell.className = "agent-cmd-subs-cell";
    const { allowSubs, blockSubs } = subChipsFor(program, policy);
    const addSubChip = (label, subs, kind) => {
        const c = new Inline();
        c.className = `agent-cmd-subs-chip subs-${kind}`;
        c.textContent = `${label}(${subs.join(", ")})`;
        c.title = `Only the subcommands [${subs.join(", ")}] are ${kind === "allow" ? "allowed" : "blocked"}; other invocations of ${program} ${kind === "allow" ? "require approval" : "are not blocked"}.`;
        subsCell.append(c);
    };
    if (allowSubs) addSubChip("allow", allowSubs, "allow");
    if (blockSubs) addSubChip("block", blockSubs, "block");

    // Click the subs cell to edit the subcommand filter (adds one when empty).
    if (typeof onEditSubs === "function") {
        subsCell.classList.add("agent-cmd-subs-editable");
        subsCell.title = "Click to edit the subcommand filter (comma separated)";
        subsCell.addEventListener("click", () => onEditSubs(program, policy));
    }

    const sel = document.createElement("select");
    sel.className = "agent-cmd-policy-select";
    const options = scope === "session" ? SESSION_OPTIONS : GLOBAL_OPTIONS;
    for (const [value, label] of options) {
        const opt = document.createElement("option");
        opt.value = value;
        opt.textContent = label;
        sel.appendChild(opt);
    }
    sel.value = defaultSelectorValue(status, scope);

    const bin = new Button();
    bin.className = "cmd-policy-review-remove";
    bin.icon = "delete";
    bin.title = `Remove policy for ${program}`;
    bin.onclick = () => onRemove(program);

    row.append(chip, name, subsCell, sel, bin);
    return { row, sel };
}

/**
 * Builds the "add program" form: [ program input | status select | add button ].
 * @param {string} scope "global"|"session"
 * @param {() => object} getPolicy
 * @param {() => void} onPersist
 * @param {() => object} getGlobalRef
 * @param {() => void} globalPersistRef
 * @param {() => void} onAdded
 * @returns {Block}
 */
function buildAddForm(scope, getPolicy, onPersist, getGlobalRef, globalPersistRef, onAdded) {
    const form = new Block();
    form.className = "cmd-policy-review-add";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "cmd-policy-review-add-input";
    input.placeholder = "program (e.g. rm, git, curl)";
    input.spellcheck = false;

    // Optional subcommand (first-arg) filter. Comma/space separated, e.g.
    // "status, log" -> only `git status` / `git log` are matched. Empty = the
    // whole program.
    const subsInput = document.createElement("input");
    subsInput.type = "text";
    subsInput.className = "cmd-policy-review-add-input cmd-policy-review-add-subs";
    subsInput.placeholder = "subcommands (optional, e.g. status, log)";
    subsInput.spellcheck = false;

    const sel = document.createElement("select");
    sel.className = "agent-cmd-policy-select cmd-policy-review-add-sel";
    const options = scope === "session" ? SESSION_OPTIONS : GLOBAL_OPTIONS;
    for (const [value, label] of options) {
        const opt = document.createElement("option");
        opt.value = value;
        opt.textContent = label;
        sel.appendChild(opt);
    }
    sel.value = "allow_always";

    const add = new Button("Add");
    add.className = "cmd-policy-review-add-btn";
    add.classList.add("themed");

    const parseSubs = (text) =>
        text.split(/[,\s]+/).map(s => s.trim().toLowerCase()).filter(Boolean);

    const doAdd = () => {
        const prog = input.value.trim().toLowerCase();
        if (!prog) return;
        const subs = parseSubs(subsInput.value);
        const opt = options.find(o => o[0] === sel.value) || options[0];
        const [, , target, status] = opt;
        // Pass subs explicitly (null when empty) so a fresh program gets a
        // broad rule, not a carried-over one.
        const subsArg = subs.length ? subs : null;
        if (target === "global") {
            setProgramStatus(getGlobalRef(), prog, status, subsArg);
            if (globalPersistRef) globalPersistRef();
        } else {
            setProgramStatus(getPolicy(), prog, status, subsArg);
            if (onPersist) onPersist();
        }
        input.value = "";
        subsInput.value = "";
        onAdded();
    };

    add.on("click", doAdd);
    const onEnter = (e) => { if (e.key === "Enter") { e.preventDefault(); doAdd(); } };
    input.addEventListener("keydown", onEnter);
    subsInput.addEventListener("keydown", onEnter);

    form.append(input, subsInput, sel, add);
    return form;
}

/**
 * Opens the shared command-policy review modal.
 * @param {object} opts
 * @param {string} opts.title Modal title.
 * @param {string} opts.scope "global" | "session" (used for the subtitle).
 * @param {() => object} opts.getPolicy Returns the live policy for the displayed scope.
 * @param {() => void|Promise<void>} opts.onPersist Called after a displayed-scope mutation.
 * @param {() => object} [opts.getGlobalPolicy] Global policy source (session scope "always" writes).
 * @param {() => void|Promise<void>} [opts.onPersistGlobal] Persist the global policy.
 * @returns {Promise<void>}
 */
export async function openCommandPolicyReviewModal({ title, scope, getPolicy, onPersist, getGlobalPolicy, onPersistGlobal } = {}) {
    // Cross-scope references for "always" writes (fall back to the displayed
    // scope when the caller doesn't supply a separate global source).
    const getGlobalRef = getGlobalPolicy || getPolicy;
    const globalPersistRef = onPersistGlobal || onPersist;

    const inner = new Block();
    inner.className = "cmd-policy-review";

    const sub = new Inline();
    sub.className = "cmd-policy-review-sub";
    sub.textContent = scope === "session"
        ? "Per-session command policies (override / extend the global list). 'Always' writes to the global list."
        : "Global command policies (apply to all sessions).";
    inner.append(sub);

    const tableHost = new Block();
    tableHost.className = "cmd-policy-review-host";
    inner.append(tableHost);

    const renderTable = () => {
        const policy = getPolicy();
        const programs = programsWithPolicy(policy);
        tableHost.empty();

        if (programs.length === 0) {
            const empty = new Inline();
            empty.className = "cmd-policy-review-empty";
            empty.textContent = "No programs have a policy yet. Add one below, or approve / block commands in a session.";
            tableHost.append(empty);
            return;
        }

        const table = new Block();
        table.className = "cmd-policy-review-table";

        const header = new Block();
        header.className = "agent-cmd-program-row cmd-policy-review-header";
        const hRisk = new Inline(); hRisk.className = "agent-cmd-risk-chip cmd-policy-review-col-risk"; hRisk.textContent = "RISK";
        const hName = new Inline(); hName.className = "agent-cmd-program-name cmd-policy-review-col-name"; hName.textContent = "PROGRAM";
        const hSubs = new Inline(); hSubs.className = "cmd-policy-review-col-subs"; hSubs.textContent = "SUBCOMMANDS";
        const hSel = new Inline(); hSel.className = "cmd-policy-review-col-sel"; hSel.textContent = "STATUS";
        const hBin = new Inline(); hBin.className = "cmd-policy-review-col-bin"; hBin.textContent = "";
        header.append(hRisk, hName, hSubs, hSel, hBin);
        table.append(header);

        // Click a row's subs cell to edit its subcommand filter. Targets the
        // rule matching the program's effective status in the displayed scope.
        const editSubsFor = async (prog, pol) => {
            const st = statusFor(prog, pol);
            if (st === "none") return; // no rule in this scope to edit
            const cur = subChipsFor(prog, pol);
            const curSubs = st === "block" ? (cur.blockSubs || []) : (cur.allowSubs || []);
            const val = await window.modal.prompt(
                `Subcommands for ${prog} (${st}) — comma separated. Leave empty to allow/block the whole program.`,
                "Edit subcommands",
                curSubs.join(", ")
            );
            if (val === null) return; // cancelled
            const subs = val.split(/[,\s]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
            editSubs(getPolicy(), prog, st, subs);
            if (onPersist) onPersist();
            renderTable();
        };

        for (const program of programs) {
            const { row, sel } = buildRow(program, statusFor(program, policy), scope, policy, (prog) => {
                // Remove from the displayed scope only.
                setProgramStatus(getPolicy(), prog, "none");
                if (onPersist) onPersist();
                renderTable();
            }, (prog, pol) => editSubsFor(prog, pol));
            if (sel) {
                sel.onchange = () => {
                    const options = scope === "session" ? SESSION_OPTIONS : GLOBAL_OPTIONS;
                    const opt = options.find(o => o[0] === sel.value);
                    if (!opt) return;
                    const [, , target, status] = opt;
                    if (target === "global") {
                        setProgramStatus(getGlobalRef(), program, status);
                        if (globalPersistRef) globalPersistRef();
                    } else {
                        setProgramStatus(getPolicy(), program, status);
                        if (onPersist) onPersist();
                    }
                    renderTable();
                };
            }
            table.append(row);
        }
        tableHost.append(table);
    };

    renderTable();

    const addForm = buildAddForm(scope, getPolicy, onPersist, getGlobalRef, globalPersistRef, renderTable);
    inner.append(addForm);

    const okButton = new Button("Close");
    okButton.classList.add("themed");
    okButton.on("click", () => window.modal.hide(true));

    window.modal.snapshot(); // capture any modal below before replacing content
    window.modal.inner.empty();
    window.modal.inner.append(inner);
    window.modal.actionBar.empty();
    window.modal.actionBar.append(okButton);

    await window.modal.show();
}

export default openCommandPolicyReviewModal;
