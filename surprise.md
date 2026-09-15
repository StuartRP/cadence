# Surprises

Features designated as "surprises" are kept intentionally vague in pull
requests and commit messages — "Small UI update (check surprise.md for
details)" — so the actual change stays a secret until the app is used.

**This is the one and only surprise file.** A new surprise is appended as a
dated section below; a file is never duplicated or split out. Pushes, PRs, and
commit messages stay minimal and just point here.

---

## 2026-09-15 - Top-bar logo hover reveal

**Shipped in:** PR from `SRP` (commit `9133f52`) — referenced as "Small UI
update" in the PR description.

**The surprise:** the "<> Cadence" logo in the top bar is interactive.

- Hovering the logo starts a short delay (~700 ms), then the "<" and ">" slide
  apart. As the ">" sweeps rightward it covers the Cadence text, and the app's
  version number appears centred in the space the word used to occupy.
- The version is formatted with the major number scaled up and the remainder
  smaller (`0.` rendered large, `.8.0` rendered smaller and fainter).
- Clicking while the reveal is showing **pins** it open, so it stays after the
  mouse leaves. A second click returns the logo to normal.
- It's also keyboard accessible: the logo acts as a button (Enter/Space), the
  chevron slide is skipped under `prefers-reduced-motion`, and quick hover
  in/out never leaves the logo stuck open.

**Why:** the app had embedded version strings in three places that could drift
apart (`main_common.go` "0.1.2", `app/version.json` "0.4.2", `app/js/main.mjs`
"0.8.0"). This surprise hides that enough to be fun, and:

- `app/version.json` is now the **single source of truth** for the version
  (`0.8.0`).
- The Go server reads it from the embedded assets at startup, so the startup
  log and the `/up` health check report the same number as the UI.
- `main.mjs` no longer hardcodes a fallback; it resolves from `/version.json`.
- `version_test.go` fails if the server binary's version ever diverges from
  `version.json`.

**Implementation notes:**

- `app/images/code-lt.svg` / `code-gt.svg` — the chevron split into two 16x32
  halves (same transform origin as `code-192-simple.svg`).
- `app/js/logo.mjs` (new module) — hover timer, pin toggle, keyboard support,
  reduced-motion handling, version sync.
- `app/css/elements.css` — the "Top-bar logo" block: the tag is an
  `inline-flex` box; "<" sits in flow, only ">" is absolutely positioned so it
  can slide across the word; version text is centred in the reveal.
- `app/index.html` — replaced the single logo image + text with
  `ui-inline#logo[role=button]` containing the two chevrons, the word, and the
  version spans.