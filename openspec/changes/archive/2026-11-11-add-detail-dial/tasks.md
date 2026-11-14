# Tasks

## 1. Protocol: the `level` field and its rules (Go, TDD)

- [x] 1.1 Red: table-driven tests in `cli/internal/protocol/visual_test.go` for
  `level` — accepted on map node/edge, sequence step, timeline lane/event
  (including an event inside a `states` entry and a map nested in a compare
  side); `"deep"` and other values rejected with `visual.level.unknown`;
  `level` on a compare side and on a sequence actor rejected as unknown
  field. Verify: `go test ./internal/protocol/` fails on the new cases only.
- [x] 1.2 Green: add `"level": {"enum": ["standard"]}` to the element `$defs`
  in `protocol/schemas/{map,sequence,timeline}.schema.json`, sync the
  embedded copies under `cli/internal/protocol/schemas/`, add
  `CodeVisualLevelUnknown` to `errors.go` with a fix-it message, and map
  enum failures at `level` paths to it in `ValidateVisual` (alongside
  `findUnknownFields`). Verify: 1.1 tests pass, `TestSchemasInSync` passes.
- [x] 1.3 Red: tests for level coherence — unlevelled map edge touching a
  standard-only node → `map.edge.level`; unlevelled timeline event in a
  standard-only lane → `timeline.event.level` (also inside a state's event
  set); all level-capable elements standard-only → `visual.overview.empty`;
  standard-only edge between overview nodes and fully unlevelled documents
  stay valid. Verify: tests fail.
- [x] 1.4 Green: implement the three rules in `validateMap` /
  `validateTimeline` / shared overview-empty check, with new `Code*`
  constants and fix-it messages naming the offending ids. Verify: 1.3 tests
  pass, full `go test ./...` green.
- [x] 1.5 Worked-example fixtures: add levelled valid golden visuals —
  `protocol/golden/visuals/map/valid/` (a PRD-§6.2-style layered map),
  `sequence/valid/`, `timeline/valid/` — and invalid fixtures with expected
  codes for `visual.level.unknown`, `map.edge.level`,
  `timeline.event.level`, `visual.overview.empty`. Verify:
  `go test ./internal/protocol/ -run Golden` passes and fails if a fixture's
  expected code is edited.
- [x] 1.6 Document `level` in `protocol/PROTOCOL.md`: semantics (minimum dial
  level, absent = overview), the v1 enum with `deep` reserved, the coherence
  rules and error codes. Verify: section present; `nibble lint` on the new
  valid fixtures exits 0 and on each invalid fixture prints the expected
  code.

## 2. Reader: level-aware rendering (TS, TDD)

- [x] 2.1 Regenerate `reader/src/visual/types.gen.d.ts` with
  `reader/scripts/gen-types.mjs` so elements carry `level?: "standard"`.
  Verify: generated file includes the field; `tsc` clean; CI drift check
  logic (`npm run` equivalent) reports no drift after commit of generated
  output.
- [x] 2.2 Red: renderer tests — at overview a standard-only map node and its
  edges are not drawn while remaining elements keep the exact geometry they
  have at standard; sequence stepping at overview visits only overview
  steps; timeline scrubber/states ignore hidden events; hidden elements are
  not selectable and expose no code marker. Verify: new tests fail.
- [x] 2.3 Green: thread an active-level input through the per-kind renderers
  (`map.ts`, `sequence.ts`, `timeline.ts`); layout computes from the full
  document, draw-time filtering skips standard-only elements. Verify: 2.2
  tests pass.
- [x] 2.4 Red: host/shell tests — plate opens at standard; `d` toggles
  overview/standard for every card without moving the camera; a nibble
  arriving over the event stream renders at the active level; flipping the
  level clears a selection whose element left the drawn set (comment target
  falls back to `n<N>`) and preserves one whose element remains. Verify:
  tests fail.
- [x] 2.5 Green: add the plate-wide level state and the two-position dial
  control to the shell chrome (active label marked), `d` key binding, re-render
  on flip, selection fallback. Rebuild and commit `app.js`. Verify: 2.4 tests
  pass; full reader test suite green; no drift between src and committed
  `app.js`.
- [x] 2.6 End-to-end check: `nibble serve` a plate built from the new levelled
  golden fixtures and confirm in the browser — opens at standard, `d` flips
  to overview with stable positions, live nibble respects the dial. Verify:
  manual walkthrough done; `go test ./...` (e2e suite) green.

## 3. Skill and site

- [x] 3.1 Teach the dial in `cli/skill/claude-code/SKILL.md` and add a
  levelled worked example under `cli/skill/claude-code/examples/` (what
  belongs at overview — the claim — versus standard — the mechanism),
  keeping examples lint-clean. Verify: `nibble lint` passes on every skill
  example; skill text references the real field name and codes.
- [x] 3.2 Update affected `docs/` site pages: the user guide's reading page
  (the dial, the `d` key), the PRD/roadmap status if they list the dial as
  pending, and the live demo data if it should show a levelled visual.
  Verify: pages render locally (open in browser) and describe the shipped
  two-level dial.
