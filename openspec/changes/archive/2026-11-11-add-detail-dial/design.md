# Design

## Context

See proposal.md for motivation. What exists today: the four visual JSON
Schemas (`protocol/schemas/*.schema.json`) are embedded in the Go binary and
shape-check every visual; cross-field rules with specific error codes live in
per-kind Go validators (`cli/internal/protocol/visual.go`), following the
`findUnknownFields` pattern that maps a schema violation to a protocol error
code. Golden fixtures under `protocol/golden/visuals/<kind>/{valid,invalid}`
drive conformance in both the Go suite and the reader. The reader has one
renderer module per kind (`reader/src/visual/*.ts`) plugged into a host, with
types generated from the schemas by `reader/scripts/gen-types.mjs`. The PRD's
§6.2 demo is the visual reference: levels are layers drawn over a stable base.

## Goals / Non-Goals

**Goals:**

- One additive, backward-compatible protocol field; every existing plate and
  golden file stays valid and byte-identical.
- Level semantics owned entirely by the Go CLI (validation) and expressed
  declaratively; the reader only filters what it draws.
- Positions stable across levels — the dial must read as layers, not as two
  layouts.

**Non-Goals:**

- No deep level, no on-demand layers, no caption variants, no per-nibble dial
  (proposal, Out of Scope).
- No URL/state persistence of the dial position across sessions — it resets
  to standard on load.

## Decisions

**1. `level` is a per-element enum, `["standard"]` in v1.**
An optional `"level": "standard"` on map nodes/edges, sequence steps, timeline
lanes/events. Absent means overview (drawn everywhere) — so unlevelled
documents degrade to overview == standard, which is what makes the change
backward compatible. Alternatives rejected: a boolean (`"detail": true`) reads
worse and dead-ends when deep arrives — extending an enum is additive; a
per-nibble level contradicts "layers on the same canvas"; an
`overview: true` default-hidden polarity would break every existing plate.
Nested maps inside a `compare` side are maps and accept `level` like any map;
events inside timeline `states` are events, and the lane-coherence rule
applies to each state's event set independently.

**2. Error codes follow the existing split.**
The schemas gain the enum (so generated TS types say `"standard"`, not
`string`). A schema enum failure at a `level` path is translated to
`visual.level.unknown` by walking the `ValidationError` tree, exactly as
`findUnknownFields` already does for `additionalProperties`. The coherence
rules (`map.edge.level`, `timeline.event.level`, `visual.overview.empty`) go
in the per-kind semantic validators, where dangling-reference checks already
live. New `Code*` constants in `errors.go`, each with a fix-it message.

**3. The reader filters a computed layout; it never re-lays-out.**
Each renderer computes geometry from the full document (as today) and takes
the active level as an input, skipping standard-only elements at draw time.
This makes position stability free — there is no second layout to diverge.
Interaction state (sequence step index, timeline cursor) indexes the drawn
subset, so stepping at overview visits only overview steps. The host owns one
plate-wide `level` value, re-renders all cards when it flips, and applies it
to cards created later from the event stream.

**4. Dial UI: a two-position control in the chrome, `d` to toggle.**
R7 reserves ← → / space / e / c / v / s / q; `d` is free and mnemonic. The
control shows both labels with the active one marked (the PRD demo's range
slider collapses to a two-state toggle while deep doesn't exist). Default
standard, per the PRD ("this is what a plate opens at"). On flip, if the
selected element is no longer drawn the host clears the selection and the
comment target falls back to `n<N>` — the same fallback that already exists
for clearing a selection.

**5. Fixtures are the worked examples.**
New golden files: one levelled valid visual per levelled kind (map, sequence,
timeline) and invalid fixtures for each new code under
`protocol/golden/visuals/*/invalid/`. The skill's worked examples gain a
levelled visual with guidance on what belongs in the overview (the claim)
versus standard (the mechanism).

## Risks / Trade-offs

- [Overview can look sparse — layout keeps standard's spacing with elements
  missing] → Accepted: stability is the point; the PRD demo shows exactly
  this. Revisit only if dogfooding shows unreadable overviews.
- [Agents may under-use levels, shipping flat visuals] → The skill teaches
  layering with a worked example; `visual.overview.empty` catches the
  opposite failure (nothing left at overview). No lint nag for "no levels":
  a small visual legitimately needs none.
- [Schema enum + Go code-mapping could drift (enum grows, mapping forgotten)]
  → The golden `invalid` fixture for `visual.level.unknown` pins the
  behavior; schemas are embedded and sync-tested already.

## Migration Plan

Purely additive protocol change within version 1: old readers ignore unknown
fields per the plate-format spec, old plates carry no `level` and render
unchanged. No migration steps; rollback is reverting the change.

## Open Questions

None.
