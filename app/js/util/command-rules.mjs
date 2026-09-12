/**
 * command-rules.mjs
 *
 * Program-level command allow/block rule model, matching, and policy
 * evaluation. Pure, dependency-free ESM (no DOM) so it can be imported by the
 * browser app and by Node test scripts alike.
 *
 * Rule model
 * ----------
 * A rule is one of:
 *   { program: string, argsPrefix?: string, subs?: string[] } — program-level rule
 *   { command: string }                          — legacy full-command-string rule
 *
 * `subs` is an optional FILTER of acceptable first-args (subcommands) for the
 * program. When present, a program rule only matches a segment whose first
 * argument is one of `subs` (case-insensitive). This lets a user allow
 * `git status` / `git log` while leaving `git reset` / `git commit` to
 * escalate, or allow `node -c` while leaving bare `node ...` to escalate.
 * Absent/empty `subs` = no filter (matches all invocations, current behavior).
 * `subs` coexists with `argsPrefix` (both must hold when both are present).
 * `subs` constrains only the top-level program (its first arg), not programs
 * nested inside command substitutions (which have no args context).
 *
 * Policy shape (canonical):
 *   { allow: Rule[], block: Rule[] }
 *
 * A normalizer tolerates the legacy shape { whitelist: string[], blacklist:
 * string[] } by treating each entry as a legacy `{ command }` rule.
 *
 * Merge semantics:
 *   mergePolicies(master, session) = master rules + session rules.
 *   Block wins over allow: if a program (or command) appears in both allow and
 *   block, the block rule takes precedence.
 */

import { parseCommandLine, extractPrograms, classifyProgram } from "./command-parser.mjs";

// ---------------------------------------------------------------------------
// Rule helpers
// ---------------------------------------------------------------------------

/**
 * Sanitizes a single rule entry into the canonical rule object, or null if it
 * is not a usable rule.
 * @param {any} entry
 * @returns {{ program?: string, argsPrefix?: string, subs?: string[], command?: string }|null}
 */
function normalizeRule(entry) {
    if (!entry) return null;

    // Legacy: a bare string is a full-command rule.
    if (typeof entry === "string") {
        const cmd = entry.trim();
        return cmd ? { command: cmd } : null;
    }

    if (typeof entry === "object") {
        const out = {};
        if (typeof entry.program === "string" && entry.program.trim()) {
            out.program = entry.program.trim().toLowerCase();
        }
        if (typeof entry.argsPrefix === "string" && entry.argsPrefix.trim()) {
            out.argsPrefix = entry.argsPrefix.trim();
        }
        if (typeof entry.command === "string" && entry.command.trim()) {
            out.command = entry.command.trim();
        }
        // Optional subcommand filter: a list of acceptable first-args (e.g.
        // { program: "git", subs: ["status", "log"] }). Trimmed + lowercased,
        // empties dropped; only kept when non-empty.
        if (Array.isArray(entry.subs)) {
            const subs = entry.subs
                .filter(s => typeof s === "string" && s.trim())
                .map(s => s.trim().toLowerCase());
            if (subs.length > 0) out.subs = subs;
        }
        return (out.program || out.command) ? out : null;
    }
    return null;
}

/**
 * Normalizes a policy object into the canonical `{ allow: Rule[], block: Rule[] }`
 * shape, tolerating the legacy `{ whitelist, blacklist }` shape.
 * @param {any} policy
 * @returns {{ allow: object[], block: object[] }}
 */
export function normalizePolicy(policy) {
    const out = { allow: [], block: [] };
    if (!policy || typeof policy !== "object") return out;

    const allowSrc = Array.isArray(policy.allow) ? policy.allow
        : Array.isArray(policy.whitelist) ? policy.whitelist : [];
    const blockSrc = Array.isArray(policy.block) ? policy.block
        : Array.isArray(policy.blacklist) ? policy.blacklist : [];

    for (const e of allowSrc) {
        const r = normalizeRule(e);
        if (r) out.allow.push(r);
    }
    for (const e of blockSrc) {
        const r = normalizeRule(e);
        if (r) out.block.push(r);
    }
    return out;
}

/**
 * Merges a master (global) policy with a per-session policy. Session rules
 * extend master rules; block wins over allow.
 * @param {any} master
 * @param {any} session
 * @returns {{ allow: object[], block: object[] }}
 */
export function mergePolicies(master, session) {
    const m = normalizePolicy(master);
    const s = normalizePolicy(session);
    return {
        allow: [...m.allow, ...s.allow],
        block: [...m.block, ...s.block]
    };
}

/**
 * Builds a program-level rule for a command (used by "always allow/deny").
 * Extracts the primary program from the first segment.
 * @param {string} command
 * @returns {{ program: string }|null}
 */
