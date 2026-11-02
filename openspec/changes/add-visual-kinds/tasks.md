# Tasks

## 1. Generated types + test harness

- [x] 1.1 Red: `reader/test/` harness — second tsconfig (`module: none`,
  `outFile: test/build.js`) compiling src + tests, `npm test` runs it with
  `node --test`; first test asserts the generated `Visual` union covers the
  four kinds (fails: no generated types yet).
- [x] 1.2 Green: pinned `json-schema-to-typescript` devDependency; `npm run
  gen` → `src/visual/types.gen.d.ts`, post-processed to ambient declarations
  (no `export`) by a small node script; committed. `app.ts` drops the
  hand-written `visual: Record<string, unknown>` for the generated `Visual`.
  Verify: `npm test` and `npm run build` pass.
- [x] 1.3 CI: reader job runs `npm run gen && npm test` before the drift
  diff, so stale generated types fail the build. Verify: job green locally
  via `npm ci && npm run gen && npm test && npm run build && git diff
  --exit-code`.

## 2. Visual host + visual-first cards

- [x] 2.1 Red: host tests — `data-anchor` ids joined to nibble refs (anchored
  ids get the ref index, unanchored get none), selection state machine
  (select → `n<N>:<id>`, clear → `n<N>`).
- [x] 2.2 Green: `src/visual/host.ts` — dispatches a visual to its renderer
  by `kind`, joins `data-anchor` elements to refs, owns selection +
  comment-target string, Escape/background click clears. Shell renders the
  host's SVG as the card body; comment code takes its target from the host.
- [x] 2.3 Visual-first card CSS: active card's visual ≥ 60% of the viewport
  at standard sizes, caption below, refs/`because` in the footer; camera
  still centers correctly after resize. Verify by hand on the golden
  explain-stampede plate (`nibble serve protocol/golden/plates/cli-authored/plate`
  equivalent for explain-stampede), note in PR.

## 3. Map renderer

- [x] 3.1 Red: layout tests — tier columns (edge/service/data, untiered →
  middle), declaration-order tiebreak (deterministic: same input, same
  positions), group adjacency, no overlapping node boxes on the 12-node
  budget fixture.
- [x] 3.2 Green: `src/visual/map.ts` — nodes (label, `detail` on
  hover/selection, `focus` accent ring), edges as curves with per-`style`
  stroke (flow solid, miss dashed warning, weak thin dim) and labels;
  node click highlights node + incident edges, dims the rest, second
  click/elsewhere clears. Verify on `service-map.json` by hand + layout
  tests green.

## 4. Sequence renderer

- [x] 4.1 Red: step-state tests — advance reveals one step at a time,
  current step index emphasized, bounds clamped; actor column order =
  declaration order.
- [x] 4.2 Green: `src/visual/sequence.ts` — lifeline grid, arrows per `kind`
  (call/return/async distinct), `alt` label chips; space and step-click
  advance (camera keeps ← →). Verify on `checkout-request.json`: two
  advances show s1–s2 with s2 emphasized.

## 5. Timeline renderer

- [x] 5.1 Red: axis tests — `at` parsing (offset number and `HH:MM:SS`), one
  linear axis from the union of all states' times (toggling states keeps the
  clock stable), sqrt weight scale with a floor.
- [x] 5.2 Green: `src/visual/timeline.ts` — lanes as rows, events as dots
  sized by weight, scrubber as styled `<input type=range>` (events ≤ cursor
  read happened, later pending), segmented state toggle (default state
  first, redraw on same lanes/clock). Verify on `stampede.json`: scrub to
  12:00:00, toggle jitter on/off.

## 6. Compare renderer

- [x] 6.1 Red: content tests — metric rows aligned across sides by name;
  ref side resolves the nibble ref anchored `@<side-id>` (bare ref text when
  none); sides typed from the generated union.
- [x] 6.2 Green: `src/visual/compare.ts` — two labelled panes + flip control;
  metrics as aligned name/value/unit rows; ref panes fetch code through the
  existing `/api/code` ref index with trust badge; nested-map panes reuse the
  map renderer. Verify on `ttl-fix.json` + `latency-metrics.json` via the
  golden plate.

## 7. Anchors, drawer and comments wired through

- [x] 7.1 Red: join tests — anchored element activation yields the right
  (n, ref index) for the drawer; selected element yields `n<N>:<id>` on the
  pending comment; cleared selection falls back to `n<N>`.
- [x] 7.2 Green: code affordance on anchored elements opens the drawer at the
  ref's validated lines; comment pinning uses the host's target. Verify on
  the golden plate: click `@cache` node → drawer; pin comment on it →
  pending shows `n1:cache`.

## 8. Integration, embed and docs

- [x] 8.1 Rebuild + commit `app.js` (and style.css), confirm the Go embed
  serves the new shell: `go test ./...` in `cli/` stays green, by-hand pass
  over the explain-stampede golden plate covering all four kinds (document
  in PR notes).
- [x] 8.2 Docs/site: roadmap flips Visual kinds to done; guide reading page
  shows the real visuals (replace stand-in wording); PRD status note updated
  (per-kind rendering shipped, next item named); reader/README or
  cli/README note for `npm run gen`.

## Workflow follow-up

- Archive this change after implementation (`/opsx:archive add-visual-kinds`),
  syncing the reader delta specs into the main specs.
