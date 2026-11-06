# Tasks

## 1. Protocol: the `ring` hint and coherence rules (Go, TDD)

- [x] 1.1 Red: table-driven tests in `cli/internal/protocol/visual_test.go` for
  `ring` — `"changed"` / `"dependent"` / `"rest"` accepted on map nodes
  (also on a map nested in a compare side); any other value →
  `map.ring.unknown`; `ring` on a sequence actor, timeline lane and compare
  side rejected as unknown field; `ring` composes with `group`, `tier`,
  `focus`, `level` on the same node. Verify: `go test ./internal/protocol/`
  fails on the new cases only.
- [x] 1.2 Green: add `"ring": {"enum": ["changed", "dependent", "rest"]}` to
  the node `$defs` in `protocol/schemas/map.schema.json`, sync the embedded
  copy under `cli/internal/protocol/schemas/`, add `CodeMapRingUnknown` to
  `errors.go` with a fix-it message, and map enum failures at `ring` paths to
  it in `ValidateVisual`. Verify: 1.1 tests pass, `TestSchemasInSync` passes.
- [x] 1.3 Red: tests for ring coherence — one ringed node plus one unringed →
  `map.ring.partial` naming the unringed ids (including when the unringed
  node is standard-only); ringed map with no `changed` node →
  `map.ring.empty`; fully ringed map valid; fully unringed map valid.
  Verify: tests fail.
- [x] 1.4 Green: implement both rules in `validateMap` with `Code*` constants
  and fix-it messages naming the offending ids. Verify: 1.3 tests pass, full
  `go test ./...` green.
- [x] 1.5 Worked-example fixtures: a real ringed golden map in
  `protocol/golden/visuals/map/valid/` (a PR blast radius: changed files in
  the centre, dependents grouped `callers` / `tests` / `configs` via `group`,
  a `rest` ring, edges across rings, at least one standard-only node) and
  invalid fixtures with expected codes for `map.ring.unknown`,
  `map.ring.partial`, `map.ring.empty`. Verify:
  `go test ./internal/protocol/ -run Golden` passes and fails if a fixture's
  expected code is edited.
- [x] 1.6 Document `ring` in `protocol/PROTOCOL.md`: semantics (what each ring
  means, agent computes dependents, no pixels), all-or-nothing coherence,
  the three error codes in the error table. Verify: section present;
  `nibble lint` on the new valid fixture exits 0 and on each invalid fixture
  prints the expected code.

## 2. Reader: ring layout (TS, TDD)

- [x] 2.1 Regenerate reader types from the updated schema (`npm run gen` in
  `reader/`) so `MapNode.ring` exists. Verify: `types.gen.d.ts` diff shows
  `ring`, `npm run build` compiles.
- [x] 2.2 Red: unit tests in `reader/test/map.test.ts` for a pure
  `layoutRingMap` — `isRinged` detection; every node placed inside its
  ring's band (centre / middle / outer); bands labelled and non-overlapping
  nodes at 12 nodes; declaration order within a band; determinism (two runs,
  identical boxes); layout computed from the full document so dial levels
  don't move boxes; unringed maps still routed to the tiered `layoutMap`.
  Verify: `npm test` fails on the new cases only.
- [x] 2.3 Green: implement `layoutRingMap` beside `layoutMap` in
  `reader/src/visual/map.ts` — concentric rectangular bands (changed centre,
  dependents around, rest outer), zone rects + labels as CSS-classed SVG,
  reusing node metrics and `mapEdgeEnds`; `renderMapVisual` picks the layout
  via `isRinged`. Verify: 2.2 tests pass, existing map tests stay green.
- [x] 2.4 Eyeball the golden ringed map (`nibble serve` on a scratch plate or
  the test harness page) in light and dark: zones legible, edges across
  rings not cramped. Verify: screenshot acceptable; adjust band gaps if not.

## 3. Reader: visited tracking and badges (TS, TDD)

- [x] 3.1 Red: host tests — a per-session visited `Set` in `host.ts` exposed
  through `RenderCtx`; selecting an element or opening its code drawer marks
  its id visited; visited survives dial redraws and applies across nibbles
  (same id, two renders); nothing visited-related in the review POST body.
  Verify: `npm test` fails on the new cases.
- [x] 3.2 Green: implement visited state in the host (set + `markVisited` +
  re-badge notification), funnel selection and drawer-open through it.
  Verify: 3.1 tests pass.
- [x] 3.3 Red: map badge tests — unvisited `dependent` nodes carry a badge
  element, visited ones don't; `changed` / `rest` never badged; visiting
  toggles the badge in place (class toggle, no re-layout — box positions
  unchanged); unvisited count ("N of M unvisited") rendered at the
  dependents zone label, updates on visit, reads done at zero; badge state
  correct after a fresh render at overview and standard. Verify: tests fail.
- [x] 3.4 Green: badges + counter in `map.ts` driven by `RenderCtx` visited
  state, re-badging via the host notification. Verify: 3.3 tests pass, full
  `npm test` green.
- [x] 3.5 Rebuild the committed bundle (bundle rebuilt + drift-stable; commit left to the user per their git rules): `npm run build`, commit `app.js`;
  run the Go embed/drift checks. Verify: `go test ./...` in `cli/` green,
  drift job logic (`npm run build` + clean diff) passes locally.

## 4. Skill and worked examples

- [x] 4.1 Teach the PR-review ring map in `cli/skill/claude-code/SKILL.md`:
  when to open a PR plate with a ringed map, how to pick the three rings
  (agent computes callers / importers / tests / configs itself), `group` for
  the dependent taxonomy, all-or-nothing rule and the `map.ring.*` fix-its.
  Verify: section reads as one worked decision, consistent with PROTOCOL.md.
- [x] 4.2 Add a worked ring-map example to `cli/skill/claude-code/examples/`
  (a realistic PR blast radius visual JSON) and wire it into whatever keeps
  examples lint-clean. Verify: `nibble lint` exits 0 on it; skill e2e tests
  (`go test ./internal/cmd/ -run Skill`) green.

## 5. Full suite and docs

- [x] 5.1 Run everything: `go test ./...` in `cli/`, `npm test` and
  `npm run build` in `reader/`, `nibble lint` over `protocol/golden` valid
  fixtures and skill examples. Verify: all green, no drift.
- [x] 5.2 Update the affected `docs/` site pages: roadmap (Blast radius →
  done), PRD shipped note in §"On disk" / decision log ("Blast-radius rings
  are the next item" → shipped, name the next item: not-shown ledger),
  guide/reading.html (how a ringed map reads: three rings, badges, the
  unvisited count), guide/agents.html if it enumerates node hints. Verify:
  pages render locally, no stale "next item" text, theme toggle unaffected.