export function programRuleForCommand(command) {
    const programs = extractPrograms(command);
    if (!programs || programs.length === 0) return null;
    return { program: programs[0].toLowerCase() };
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/**
 * Returns true if a segment matches a rule.
 * - Program rule: segment.program === rule.program (case-insensitive), and if
 *   rule.argsPrefix is set, the segment's args joined by spaces must start with
 *   that prefix, and if rule.subs is set, the segment's first arg must be one
 *   of rule.subs (case-insensitive). A rule with argsPrefix or subs only
 *   constrains the TOP-LEVEL program; programs nested inside command
 *   substitutions match by name only when the rule has neither.
 * - Legacy command rule: the full command string equals rule.command, or starts
 *   with rule.command + " ".
 * @param {object} segment
 * @param {object} rule
 * @param {string} fullCommand
 * @returns {boolean}
 */
/**
 * Collects every program name associated with a segment: the top-level
 * program (if any) plus programs inside command substitutions (e.g.
 * `total=$(cat go.mod | wc -l)` has no top-level program but contains
 * `cat` and `wc`).
 * @param {object} segment
 * @returns {string[]}
 */
export function segmentPrograms(segment) {
    const progs = new Set();
    if (!segment) return [];
    if (segment.program) progs.add(String(segment.program).toLowerCase());
    for (const sub of segment.substitutions || []) {
        for (const p of extractPrograms(sub.text || "")) {
            progs.add(p.toLowerCase());
        }
    }
    return [...progs];
}

/**
 * Collects the distinct `subs` (acceptable first-args) carried by the allow and
 * block rules for a program, for auditability in the approval card and the
 * review table. A program can have an allow rule with subs (e.g. allow
 * `git status`) AND a block rule with subs (e.g. block `git reset`), so the
 * two are reported separately.
 * @param {string} program
 * @param {object} policy canonical or legacy policy
 * @returns {{ allowSubs: string[]|null, blockSubs: string[]|null }}
 */
export function subChipsFor(program, policy) {
    const norm = normalizePolicy(policy);
    const p = String(program).toLowerCase();
    const allowSubs = new Set();
    const blockSubs = new Set();
    for (const r of norm.allow) {
        if (r.program === p && Array.isArray(r.subs)) r.subs.forEach(s => allowSubs.add(s));
    }
    for (const r of norm.block) {
        if (r.program === p && Array.isArray(r.subs)) r.subs.forEach(s => blockSubs.add(s));
    }
    const sorted = a => [...a].sort((x, y) => x.localeCompare(y));
    return {
        allowSubs: allowSubs.size ? sorted(allowSubs) : null,
        blockSubs: blockSubs.size ? sorted(blockSubs) : null
    };
}

/**
 * Returns true if a program rule covers a *specific program* within a segment.
 * Used for per-program coverage in isApproved and for top-level matching in
 * segmentMatchesRule.
 *
 * - The rule's program must equal `prog` (case-insensitive).
 * - If the rule has `argsPrefix`, it constrains the TOP-LEVEL program's args
 *   (only meaningful when `prog` is the segment's top-level program).
 * - If the rule has `subs`, it constrains the TOP-LEVEL program's first arg
 *   (only meaningful when `prog` is the segment's top-level program). A
 *   nested-substitution program has no args context, so a `subs`-constrained
 *   rule does NOT cover it.
 * @param {object} segment
 * @param {object} rule
 * @param {string} prog the program name to check (lowercase)
 * @returns {boolean}
 */
export function programCoversSegment(segment, rule, prog) {
    if (!segment || !rule || !rule.program) return false;
    if (rule.program.toLowerCase() !== prog) return false;

    const isTopLevel = prog === (segment.program || "").toLowerCase();
    if (isTopLevel) {
        if (rule.argsPrefix) {
            const argsStr = (segment.args || []).join(" ");
            if (!argsStr.startsWith(rule.argsPrefix)) return false;
        }
        if (Array.isArray(rule.subs) && rule.subs.length > 0) {
            const first = (segment.args || [])[0];
            if (first === undefined || first === null || first === "") return false;
            if (!rule.subs.includes(String(first).toLowerCase())) return false;
        }
        return true;
    }

    // `prog` is a program nested inside a command substitution (not the
    // segment's top-level program). A rule with `argsPrefix` or `subs`
    // constrains the top-level program's args, so it does NOT cover nested
    // programs (they have no args context). A subs-less rule covers nested
    // programs by name.
    if (rule.argsPrefix || (Array.isArray(rule.subs) && rule.subs.length > 0)) {
        return false;
    }
    return true;
}

export function segmentMatchesRule(segment, rule, fullCommand) {
    if (!segment || !rule) return false;

    if (rule.program) {
        const target = rule.program.toLowerCase();
        const segProgram = (segment.program || "").toLowerCase();
        if (segProgram === target) {
            return programCoversSegment(segment, rule, target);
        }
        // Also match programs nested inside command substitutions, so that a
        // variable-assignment segment like `total=$(cat go.mod | wc -l)` is
        // covered by an allow rule for `cat`/`wc`. Nested programs match by
        // name only — a rule with `argsPrefix` or `subs` constrains the
        // top-level program's args, so it does NOT cover nested programs.
        if (!rule.argsPrefix && !(Array.isArray(rule.subs) && rule.subs.length > 0) &&
            segmentPrograms(segment).includes(target)) {
            return true;
        }
        return false;
    }

    if (rule.command) {
        const cmd = (fullCommand || "").trim();
        return cmd === rule.command || cmd.startsWith(rule.command + " ");
    }

    return false;
}

/**
 * Returns true if any block rule matches the command (either a segment program
 * match or a legacy full-command match).
 * @param {string} command
 * @param {object[]} blockRules
 * @returns {boolean}
 */
export function isBlocked(command, blockRules) {
    if (!blockRules || blockRules.length === 0) return false;
    const parsed = parseCommandLine(command);
    for (const rule of blockRules) {
        for (const seg of parsed.segments) {
            if (segmentMatchesRule(seg, rule, command)) return true;
        }
    }
    return false;
}

/**
 * Returns true if every segment of the command is covered by at least one allow
 * rule (program match or legacy full-command match).
 * @param {string} command
 * @param {object[]} allowRules
 * @returns {boolean}
 */
export function isApproved(command, allowRules) {
    if (!allowRules || allowRules.length === 0) return false;
    const parsed = parseCommandLine(command);
    if (parsed.segments.length === 0) return false;

    // A legacy full-command allow rule covers the entire command string
    // (the user explicitly approved this exact command).
    const legacyCovers = allowRules.some(rule =>
        rule.command && segmentMatchesRule({ program: null, substitutions: [] }, rule, command));

    const programRules = allowRules.filter(rule => rule.program);
    for (const seg of parsed.segments) {
        if (legacyCovers) continue; // whole command explicitly approved
        const progs = segmentPrograms(seg);
        if (progs.length === 0) return false; // no identifiable program -> fail closed
        // EVERY program in the segment (top-level and nested in substitutions)
        // must be covered by a program allow rule. This prevents a top-level
        // allow (e.g. `echo`) from masking an unapproved nested program
        // (e.g. `echo $(rm -rf /)`). A rule with `argsPrefix`/`subs` only
        // covers the top-level program; nested programs match by name only.
        for (const prog of progs) {
            const covered = programRules.some(rule => programCoversSegment(seg, rule, prog));
            if (!covered) return false;
        }
    }
    return true;
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

const RISK_ORDER = { safe: 0, moderate: 1, dangerous: 2, unknown: 3 };

/**
 * Evaluates a command against a (merged) policy.
 * @param {string} command
 * @param {object} policy canonical or legacy policy
 * @returns {{ decision: 'blocked'|'approved'|'escalate', segments: object[], worstRisk: string, warnings: string[] }}
 */
export function evaluateCommand(command, policy) {
    const merged = normalizePolicy(policy);
    const parsed = parseCommandLine(command);

    // Block wins: any segment matching a block rule → blocked.
    if (isBlocked(command, merged.block)) {
        return { decision: "blocked", segments: parsed.segments, worstRisk: worstRisk(parsed.segments), warnings: parsed.warnings };
    }

    // Approved only if every segment is covered by an allow rule.
    if (isApproved(command, merged.allow)) {
        return { decision: "approved", segments: parsed.segments, worstRisk: worstRisk(parsed.segments), warnings: parsed.warnings };
    }

    return { decision: "escalate", segments: parsed.segments, worstRisk: worstRisk(parsed.segments), warnings: parsed.warnings };
}

function worstRisk(segments) {
    let worst = "safe";
    for (const seg of segments) {
        if (!seg.risk || seg.risk === "unknown") continue;
        if (RISK_ORDER[seg.risk] > RISK_ORDER[worst]) worst = seg.risk;
    }
    return worst;
}

/**
 * Convenience: classify a program name (re-exported for UI risk badges).
 * @param {string} name
 */
export function classify(name) {
    return classifyProgram(name);
}

export default {
    normalizeRule,
    normalizePolicy,
    mergePolicies,
    programRuleForCommand,
    segmentPrograms,
    subChipsFor,
    segmentMatchesRule,
    programCoversSegment,
    isBlocked,
    isApproved,
    evaluateCommand,
    classify
};
