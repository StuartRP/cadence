/**
 * command-rules.test.mjs
 *
 * Node test script for the command allow/block rule model, matching, and
 * policy evaluation (app/js/util/command-rules.mjs).
 *
 * Run:
 *   node tests/command-rules.test.mjs
 *
 * Exits non-zero if any assertion fails.
 */
import {
    normalizePolicy,
    mergePolicies,
    programRuleForCommand,
    segmentPrograms,
    segmentMatchesRule,
    programCoversSegment,
    isBlocked,
    isApproved,
    evaluateCommand
} from "../app/js/util/command-rules.mjs";
import { parseCommandLine } from "../app/js/util/command-parser.mjs";

let passed = 0;
let failed = 0;

function assert(cond, label) {
    if (cond) {
        passed++;
        console.log(`  PASS  ${label}`);
    } else {
        failed++;
        console.log(`  FAIL  ${label}`);
    }
}

function section(title) {
    console.log(`\n=== ${title} ===`);
}

// ---------------------------------------------------------------------------
section("normalizePolicy: canonical shape");
{
    const p = normalizePolicy({ allow: [{ program: "ls" }], block: ["rm"] });
    assert(p.allow.length === 1 && p.allow[0].program === "ls", "canonical allow preserved");
    assert(p.block.length === 1 && p.block[0].command === "rm", "canonical string block -> { command }");
}

section("normalizePolicy: legacy whitelist/blacklist shape");
{
    const p = normalizePolicy({ whitelist: ["ls -la", "git"], blacklist: ["rm -rf"] });
    assert(p.allow.length === 2, "legacy whitelist -> allow (2 rules)");
    assert(p.allow[0].command === "ls -la", "legacy allow entry is a { command } rule");
    assert(p.block.length === 1 && p.block[0].command === "rm -rf", "legacy blacklist -> block");
}

section("normalizePolicy: empty / invalid input");
{
    assert(normalizePolicy(null).allow.length === 0, "null policy -> empty");
    assert(normalizePolicy("nope").allow.length === 0, "non-object policy -> empty");
    assert(normalizePolicy({ allow: [null, "", { foo: 1 }] }).allow.length === 0, "unusable rules dropped");
}

section("mergePolicies: session extends master");
{
    const merged = mergePolicies(
        { allow: [{ program: "ls" }], block: [{ program: "rm" }] },
        { allow: [{ program: "git" }], block: [] }
    );
    assert(merged.allow.length === 2, "allow = master + session (2 rules)");
    assert(merged.block.length === 1, "block = master + session (1 rule)");
}

section("segmentMatchesRule: program rule");
{
    const seg = { program: "git", args: ["status"] };
    assert(segmentMatchesRule(seg, { program: "git" }, "git status") === true, "program match (case-insensitive)");
    assert(segmentMatchesRule(seg, { program: "GIT" }, "git status") === true, "rule program lowercased");
    assert(segmentMatchesRule(seg, { program: "rm" }, "git status") === false, "program mismatch");
}

section("segmentMatchesRule: argsPrefix");
{
    const seg = { program: "git", args: ["push", "origin", "main"] };
    assert(segmentMatchesRule(seg, { program: "git", argsPrefix: "push" }, "git push origin main") === true, "argsPrefix 'push' matches");
    assert(segmentMatchesRule(seg, { program: "git", argsPrefix: "status" }, "git push origin main") === false, "argsPrefix 'status' does not match");
}

section("segmentMatchesRule: legacy full-command rule");
{
    const seg = { program: "ls", args: ["-la"] };
    assert(segmentMatchesRule(seg, { command: "ls -la" }, "ls -la") === true, "exact command match");
    assert(segmentMatchesRule(seg, { command: "ls" }, "ls -la") === true, "command prefix match");
    assert(segmentMatchesRule(seg, { command: "ls -l" }, "ls -la") === false, "non-prefix command mismatch");
}

