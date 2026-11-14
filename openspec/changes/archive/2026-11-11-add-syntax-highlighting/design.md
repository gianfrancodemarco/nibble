# Design

## Context

See proposal.md — Why. The mechanics that shape the approach:

- The reader builds with `tsc` only, `module: none`, every source file
  concatenated into one `app.js` (`reader/tsconfig.json` `files` list) —
  globals, no imports, no npm runtime deps. The node test build compiles the
  same sources plus the test files into `reader/test/build.js`, run by plain
  `node`.
- Today's highlighter is `highlightCode(line)` in
  `reader/src/visual/host.ts:118`: one regex, one global keyword set,
  per-line, no language, no state. It is called from three places:
  the drawer and the ledger drawer in `reader/src/app.ts`, and the compare
  ref panes in `reader/src/visual/compare.ts`.
- All three call sites already have the file path: `CodeResponse.path`,
  the ledger response's `path`, and compare's `/api/code` response (the
  field is served; compare's local type just doesn't name it yet).
- `//go:embed ui` in `cli/internal/cmd/http.go` embeds the whole ui
  directory, so a new file next to `app.js` is served without Go changes.
- Token CSS theme variables `--kw`, `--fn`, `--str`, `--num`, `--cm` exist
  in both light and dark.

## Goals / Non-Goals

Goals:

- Grammar-correct per-language highlighting via a vendored, pinned
  highlight.js bundle (decided with the user over a hand-rolled tokenizer:
  battle-tested grammars beat owning lexer rules).
- One pure, DOM-free module owning the seam: language resolution from a
  path, whole-excerpt highlighting, per-line HTML out — testable in the
  node build against the real vendored grammars.
- Keep the build contract: no bundler, no npm runtime dependency,
  `go install` needs no Node. "No deps" claims in prose become "minimal
  dependencies".

Non-Goals (beyond the proposal's out-of-scope list):

- No language auto-detection from content; the path decides, full stop.
- No use of highlight.js private/continuation APIs: state across lines
  comes from highlighting each contiguous excerpt as one string.

## Decisions

**D1 — Vendor highlight.js as one committed file, verbatim.**
`cli/internal/cmd/ui/highlight.min.js` is upstream's official
common-languages build (a plain `var hljs=…` global, license header
included), fetched byte-identical at a pinned version by
`reader/scripts/vendor-hljs.mjs` — provenance is a hash away. v11 publishes
no classic core-only build, so curation happens in the reader's
path→language map, not the bundle. Alternatives: npm runtime dependency
(breaks the no-Node `go install` contract), concatenating ES-module
per-language files (needs a fragile export-stripping transform),
per-language lazy loading from CDN (network dependency in a local-first
tool), hand-rolled tokenizer (rejected with the user: grammar quality
wins).

**D2 — A new `reader/src/highlight.ts`, shaped like `live.ts`.** Pure,
DOM-free, added to both tsconfig `files` lists, tested by
`reader/test/highlight.test.ts`. `host.ts` loses its `highlightCode`,
keyword set and `hlEsc`. API: `highlightLines(path: string, lines:
string[]): string[]` — join the excerpt with `\n`, one
`hljs.highlight(text, { language, ignoreIllegals: true })` call, split the
returned HTML back into lines. `langOf(path)` is exported for tests. If
`hljs` is missing or the language unknown, every line comes back plainly
escaped — the page never breaks on a lost script.

**D3 — Per-line split with span rebalancing.** hljs emits flat
`<span class="hljs-…">` markup with newlines intact. The splitter walks the
highlighted string, tracks open spans, closes them at each newline and
reopens them on the next line — the standard technique, ~30 lines, unit
tested. This gives the spec's cross-line behavior (a multi-line construct
is one token spanning the join) and, because call sites highlight one
contiguous segment per call, elided gaps reset state by construction.

**D4 — Language resolution by extension in our code, not hljs autodetect.**
`.go`→go, `.ts/.tsx/.js/.jsx/.mjs/.cjs`→typescript/javascript, `.py`→python,
`.json`→json, `.yaml/.yml`→yaml, `.md`→markdown, `.sh/.bash/.zsh`→bash,
`.css`→css, `.html/.htm/.xml`→xml, `.sql`→sql; anything else → plain
escaped text. Autodetect is rejected: wrong guesses are worse than plain,
and the path is authoritative.

**D5 — Map hljs token classes onto the existing five theme variables.**
A small `style.css` block colors `.hljs-keyword`-family with `--kw`,
title/attr/property with `--fn`, strings with `--str`, numbers/meta with
`--num`, comments with `--cm`; the old `.kw/.fn/.str/.num/.cm` rules are
dropped once nothing emits them. No hljs theme stylesheet is imported.

**D6 — The node test runner loads the vendored bundle.** `npm test` becomes
`tsc -p test && node test/run-node.cjs`, a tiny loader that evaluates
`highlight.min.js` in global scope (the file's `var hljs` then lands on
`globalThis`, exactly as a browser `<script>` does) and then runs
`test/build.js`, so highlight tests assert against the real grammars (CSS
`#fff`, Go raw strings, YAML comments) instead of mocks.

**D7 — Compare panes reuse the shell's renderer via the response path.**
`compare.ts` adds `path` to its local response type and passes it through.
No visual-schema change: the path never enters the plate JSON; it rides the
API response the pane already fetches.

## Risks / Trade-offs

- [~60–80KB of vendored third-party minified JS in the repo] → Pinned,
  license-headered, regenerated only by the committed script; it is a
  static asset like a font, not a build input.
- [hljs grammar output classes could change on upgrade] → The version is
  pinned; an upgrade is a deliberate re-vendor that reruns the highlight
  tests.
- [An excerpt can start mid-construct (e.g. inside a block comment opened
  above the served range)] → Accepted: the opening line is outside what the
  server returns; this matches the spec (state across *served* lines) and
  what viewport highlighters get wrong too.
- [The script tag could fail to load (packaging mistake)] → `highlight.ts`
  guards on a missing `hljs` and falls back to escaped plain text; a unit
  test covers the fallback.
- [app.js and the vendor file are committed in several places (cli,
  docs/visuals); copies can drift] → The existing CI drift check covers
  cli's app.js; the tasks end with the standard docs-sync step.

## Migration Plan

Pure front-end change: vendor the bundle, rebuild `app.js`, commit,
regenerate the docs copies. Rollback is reverting the commit. No data,
protocol or API migration.

## Open Questions

None.
