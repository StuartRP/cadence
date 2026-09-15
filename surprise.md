# Surprises

Features designated as "surprises" are kept intentionally vague in pull
requests and commit messages so the actual change stays a secret until the app
is used. A deliberately minimal description is chosen per surprise (for
example `logo tweak (check surprise.md for details)`), always pointing
back here.

**This is the one and only surprise file.** A new surprise is appended as a
dated section below; a file is never duplicated or split out. Pushes, PRs, and
commit messages stay minimal and just point here.

---

## 2026-09-15 - Top-bar logo hover reveal

**Shipped in:** PR #10 from branch `SRP` (commits `9133f52`…`f0979e9`+) —
referenced as "logo tweak (check surprise.md for details)" in the PR
description.

**The surprise:** the "<> Cadence" logo in the top bar is interactive.

- Hovering the logo starts a short delay (~700 ms), then the "<" and ">" slide
  apart. As the ">" sweeps rightward it covers the Cadence text, and the app's
  version number appears centred in the space the word used to occupy.
- The version is formatted with the first non-zero part scaled up and the
  rest smaller (`0.` and `.0` small, the `8` of `0.8.0` rendered large). While
  the major number is `0`, the non-zero part carries the emphasis.
- The letters of "Cadence" **hop** in sequence (a small up-and-down bounce,
  left to right) just ahead of the `>` as it slides over them, then fade out
  the moment each is about to be covered.
- Clicking while the reveal is showing **pins** it open, so it stays after the
  mouse leaves. A second click returns the logo to normal.
- It's also keyboard accessible: the logo acts as a button (Enter/Space), the
  chevron slide is skipped under `prefers-reduced-motion`, and quick hover
  in/out never leaves the logo stuck open.
- The word is rendered **bold** (weight 700) so "Cadence" reads punchier in the
  bar.
- On **experimental builds** a small two-tone hammer icon appears just after
  the version number. It's detected purely from `app/version.json`'s
  `"experimental": true` flag (drives `window.code.experimental`, so nothing
  special is needed in the server), and the hammer is drawn as an inline SVG in
  two tones of the same colour as the emphasised digit — a solid head and a
  translucent (45% opacity) handle — both inheriting `--text-primary`, so the
  readability layer keeps it legible on any theme with zero extra wiring.
  Stable builds simply set `experimental: false` and the hammer disappears.
- **Works on any theme:** even a bright-green system theme can't make the
  highlighted version unreadable. The theme pipeline now runs a universal
  readability pass before applying colours — see below.

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

**Readability layer (why the logo can't be unreadable):**

- `app/js/readable-theme.mjs` (new module) — a universal enforcement pass that
  runs inside `applyOmarchyPalette()` (`app/js/omarchy-theme.mjs`) on every
  system theme, **before** any colour reaches the document.
- Pair rules cover text, secondary, muted, and icon foregrounds on their
  surfaces (WCAG thresholds), plus the inverted text used on accents; surfaces
  are never recoloured — only foregrounds that fail contrast are mixed toward
  black or white, and only by the minimal amount that passes.
- The version number specifically is guarded by a `version-text` rule that
  emits `--logo-version-shadow` (a light drop shadow on bright surfaces) rather
  than recolouring, hooked into `#logo .logo-version`'s `text-shadow`.
- `setReadabilityConfig()` is the override surface reserved for the future
  user-themes feature (per-pair or global disable, or overriding a rule's
  mode).

**Implementation notes:**

- `app/images/code-lt.svg` / `code-gt.svg` — the chevron split into two 16x32
  halves (same transform origin as `code-192-simple.svg`).
- `app/js/logo.mjs` (new module) — hover timer, pin toggle, keyboard support,
  reduced-motion handling, version sync, and the letter split (the word is
  broken into per-letter `.logo-letter` spans).
- `app/css/elements.css` — the "Top-bar logo" block: the tag is an
  `inline-flex` box; both chevrons are absolutely positioned with identical
  `top:50%` + `translateY(-50%)` centering so they stay exactly level, ">"
  overlays the word so it can slide across; the `logo-hop` keyframe plus
  per-letter `nth-child` delays ripple the bounce and the fade-out through the
  letters; version text is centred in the reveal.
- The chevron glyphs were scaled up 1.5× inside their 16×32 boxes (same centre,
  so the absolute positioning is untouched, and `>=` folding/edge geometry is
  unchanged) so their painted span runs from a little above the capital C to a
  little below the word's baseline — lining `<`/`>` up with the version number
  instead of floating above it. A stray `-4px` nudge for first-menu images in
  `app/css/main.css:412` was reset to `0` (that rule had been floating the
  chevrons up).
- `app/index.html` — replaced the single logo image + text with
  `ui-inline#logo[role=button]` containing the two chevrons, the word, and the
  version spans.
- `docs/theme-system.md` and `docs/command-execution.md` — the theme-application
  flow, colour pairings, and the command-dispatch flow that this work depended
  on, recorded as living documentation.