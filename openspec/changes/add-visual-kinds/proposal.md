# Proposal

## Why

The reader shell ships with stand-in cards: a nibble's visual renders as a
typed summary ("map · 5 nodes · 6 edges") with a note that per-kind rendering
is coming. The whole point of nibble is the picture — the PRD calls the
visual the primary surface (R1: ≥ 60% of the window; R3: the four kinds with
built-in interactions), and the PRD status note names per-kind rendering as
the next item. Until the four v1 kinds actually draw, a plate is captions
plus code, and nothing downstream (the skill's worked examples, detail dial,
blast radius) has a surface to land on.

## What Changes

- The reader renders each v1 visual kind as interactive SVG, laid out by the
  reader from the declarative document (agents still describe meaning, never
  pixels):
  - **map** — nodes and edges; `tier` and `group` drive placement, `focus`
    draws the eye, edge `style` (`flow`/`miss`/`weak`) is visually distinct.
    Clicking a node highlights it and its edges.
  - **sequence** — lifelines and messages; stepping walks the steps one at a
    time (space / click), `call`/`return`/`async` arrows differ, `alt`
    branches are labelled.
  - **timeline** — lanes on one clock with a scrubber; event `weight` shows
    as emphasis; precomputed `states` are toggleable, the `default` state
    shown first ("scrub time, toggle the fix" — P0 in the PRD kinds table;
    v0.2's what-if item generalises toggles beyond timelines).
  - **compare** — before/after sides for all three content types (ref,
    nested map, metrics), with a flip/slider interaction.
- Anchor click-through (R4): clicking an element whose id a ref anchors
  (`@cache`) opens the code drawer at that ref's validated lines.
- Anchored comments: selecting an element pins the comment input to
  `n<N>:<anchor>` — the target grammar `review.json` already accepts — so
  comments land on nodes, steps, events and sides, not just nibbles.
- Canvas-first layout (R1): the visual becomes the card's body (≥ 60% of the
  window at standard size), caption below, code stays in the drawer.
- Visual TS types are generated from `protocol/schemas/*.json` (pinned
  generator, committed output, CI drift check) — closing the decision-log
  rule that nothing protocol-shaped is hand-written twice; the shell's
  hand-written `visual: Record<string, unknown>` goes away.

Out of scope (own roadmap items / v0.2): detail dial (R12), blast-radius
rings (R14/R16), not-shown ledger (R17), the `state`/`data`/`chart` kinds
(R8), visual requests (`v`, R13), voice walk, generic what-if toggles on
other kinds (R9).

## Capabilities

### New Capabilities

- `reader/visual-kinds`: how the reader renders and wires the four v1 visual
  kinds — layout from semantic hints, per-kind interactions, anchor
  click-through to code, anchored comment targets, and the generated-types
  build contract.

### Modified Capabilities

- `reader/ui-shell`: "One canvas, a camera" currently states that per-kind
  rendering is a later change and the card stands in for it — that carve-out
  is removed (the card's body is now the rendered visual); "Comments and
  verdict" gains anchored targets (`n<N>:<anchor>`) alongside plain `n<N>`.

## Impact

- `reader/` — the bulk: per-kind SVG renderers, interactions, generated
  types, new build step (`npm run gen` or part of `build`); `app.js` and the
  generated types are committed, embedded via the existing `go:embed` path.
- `cli/internal/cmd/ui/` — embedded `app.js`/`style.css` refresh; Go code
  itself unchanged (the API already serves visuals verbatim and accepts
  `n<N>:<anchor>` targets).
- CI — the existing reader drift job also guards the generated types.
- Protocol and Go server: no changes. Golden fixtures already cover all four
  kinds (`protocol/golden/visuals/*/valid`) and the `explain-stampede` golden
  plate exercises them end to end.
- Docs/site — roadmap item flips to done; guide pages gain the real visuals.
