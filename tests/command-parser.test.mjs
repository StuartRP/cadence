/**
 * command-parser.test.mjs
 *
 * Node test/audit script for app/js/util/command-parser.mjs.
 *
 * Usage: node tests/command-parser.test.mjs
 *
 * 1. Loads tests/cli-commands.txt (44 sample commands) and prints an audit
 *    table: index, segment count, detected programs, risk flags, warnings.
 * 2. Asserts per-line expected program sets (hand-verified) plus unit tests
 *    for edge cases (nested $(), sh -c, xargs, find -exec, curl | bash,
 *    fork bomb, heredoc, comments, redirects, background &).
 *
 * Exits non-zero on any failure.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
    parseCommandLine,
    extractPrograms,
    classifyProgram
} from "../app/js/util/command-parser.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

let passCount = 0;
let failCount = 0;
const failures = [];

function assertEqual(actual, expected, label) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a === e) {
        passCount++;
        console.log(`  PASS  ${label}`);
    } else {
        failCount++;
        const msg = `FAIL  ${label}\n        expected: ${e}\n        actual:   ${a}`;
        failures.push(msg);
        console.log(msg);
    }
}

function assertTrue(cond, label) {
    if (cond) {
        passCount++;
        console.log(`  PASS  ${label}`);
    } else {
        failCount++;
        const msg = `FAIL  ${label}`;
        failures.push(msg);
        console.log(msg);
    }
}

function assertIncludes(haystack, needle, label) {
    return assertTrue(haystack.includes(needle), label);
}

// ---------------------------------------------------------------------------
// Part 1: audit table over tests/cli-commands.txt
// ---------------------------------------------------------------------------

/**
 * Hand-verified expected program sets for each line of cli-commands.txt
 * (1-indexed). Programs are basenames, lowercase, deduped, in first-occurrence
 * order.
 */
const EXPECTED_PROGRAMS = [
    // 1  mv config.old.json config.old.json.bak 2>/dev/null || true
    ["mv", "true"],
    // 2  tar -czvf backup-src.tar.gz src/
    ["tar"],
    // 3  npm run lint || echo "Linting failed, continuing anyway"
    ["npm", "echo"],
    // 4  go build -v ./... 2>&1 | tee build.log
    ["go", "tee"],
    // 5  tree -L 2 -I 'node_modules|.git|vendor'
    ["tree"],
    // 6  find . -name "*.log" -exec rm -f {} +
    ["find", "rm"],
    // 7  awk '{print $1, $3}' access.log | sort | uniq -c > summary.txt
    ["awk", "sort", "uniq"],
    // 8  git remote -v && git branch --show-current
    ["git"],
    // 9  env | grep -iE "(key|secret|token|pass)"
    ["env", "grep"],
    // 10 cmake -B build -S . && cmake --build build
    ["cmake"],
    // 11 ps aux | grep node | grep -v grep | awk '{print $2}'
    ["ps", "grep", "awk"],
    // 12 sed -i 's/http:\/\/localhost:8080/https:\/\/api.domain.com/g' config.json
    ["sed"],
    // 13 make clean && make -j$(nproc)
    ["make", "nproc"],
    // 14 git log -n 5 --oneline; git branch -a
    ["git"],
    // 15 rm -rf node_modules package-lock.json && npm install
    ["rm", "npm"],
    // 16 ulimit -a > system_limits.txt
    ["ulimit"],
    // 17 npm run build && npm test
    ["npm"],
    // 18 find . -type f -name "*.orig" -delete
    ["find"],
    // 19 node -e "console.log(process.versions)"
    ["node"],
    // 20 ls -la && git status
    ["ls", "git"],
    // 21 chmod -R 777 ./storage && chown -R www-data:www-data .
    ["chmod", "chown"],
    // 22 gradle check --stacktrace > gradle-errors.log
    ["gradle"],
    // 23 curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/health
    ["curl"],
    // 24 git checkout -- .
    ["git"],
    // 25 git push origin main --force
    ["git"],
    // 26 lsof -i :8080 | awk 'NR>1 {print $2}' | xargs -r kill -9
    ["lsof", "awk", "xargs", "kill"],
    // 27 patch -p1 < hotfix.patch
    ["patch"],
    // 28 mkdir -p src/utils && touch src/utils/helpers.js
    ["mkdir", "touch"],
    // 29 cp .env.example .env && chmod 600 .env
    ["cp", "chmod"],
    // 30 rm -rf /tmp/cache/* 2>/dev/null; rm -rf ./build
    ["rm"],
    // 31 curl -fsSL https://get.example.sh/install.sh | bash
    ["curl", "bash"],
    // 32 tail -n 50 -f /var/log/syslog | grep error &
    ["tail", "grep"],
    // 33 uname -a; df -h; free -m
    ["uname", "df", "free"],
    // 34 npm install -g npm@latest && npm audit fix --force
    ["npm"],
    // 35 mvn clean compile test-compile
    ["mvn"],
    // 36 printf '{"status": "ok", "retries": 3}\n' > test/fixture.json
    ["printf"],
    // 37 docker system prune -a --volumes -f
    ["docker"],
    // 38 grep -rn "TODO" src/ > todos.txt
    ["grep"],
    // 39 git checkout -b fix/auth-token && git add -A
    ["git"],
    // 40 docker ps --format "table {{.ID}}\t{{.Names}}\t{{.Status}}"
    ["docker"],
    // 41 find . -name "*.go" | xargs wc -l | sort -nr
    ["find", "xargs", "wc", "sort"],
    // 42 netstat -tlpn 2>/dev/null || ss -tulpn
    ["netstat", "ss"],
    // 43 git diff HEAD~1 --stat
    ["git"],
    // 44 which node npm go gcc make 2>&1
    ["which"],
];

