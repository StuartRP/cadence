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
import { normalizePolicy } from "./command-rules.mjs";

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
 * @param {object} policy canonical or legacy policy (mutated)
 * @param {string} program
 * @param {string} status "allow" | "block" | "none"
 */
export function setProgramStatus(policy, program, status) {
    const norm = normalizePolicy(policy);
    const p = String(program).trim().toLowerCase();
    norm.allow = norm.allow.filter(r => !(r.program && r.program === p));
    norm.block = norm.block.filter(r => !(r.program && r.program === p));
    if (status === "allow") norm.allow.push({ program: p });
    else if (status === "block") norm.block.push({ program: p });
    // "none" -> removed from both (no rule).
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

function buildRow(program, status, scope, onRemove) {
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

    row.append(chip, name, sel, bin);
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

    const doAdd = () => {
        const prog = input.value.trim().toLowerCase();
        if (!prog) return;
        const opt = options.find(o => o[0] === sel.value) || options[0];
        const [, , target, status] = opt;
        if (target === "global") {
            setProgramStatus(getGlobalRef(), prog, status);
            if (globalPersistRef) globalPersistRef();
        } else {
            setProgramStatus(getPolicy(), prog, status);
            if (onPersist) onPersist();
        }
        input.value = "";
        onAdded();
    };

    add.on("click", doAdd);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); doAdd(); } });

    form.append(input, sel, add);
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
        const hSel = new Inline(); hSel.className = "cmd-policy-review-col-sel"; hSel.textContent = "STATUS";
        const hBin = new Inline(); hBin.className = "cmd-policy-review-col-bin"; hBin.textContent = "";
        header.append(hRisk, hName, hSel, hBin);
        table.append(header);

        for (const program of programs) {
            const { row, sel } = buildRow(program, statusFor(program, policy), scope, (prog) => {
                // Remove from the displayed scope only.
                setProgramStatus(getPolicy(), prog, "none");
                if (onPersist) onPersist();
                renderTable();
            });
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

    window.modal.inner.empty();
    window.modal.inner.append(inner);
    window.modal.actionBar.empty();
    window.modal.actionBar.append(okButton);

    await window.modal.show();
}

export default openCommandPolicyReviewModal;
