# Design

## Context

See proposal.md for motivation. What shapes the approach:

- All protocol logic lives once, in Go (`cli/internal/protocol/visual.go`,
  ~400 lines, a hand-rolled strict validator mirrored by the JSON Schemas in
  `protocol/schemas/` and the golden suite in `protocol/golden/visuals/`).
- The reader is pure presentation. `reader/src/visual/map.ts` computes a
  tiered-column layout in a pure function (`layoutMap`, unit-tested in
  `reader/test/map.test.ts`), renders SVG on top, and registers with the host
  (`host.ts`), which owns selection, the code chip and dial redraws.
  TS visual types are generated from the schemas into `types.gen.d.ts`;
  `app.js` is committed and drift-guarded.
- The detail dial already established the pattern this change follows:
  layout from the full document, the dial (and now badges) only toggling
  presentation on fixed positions.
- The host redraws visuals from scratch on dial changes and selection is
  host-owned — so any per-session state (visited ids) must live outside the
  rendered SVG.

## Goals / Non-Goals

**Goals:**

- One new semantic hint (`ring`) and two coherence rules, specified and
  enforced in Go, mirrored in the JSON Schema, covered by goldens.
- A concentric ring layout as a second pure-layout path in `map.ts`, chosen
  per document, never mixed with the tiered layout.
- Visited tracking as reader-session state shared across renders of the same
  plate, surfaced as badges and a count.

**Non-Goals:**

- No dependency analysis anywhere in nibble (the agent declares rings).
- No new visual kind — a ringed map is still `kind: "map"`, same anchors,
  same comments, same dial semantics.
- No persistence of visited state (no localStorage: a reader session is one
  tab on one served plate; review submission locks the plate anyway).

## Decisions

**D1 — `ring` is a node hint on `map`, not a new visual kind.**
A blast-radius map still wants everything maps have: edges with styles,
groups, anchors, the dial. A new kind would duplicate all of it. Alternative
considered: a top-level `rings: {...}` section mapping ring → node ids —
rejected because every existing semantic hint (`tier`, `group`, `focus`,
`level`) is per-node, and per-node reads better in fixtures and diffs.

**D2 — all-or-nothing rings per map.**
A half-ringed map has no honest rendering: where does an unringed node sit?
Forcing the agent to place every node keeps the picture truthful and the
layout total. `map.ring.partial` names the unringed ids so the fix-it is
mechanical. Alternative: default unringed nodes to `rest` — rejected; an
agent forgetting a node would silently demote it to "unaffected", which is
exactly the lie blast radius exists to prevent.

**D3 — the agent computes dependents; `group` carries the taxonomy.**
The PRD's "callers, importers, tests, configs" is what the agent should put
in the dependent ring, not a protocol enum. The existing `group` hint already
clusters nodes visually, so `group: "tests"` on dependent nodes gives the
taxonomy for free. Alternative: a `role` enum on dependents — rejected as a
second overlapping grouping mechanism; revisit only if real plates need
machine-readable roles.

**D4 — ring layout: concentric rectangular bands, not circles.**
Layout stays a pure function beside `layoutMap` (e.g. `layoutRingMap`),
selected by `isRinged(v)`. Changed nodes cluster in a centre band; dependents
wrap around them; rest nodes form the outer band. Rectangular bands keep node
boxes, edge routing (`mapEdgeEnds`) and the existing label metrics reusable,
and read better than circles at 12 nodes in a wide canvas. Zones are drawn as
labelled rounded rects behind the nodes (`changed` / `dependents` / `rest`),
styled by CSS class only — same discipline as `tier` columns. Determinism:
declaration order within a ring, exactly like columns today.

**D5 — visited state lives in the host, keyed by element id.**
The host already owns cross-render concerns (selection, dial level) and
rebuilds SVG on every dial flip, so visited ids must survive outside the
visual: a per-session `Set<string>` of visited element ids in `host.ts`,
passed to renderers through `RenderCtx` alongside `level`, with a
`markVisited` callback and a notification to re-badge in place (class
toggles, no re-render). Selection → visited and drawer-open → visited both
funnel through the host, which already sees both events. Scoping by element
id across the whole plate (not per nibble) is deliberate: the same file node
on two nibbles is the same thing looked at once.

**D6 — the unvisited count renders inside the map SVG.**
As part of the ringed map (a small counter pinned to the dependents zone
label, e.g. "2 of 4 unvisited"), not as shell chrome. Keeps the change inside
`visual-kinds` (no `ui-shell` delta), and the count is only meaningful next
to the ring it describes. It updates via the same re-badge path as D5.

**D7 — schema and Go stay mirrored; goldens are the contract.**
`map.schema.json` gains `ring` with the enum (schema-level `map.ring.unknown`
via enum violation); the coherence rules (`map.ring.partial`,
`map.ring.empty`) live in Go like other cross-field rules (`map.edge.level`,
level coherence), documented in PROTOCOL.md's error table, each with a valid
and invalid golden fixture. TS types regenerate from the schema, so
`MapNode.ring` appears in the reader for free.

## Risks / Trade-offs

- [Edge routing across rings may look worse than across columns — curves
  crossing zone borders] → reuse `mapEdgeEnds`' side-picking, verify on the
  golden ringed map with edges in all directions; adjust band gaps, not the
  router, if cramped.
- [Visited-on-selection may feel too eager — a stray click "counts" as
  review] → acceptable for v0.1 and honest to R16's wording ("unvisited"
  = never looked at); the badge is an attention aid, not an attestation.
  Revisit with real dogfooding feedback.
- [12-node budget may be tight for real PRs once three rings each need
  members] → out of scope here; chapter flow (v0.2) is the designed answer
  for big PRs, and the budget keeps ring maps readable.
- [Re-badging in place (class toggles) can drift from a full re-render] →
  the badge is derived from one `Set` in one place; the map test suite
  asserts badge state both after initial render and after visit events.

## Open Questions

None.