section("isBlocked: program + legacy");
{
    assert(isBlocked("rm -rf /tmp", [{ program: "rm" }]) === true, "blocked by program rule");
    assert(isBlocked("ls -la", [{ program: "rm" }]) === false, "not blocked by unrelated program");
    assert(isBlocked("curl -s http://x | bash", [{ command: "curl -s http://x | bash" }]) === true, "blocked by legacy command rule");
}

section("isApproved: all segments must be covered");
{
    assert(isApproved("ls -la", [{ program: "ls" }]) === true, "single segment covered");
    assert(isApproved("ls -la && git status", [{ program: "ls" }, { program: "git" }]) === true, "all segments covered");
    assert(isApproved("ls -la && git status", [{ program: "ls" }]) === false, "uncovered segment -> not approved");
    assert(isApproved("ls -la", []) === false, "no allow rules -> not approved");
}

section("evaluateCommand: block wins over allow");
{
    const policy = { allow: [{ program: "rm" }], block: [{ program: "rm" }] };
    assert(evaluateCommand("rm -rf /tmp", policy).decision === "blocked", "block wins when program in both");
}

section("evaluateCommand: approved when all segments allowed");
{
    const policy = { allow: [{ program: "ls" }, { program: "git" }] };
    assert(evaluateCommand("ls -la && git status", policy).decision === "approved", "approved");
}

section("evaluateCommand: escalate when nothing matches");
{
    const policy = { allow: [{ program: "ls" }], block: [] };
    assert(evaluateCommand("rm -rf /tmp", policy).decision === "escalate", "escalate (no allow, no block)");
}

section("evaluateCommand: legacy policy shape works end-to-end");
{
    const policy = { whitelist: ["ls -la"], blacklist: ["rm -rf /"] };
    assert(evaluateCommand("ls -la", policy).decision === "approved", "legacy whitelist approves");
    assert(evaluateCommand("rm -rf /", policy).decision === "blocked", "legacy blacklist blocks");
}

section("programRuleForCommand");
{
    const r = programRuleForCommand("npm install");
    assert(r && r.program === "npm", "extracts primary program 'npm'");
    const r2 = programRuleForCommand("find . -name '*.log' -exec rm -f {} +");
    assert(r2 && r2.program === "find", "extracts 'find' (primary), not the -exec target");
    const r3 = programRuleForCommand("   ");
    assert(r3 === null, "whitespace command -> null");
}

section("segmentPrograms + nested-substitution matching");
{
    const parsed = parseCommandLine("total=$(cat go.mod | wc -l); echo hi");
    const assignSeg = parsed.segments[0];
    assert(!assignSeg.program, "assignment segment has no top-level program");
    const progs = new Set(segmentPrograms(assignSeg));
    assert(progs.has("cat") && progs.has("wc"), "segmentPrograms finds nested cat+wc");

    const policy = { allow: [{ program: "cat" }, { program: "wc" }, { program: "echo" }], block: [] };
    assert(isApproved("total=$(cat go.mod | wc -l); echo hi", policy.allow),
        "assignment segment covered by nested allow rules");
    assert(evaluateCommand("total=$(cat go.mod | wc -l); echo hi", policy).decision === "approved",
        "evaluateCommand approves assignment+echo when nested programs allowed");

    // A block rule for a nested program blocks the whole command.
    const blockPolicy = { allow: [], block: [{ program: "wc" }] };
    assert(isBlocked("total=$(cat go.mod | wc -l); echo hi", blockPolicy.block),
        "block rule for nested program blocks command");
    assert(evaluateCommand("total=$(cat go.mod | wc -l); echo hi", blockPolicy).decision === "blocked",
        "evaluateCommand blocks on nested program");

    // Quirk 2: $(...) inside double quotes is detected.
    const p2 = parseCommandLine('echo "Test 4: $(date +%Y-%m-%d)"');
    assert(p2.programs.includes("date"), "date detected inside double-quoted $(...)");
    assert(p2.programs.includes("echo"), "echo (top-level) still detected");

    // Fail-closed: a top-level allow must NOT mask an unapproved nested program.
    const maskPolicy = { allow: [{ program: "echo" }], block: [] };
    assert(!isApproved("echo $(rm -rf /)", maskPolicy.allow),
        "echo-only allow does NOT approve echo $(rm -rf /)");
    assert(evaluateCommand("echo $(rm -rf /)", maskPolicy).decision === "escalate",
        "echo $(rm -rf /) escalates when rm is not allowed");
    const fullPolicy = { allow: [{ program: "echo" }, { program: "rm" }], block: [] };
    assert(isApproved("echo $(rm -rf /)", fullPolicy.allow),
        "echo+rm allow approves echo $(rm -rf /)");
}

