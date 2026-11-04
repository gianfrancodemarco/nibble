# Design

## Context

See proposal.md — Why. The shell (reader/src/app.ts, 344 lines) renders
visual stand-in cards from `visual: Record<string, unknown>`; everything
else (API, camera, drawer, review, SSE) already works and does not change.
Build is pinned tsc, `module: none` + `outFile` → one committed
`cli/internal/cmd/ui/app.js` embedded by Go; no bundler, no runtime deps,
CI fails on drift. Golden fixtures cover all four kinds; the
`explain-stampede` golden plate has one nibble per kind and serves straight
from the checkout — it is the by-hand test plate.

Constraints that shape the design: the reader is pure presentation (Go owns
protocol logic; the reader never validates); agents describe meaning, never
pixels, so every layout decision is the reader's; TS types for anything
protocol-shaped must be generated from the JSON Schemas.

## Goals / Non-Goals

**Goals**
- Four renderers (map, sequence, timeline, compare) producing inline SVG,
  interactive, deterministic, themed by the existing stylesheet.
- One small "visual host" seam between the shell and the renderers: card
  body in, selection/anchor/comment-target events out. The v0.2 kinds
  (state, data, chart) plug into the same seam.
- Generated visual types replacing the hand-written `visual` shape.

**Non-Goals**
- No Go/server changes; no protocol or schema changes.
- No layout for documents beyond the budgets (maps cap at 12 nodes — the
  layout need not scale past that).
- No persistence of visual state (step position, scrub cursor, chosen
  what-if state reset on reload; they are reading aids, not data).
- Detail dial, blast radius, not-shown ledger, visual requests: later items,
  not pre-architected here beyond the host seam.

## Decisions

**D1 — Hand-rolled SVG renderers, no libraries.** A layout/chart dependency
(dagre, d3) would be a runtime dep and need a bundler, both banned by the
ui-shell spec. Budgets make this tractable: ≤12 map nodes, sequences and
timelines sized for one screen. Each renderer is a pure function
`(visual, ctx) → SVGElement` plus delegated event handlers.

**D2 — File layout: one file per kind, tsc concatenation.** `module: none`
+ `outFile` already concatenates every included file into app.js in include
order, sharing one global scope — so renderers split into
`src/visual/{host,map,sequence,timeline,compare}.ts` with no import
machinery and no build change beyond the `include` list.

**D3 — Map layout: tier columns, group bands, deterministic.** Nodes place
into three columns by `tier` (`edge`→left, `service`→middle, `data`→right;
untiered nodes into the middle), vertically in declaration order with
`group` members kept adjacent and banded. Edges route as curves between
node boxes; `style` maps to stroke (flow solid, miss dashed+warning colour,
weak thin/dimmed); `focus` gets the accent ring. Declaration order is the
only tiebreaker, which gives determinism for free. Alternative considered:
force-directed layout — rejected (nondeterministic, unneeded at ≤12 nodes).

**D4 — Sequence: classic lifeline grid.** Actors as columns in declared
order, steps as horizontal arrows top-to-bottom. Step state is an index;
space/click advances it (shell's space key currently free; ← → stay with
the camera per R7). `kind` maps to arrowhead/dash; `alt` renders as a small
label chip on the arrow. Fully-stepped is the initial state for a sealed
plate being re-read? No — initial state is step 0 everywhere: consistent,
and re-readers can hold space.

**D5 — Timeline: one time axis, scrubber as a range input.** Parse `at` as
either a number (offset) or `HH:MM:SS`; map to one linear axis across all
lanes and states (union of times, so toggling states keeps the clock
stable). `weight` maps to dot area on a sqrt scale with a floor. The
scrubber is a styled `<input type=range>` over the axis — free keyboard
support and a11y. States render as a segmented toggle above the axis;
default state first.

**D6 — Compare: two labelled panes + a flip.** Sides render as two equal
panes with their labels; a flip control (and the slider affordance where
panes are code) shifts emphasis. Content renderers: metrics → aligned
name/value/unit rows computed across both sides; ref → the code of the
nibble ref anchored `@<side-id>` fetched from the existing `/api/code`
(reuses drawer plumbing), else the bare ref text; nested map → the D3 map
renderer at pane size. No new endpoint: the anchor convention is already
how the golden plates wire compare sides to code.

**D7 — Anchor/selection wiring lives in the host, not the renderers.**
Renderers mark elements with `data-anchor="<id>"`. The host joins them with
the nibble's refs: anchored ids get the code affordance (opens the drawer
via the existing ref index), any element click sets the selection and the
comment target (`n<N>:<id>`), Escape/background click clears it. The shell's
comment code changes only in where the target string comes from.

**D8 — Types generated to an ambient declaration file.** Pinned
`json-schema-to-typescript` devDependency; `npm run gen` writes
`src/visual/types.gen.d.ts`, post-processed by a small node script into
ambient declarations (no `export`, so it works under `module: none`).
Committed; the existing CI reader job adds `npm run gen` before the drift
diff. app.ts's hand-written `visual: Record<string, unknown>` becomes the
generated union `Visual`. Plate/review/code API types stay hand-written
(they are server response shapes, not protocol schema files).

**D9 — Card sizing flips from text-first to visual-first.** Cards get a
viewport-relative size (visual ≥ 60% of the window on the active card at
standard sizes, per R1), caption beneath, `because` and refs in the footer.
The camera math already recomputes on render/resize and needs no change
beyond the new card widths.

## Risks / Trade-offs

- [Hand-rolled layout looks cramped on hostile-but-valid documents (12
  nodes, long labels)] → budgets cap the worst case; labels truncate with
  full text on hover/selection; golden fixtures become the visual smoke
  test, checked by hand on the explain-stampede plate.
- [tsc concatenation has no dependency graph — file order matters] →
  explicit `include` order in tsconfig (host before kinds, app last); CI
  drift job catches a broken build immediately since app.js won't compile.
- [Generated types may fight the hand-rolled post-processing on a schema
  change] → the gen script is ~20 lines doing a mechanical strip; if
  json-schema-to-typescript output shifts, the drift job fails loudly rather
  than silently shipping stale types.
- [DOM-based tests are not part of the repo's Go/CLI test culture] → same
  stance as add-reader: logic that can be pure (layout positions, time-axis
  math, anchor joining) is factored into pure functions and covered by a
  node-run test file; interactions verified by hand on the golden plate,
  documented in PR notes.

## Migration Plan

Pure addition inside the reader; the embedded app.js/style.css are rebuilt
and committed in the same change. Old plates render unchanged (same JSON,
better cards). Rollback is reverting the commit.