function runAudit() {
    console.log("=".repeat(100));
    console.log("AUDIT TABLE — tests/cli-commands.txt");
    console.log("=".repeat(100));
    const raw = readFileSync(join(__dirname, "cli-commands.txt"), "utf8");
    const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);

    console.log(`Loaded ${lines.length} commands.\n`);
    console.log("idx | segs | programs                        | flags                     | warnings");
    console.log("-".repeat(100));

    const riskOrder = { safe: 0, moderate: 1, dangerous: 2, unknown: 3 };
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const parsed = parseCommandLine(line);

        const flags = [];
        if (parsed.segments.some(s => s.pipedToShell)) flags.push("pipe->shell");
        if (parsed.segments.some(s => s.substitution)) flags.push("subst");
        if (parsed.segments.some(s => s.heredoc)) flags.push("heredoc");
        if (parsed.segments.some(s => s.background)) flags.push("bg");
        if (parsed.segments.some(s => s.comment)) flags.push("comment");
        const worst = parsed.segments.reduce((acc, s) => {
            if (!s.risk || s.risk === "unknown") return acc;
            return riskOrder[s.risk] > riskOrder[acc] ? s.risk : acc;
        }, "safe");

        const idx = String(i + 1).padStart(3);
        const segs = String(parsed.stats.segments).padStart(4);
        const progs = parsed.programs.join(",").padEnd(29).slice(0, 29);
        const fl = (flags.join(",") || "-").padEnd(21).slice(0, 21);
        const warn = parsed.warnings.length ? `${parsed.warnings.length} warning(s)` : "-";
        console.log(`${idx} | ${segs} | ${progs} | ${fl} | ${warn} [${worst}]`);

        assertEqual(parsed.programs, EXPECTED_PROGRAMS[i], `line ${i + 1} programs: ${line.slice(0, 60)}`);
    }
}

// ---------------------------------------------------------------------------
// Part 2: unit edge cases
// ---------------------------------------------------------------------------