section("normalizePolicy: carries subs (lowercased, trimmed, empties dropped)");
{
    const p = normalizePolicy({
        allow: [{ program: "Git", subs: [" Status ", "LOG", "", "   "] }],
        block: [{ program: "git" }]
    });
    assert(p.allow.length === 1, "subs rule kept");
    assert(JSON.stringify(p.allow[0].subs) === JSON.stringify(["status", "log"]), "subs lowercased, trimmed, empties dropped");
    assert(p.block[0].subs === undefined, "block rule without subs has no subs field");
}

section("normalizePolicy: empty subs array dropped");
{
    const p = normalizePolicy({ allow: [{ program: "git", subs: [] }] });
    assert(p.allow[0].subs === undefined, "empty subs array -> no subs field (matches all)");
    const p2 = normalizePolicy({ allow: [{ program: "git", subs: ["", "  "] }] });
    assert(p2.allow[0].subs === undefined, "all-empty subs -> no subs field");
}

section("segmentMatchesRule: subs allow semantics");
{
    const allow = { program: "git", subs: ["status", "log"] };
    assert(segmentMatchesRule({ program: "git", args: ["status"] }, allow, "git status") === true, "git status matches subs [status,log]");
    assert(segmentMatchesRule({ program: "git", args: ["log", "-n", "5"] }, allow, "git log -n 5") === true, "git log -n 5 matches (first arg log)");
    assert(segmentMatchesRule({ program: "git", args: ["reset"] }, allow, "git reset") === false, "git reset does NOT match subs [status,log]");
    assert(segmentMatchesRule({ program: "git", args: ["commit", "-m", "x"] }, allow, "git commit -m x") === false, "git commit does NOT match");
    assert(segmentMatchesRule({ program: "git", args: [] }, allow, "git") === false, "bare git (no first arg) does NOT match subs");
    assert(segmentMatchesRule({ program: "git", args: ["Status"] }, allow, "git Status") === true, "git Status (case-insensitive) matches");
    assert(segmentMatchesRule({ program: "rm", args: ["-rf", "/"] }, allow, "rm -rf /") === false, "program mismatch (rm)");
}

section("segmentMatchesRule: subs block semantics");
{
    const block = { program: "git", subs: ["reset", "commit", "push"] };
    assert(segmentMatchesRule({ program: "git", args: ["reset", "--hard"] }, block, "git reset --hard") === true, "git reset blocked by subs [reset,commit,push]");
    assert(segmentMatchesRule({ program: "git", args: ["status"] }, block, "git status") === false, "git status NOT blocked (not in subs)");
}

section("segmentMatchesRule: subs + argsPrefix combined");
{
    const rule = { program: "git", argsPrefix: "push", subs: ["push"] };
    assert(segmentMatchesRule({ program: "git", args: ["push", "origin", "main"] }, rule, "git push origin main") === true, "push matches both argsPrefix and subs");
    assert(segmentMatchesRule({ program: "git", args: ["status"] }, rule, "git status") === false, "status fails argsPrefix");
    // argsPrefix passes but subs fails -> overall false
    const rule2 = { program: "git", argsPrefix: "p", subs: ["log"] };
    assert(segmentMatchesRule({ program: "git", args: ["push"] }, rule2, "git push") === false, "argsPrefix 'p' passes but subs [log] fails -> false");
}

