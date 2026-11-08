# Tasks

## 1. Vendor the highlighter

- [x] 1.1 Write `reader/scripts/vendor-hljs.mjs`: fetch upstream's official
      common-languages build verbatim at a pinned version (license header is
      in the file) to `cli/internal/cmd/ui/highlight.min.js`, failing loudly
      on a hash mismatch; run it; verify `node -e` can evaluate the file in
      global scope and `hljs.getLanguage("go")` is truthy for every mapped
      language
- [x] 1.2 Load the UI with the bundle: script tag in
      `cli/internal/cmd/ui/index.html` before `app.js`, and the node test
      runner `reader/test/run-node.cjs` (npm test becomes
      `tsc -p test && node test/run-node.cjs`) evaluating the vendored
      bundle then `build.js`; verify the existing reader suite still passes
      under the new runner

## 2. The highlight module (TDD against the real grammars)

- [x] 2.1 Red: create `reader/test/highlight.test.ts` with failing tests for
      `langOf(path)` — every mapped extension from design D4 and the plain
      fallback for unknown extensions — adding `src/highlight.ts` + the test
      file to both tsconfig `files` lists; verify `npm test` fails for the
      expected reason, then green: implement `langOf`; verify `npm test`
      passes
- [x] 2.2 Red→green: `highlightLines(path, lines)` — whole-excerpt
      highlight, per-line split with span rebalancing, plain escaped
      fallback for unknown languages and for a missing `hljs` global (the
      spec's "Unknown language stays plain" scenario, `&`/`<`/`>` escaping
      on every path); fixture lines lifted from real code (this repo and
      docs/demo/repo as worked examples); verify the new tests pass
- [x] 2.3 Red→green: the spec's language scenarios as tests — Go `//`
      comment vs the same text under `.py` ("Language follows the file
      path"), CSS `#fff` not a comment but `/* brand */` yes, YAML `#`
      comment, SQL `--` comment, Markdown heading — and the cross-line
      scenarios: `/* */` across lines, Go backtick raw string, Python
      triple-quoted string, each line of the construct colored, state clean
      per `highlightLines` call ("Elision resets state"); verify tests pass

## 3. Wire the call sites

- [x] 3.1 Red: a test asserting the same line highlights differently under
      `.go` and `.py` paths via the module the drawer uses, then green:
      delete `highlightCode`, `HL_KEYWORDS` and `hlEsc` from
      `reader/src/visual/host.ts`; switch the drawer and the ledger drawer
      in `reader/src/app.ts` to `highlightLines(c.path, ...)`, calling once
      per contiguous segment in the ledger drawer; verify the full reader
      suite passes
- [x] 3.2 Compare ref panes: add `path` to the local `/api/code` response
      type in `reader/src/visual/compare.ts` and render through
      `highlightLines` (the spec's "Every code surface highlights alike"
      scenario); verify the compare tests and full suite pass
- [x] 3.3 Map hljs token classes onto the existing theme variables in
      `cli/internal/cmd/ui/style.css`, dropping the old
      `.kw/.fn/.str/.num/.cm` rules once nothing emits them; verify both
      themes color drawer code when serving a plate locally

## 4. Build, integration, docs

- [x] 4.1 Rebuild the committed bundle (`npm run build` in `reader/`),
      update the "no runtime deps" wording to minimal-dependencies in
      `reader/package.json`; verify `cli` tests pass (`go test ./...`) and a
      locally served plate shows per-language coloring on a `.go` and a
      `.ts` ref
- [x] 4.2 Update the affected site pages in docs/: copy the rebuilt
      `app.js`, `style.css` and `highlight.min.js` to `docs/visuals/`, add
      the script tag to `docs/visuals/reader.html`, and mark the "Syntax
      highlighting" item done in `docs/roadmap.html`; verify the live-demo
      page renders highlighted drawer code when opened locally

## Workflow follow-up

- Archive the change after merge (`openspec archive add-syntax-highlighting`)
  and sync its delta spec into the main specs.