function runUnitTests() {
    console.log("\n" + "=".repeat(100));
    console.log("UNIT TESTS — edge cases");
    console.log("=".repeat(100));

    // --- nested $( ) -------------------------------------------------------
    {
        const p = parseCommandLine('echo $(date +%Y-%m-%d) && cat $(ls /tmp)');
        assertEqual(p.programs, ["echo", "date", "cat", "ls"], "nested $( ): programs");
        assertTrue(p.segments[0].substitution, "nested $( ): segment 1 has substitution flag");
    }

    // --- $( ) and backticks INSIDE double quotes ----------------------------
    {
        const p = parseCommandLine('echo "Test 4: $(date +%Y-%m-%d)"');
        assertEqual(p.programs, ["echo", "date"], "double-quoted $( ): inner program detected");
        assertTrue(p.segments[0].substitution, "double-quoted $( ): substitution flag set");
        const p2 = parseCommandLine('echo `date +%Y`');
        assertEqual(p2.programs, ["echo", "date"], "backtick: inner program detected");
        // Variable expansion is NOT a substitution.
        const p3 = parseCommandLine('echo "value is $HOME and ${USER}"');
        assertEqual(p3.programs, ["echo"], "variable expansion: no substitution program");
        assertTrue(!p3.segments[0].substitution, "variable expansion: no substitution flag");
    }

    // --- sh -c recursion ----------------------------------------------------
    {
        const p = parseCommandLine('sh -c "git status && git diff"');
        assertEqual(p.programs, ["sh", "git"], "sh -c: recurses into -c body");
    }

    // --- xargs --------------------------------------------------------------
    {
        const p = parseCommandLine('find . -name "*.tmp" | xargs -r rm -f');
        assertEqual(p.programs, ["find", "xargs", "rm"], "xargs: target program extracted");
    }

    // --- find -exec ---------------------------------------------------------
    {
        const p = parseCommandLine('find . -name "*.log" -exec rm -f {} +');
        assertEqual(p.programs, ["find", "rm"], "find -exec: target program extracted");
    }

    // --- curl | bash --------------------------------------------------------
    {
        const p = parseCommandLine('curl -fsSL https://example.com/install.sh | bash');
        assertEqual(p.programs, ["curl", "bash"], "curl | bash: programs");
        assertTrue(p.segments[1].pipedToShell, "curl | bash: bash segment flagged pipedToShell");
        assertTrue(p.warnings.some(w => w.includes("piped input to a shell")), "curl | bash: warning emitted");
    }

    // --- fork bomb ----------------------------------------------------------
    {
        const p = parseCommandLine(':(){ :|:& };:');
        assertTrue(p.programs.includes(":") || p.programs.length === 0,
            "fork bomb: does not crash, yields no bogus programs");
        const p2 = parseCommandLine('bash -c ":(){ :|:& };:"');
        assertTrue(p2.programs.includes("bash"), "fork bomb in bash -c: outer bash detected");
    }

    // --- heredoc ------------------------------------------------------------
    {
        const p = parseCommandLine('cat <<EOF\nhello world\nEOF');
        assertEqual(p.programs, ["cat"], "heredoc: program is cat");
        assertTrue(p.segments[0].heredoc, "heredoc: heredoc flag set");
        assertTrue(p.warnings.some(w => w.toLowerCase().includes("heredoc")), "heredoc: warning emitted");
    }

    // --- comments -----------------------------------------------------------
    {
        const p = parseCommandLine('ls -la # list everything\npwd');
        assertEqual(p.programs, ["ls", "pwd"], "comment: trailing # comment ignored");
        assertTrue(p.segments[0].comment, "comment: comment flag set on segment");
    }

    // --- redirects ----------------------------------------------------------
    {
        const p = parseCommandLine('go build ./... 2>&1 | tee build.log');
        assertEqual(p.programs, ["go", "tee"], "redirects: 2>&1 does not break parsing");
        assertTrue(p.segments[0].redirects.length > 0, "redirects: redirect recorded on segment 1");
    }

    // --- background & -------------------------------------------------------
    {
        const p = parseCommandLine('tail -f /var/log/syslog &');
        assertEqual(p.programs, ["tail"], "background &: program is tail");
        assertTrue(p.segments[0].background, "background &: flag set");
        assertTrue(p.warnings.some(w => w.includes("background")), "background &: warning emitted");
    }

    // --- env / sudo wrappers ------------------------------------------------
    {
        const p = parseCommandLine('sudo rm -rf /tmp/cache');
        assertEqual(p.programs, ["rm"], "sudo wrapper: target program extracted");
        assertEqual(p.segments[0].program, "rm", "sudo wrapper: segment program is rm");
    }
    {
        const p = parseCommandLine('env FOO=bar npm test');
        assertEqual(p.programs, ["npm"], "env wrapper with assignment: target program extracted");
        assertEqual(p.segments[0].program, "npm", "env wrapper: segment program is npm");
    }

    // --- quoted separators --------------------------------------------------
    {
        const p = parseCommandLine("tree -L 2 -I 'node_modules|.git|vendor'");
        assertEqual(p.stats.segments, 1, "quoted pipe: not treated as separator");
        assertEqual(p.programs, ["tree"], "quoted pipe: single program");
    }

    // --- dangerous classification -------------------------------------------
    {
        assertEqual(classifyProgram("rm").category, "dangerous", "classifyProgram(rm) = dangerous");
        assertEqual(classifyProgram("git").category, "moderate", "classifyProgram(git) = moderate");
        assertEqual(classifyProgram("ls").category, "safe", "classifyProgram(ls) = safe");
        assertEqual(classifyProgram("totally-unknown-cmd").category, "dangerous", "classifyProgram(unknown) fail-closed to dangerous");
        assertEqual(classifyProgram("totally-unknown-cmd").reason, "High risk because this program is unknown", "classifyProgram(unknown) reason");
        assertEqual(classifyProgram("/usr/bin/rm").category, "dangerous", "classifyProgram strips path prefix");
    }

    // --- dangerous command warnings ------------------------------------------
    {
        const p = parseCommandLine('rm -rf node_modules');
        assertTrue(p.warnings.some(w => w.includes("DANGEROUS")), "rm -rf: DANGEROUS warning emitted");
        assertEqual(p.segments[0].risk, "dangerous", "rm -rf: segment risk is dangerous");
    }

    // --- empty / whitespace --------------------------------------------------
    {
        const p = parseCommandLine('');
        assertEqual(p.stats.segments, 0, "empty command: zero segments");
        assertEqual(p.programs, [], "empty command: no programs");
    }
    {
        const p = parseCommandLine('   \n  ');
        assertEqual(p.stats.segments, 0, "whitespace-only command: zero segments");
    }

    // --- multi-line ----------------------------------------------------------
    {
        const p = parseCommandLine('uname -a\ndf -h\nfree -m');
        assertEqual(p.stats.segments, 3, "multi-line: newline splits segments");
        assertEqual(p.programs, ["uname", "df", "free"], "multi-line: all programs detected");
    }

    // --- extractPrograms standalone ------------------------------------------
    {
        assertEqual(extractPrograms('ls && ls'), ["ls"], "extractPrograms: dedupes");
        assertEqual(extractPrograms('bash -c "curl x | sh"'), ["bash", "curl", "sh"], "extractPrograms: deep recursion");
    }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

runAudit();
runUnitTests();

console.log("\n" + "=".repeat(100));
console.log(`SUMMARY: ${passCount} passed, ${failCount} failed`);
console.log("=".repeat(100));

if (failCount > 0) {
    console.log("\nFailures:");
    for (const f of failures) console.log(f);
    process.exit(1);
} else {
    console.log("ALL TESTS PASSED");
}