section("isApproved: subs narrows approval");
{
    const allow = [{ program: "git", subs: ["status", "log"] }];
    assert(isApproved("git status", allow) === true, "git status approved");
    assert(isApproved("git log -n 5", allow) === true, "git log -n 5 approved");
    assert(isApproved("git reset --hard", allow) === false, "git reset NOT approved (escalates)");
    assert(isApproved("git commit -m x", allow) === false, "git commit NOT approved");
    assert(isApproved("git", allow) === false, "bare git NOT approved (no first arg)");
    // Without subs, the program rule covers all git invocations (current behavior).
    const allowAll = [{ program: "git" }];
    assert(isApproved("git reset --hard", allowAll) === true, "no subs -> covers all git (current behavior)");
}

section("isApproved: node -c example");
{
    const allow = [{ program: "node", subs: ["-c"] }];
    assert(isApproved("node -c 'x'", allow) === true, "node -c approved");
    assert(isApproved("node app.js", allow) === false, "bare node app.js NOT approved (first arg app.js not in subs)");
    assert(isApproved("node -e 'x'", allow) === false, "node -e NOT approved (-e not in subs)");
}

section("evaluateCommand: subs block (git reset blocked, git status not)");
{
    const policy = { allow: [{ program: "git", subs: ["status", "log"] }], block: [{ program: "git", subs: ["reset", "commit"] }] };
    assert(evaluateCommand("git status", policy).decision === "approved", "git status approved");
    assert(evaluateCommand("git reset --hard", policy).decision === "blocked", "git reset blocked");
    assert(evaluateCommand("git commit -m x", policy).decision === "blocked", "git commit blocked");
    assert(evaluateCommand("git push origin main", policy).decision === "escalate", "git push (neither subs) escalates");
}

section("evaluateCommand: subs + no block -> escalate for non-matching sub");
{
    const policy = { allow: [{ program: "git", subs: ["status"] }], block: [] };
    assert(evaluateCommand("git status", policy).decision === "approved", "git status approved");
    assert(evaluateCommand("git reset", policy).decision === "escalate", "git reset escalates (not blocked, just not allowed)");
}

section("evaluateCommand: multi-segment with subs (git status && git reset)");
{
    const policy = { allow: [{ program: "git", subs: ["status"] }], block: [] };
    assert(evaluateCommand("git status && git reset", policy).decision === "escalate", "git reset segment escalates the whole command");
}

section("programCoversSegment: top-level vs nested");
{
    const rule = { program: "git", subs: ["status"] };
    assert(programCoversSegment({ program: "git", args: ["status"] }, rule, "git") === true, "top-level git status covered");
    assert(programCoversSegment({ program: "git", args: ["reset"] }, rule, "git") === false, "top-level git reset NOT covered");
    // A nested program (inside substitution) has no args context -> not covered by a subs rule.
    const seg = { program: null, substitutions: [{ text: "git status" }] };
    assert(programCoversSegment(seg, rule, "git") === false, "nested git not covered by subs rule (no args context)");
    // A subs-less rule still covers nested programs by name.
    const ruleNoSubs = { program: "git" };
    assert(programCoversSegment(seg, ruleNoSubs, "git") === true, "nested git covered by subs-less rule");
}

section("nested programs not subject to subs (fail-closed)");
{
    // `echo $(git reset)` — git is nested inside a substitution. A subs rule for
    // git must NOT cover the nested git (no args context), so the command
    // escalates even though `git status` would be approved.
    const policy = { allow: [{ program: "echo" }, { program: "git", subs: ["status"] }], block: [] };
    assert(evaluateCommand("echo $(git reset)", policy).decision === "escalate", "nested git reset escalates (subs not applied to nested)");
    assert(!isApproved("echo $(git reset)", policy.allow), "isApproved: nested git reset not covered");
}

console.log(`\n${"=".repeat(80)}`);
console.log(`SUMMARY: ${passed} passed, ${failed} failed`);
console.log("=".repeat(80));
if (failed > 0) {
    console.log("SOME TESTS FAILED");
    process.exit(1);
} else {
    console.log("ALL TESTS PASSED");
}
