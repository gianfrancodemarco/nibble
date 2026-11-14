# Proposal

## Why

The PRD calls the detail dial "nibble's central mechanism" (§6.2, R12, P0): it
resolves the tension between small plates and real tasks because depth grows in
place instead of in a longer document. Every v0.1 visual today renders at one
fixed level, so a plate cannot be skimmed — a ninety-second review and a
ten-minute one need to be the same plate. The PRD names this the next item
after visual kinds.

## What Changes

- Visual documents gain an optional per-element `level` hint — the minimum
  dial level at which the element is drawn. Absent means the element is part
  of the overview (drawn at every level); `"standard"` marks it standard-only.
  Existing plates stay valid and read identically at both levels.
- Validation gains level-coherence rules: an overview edge may not connect to
  a standard-only map node, an overview timeline event may not sit in a
  standard-only lane, and a visual whose every element is standard-only is
  rejected (its overview would be empty).
- The reader gains the dial itself: a plate-wide control with two positions in
  v0.1 — **overview** and **standard** — defaulting to standard. Turning it
  changes only how much is drawn: same canvas, same camera, stable element
  positions (layers, never a re-layout or a different document).
- The Claude Code skill and its worked examples teach when and how to layer a
  visual for the dial.

## Capabilities

### New Capabilities

None — the dial is new behavior of existing capabilities, not a new boundary.

### Modified Capabilities

- `protocol/visual-schemas`: per-element `level` hint on map nodes/edges,
  sequence steps, and timeline lanes/events, plus the level-coherence
  validation rules and error codes.
- `reader/visual-kinds`: rendering honors the active level — standard-only
  elements are omitted at overview without re-laying out what remains, so the
  two levels read as layers of one picture.
- `reader/ui-shell`: the dial control — plate-wide, two positions, defaults
  to standard, keyboard-reachable, selection falls back cleanly when the
  selected element leaves the drawn set.

## Impact

- `protocol/schemas/*.json` (map, sequence, timeline) and
  `protocol/PROTOCOL.md`; new golden files for levelled visuals and the new
  error codes.
- `cli/internal/protocol` visual validation (Go) — new rules surface through
  the existing `add` / `lint` paths; no CLI command or flag changes.
- `reader/src` — dial control, level-aware rendering, regenerated visual
  types from the schemas.
- `cli/skill/claude-code/SKILL.md` and `examples/` — teach layering.
- `docs/` site pages that describe the reader and the protocol.

## Out of Scope

- The **deep** level and on-demand generation of deep layers (v0.2, with the
  deep-layer / visuals-on-demand roadmap item). The `level` enum ships with
  `"standard"` only; `"deep"` is reserved.
- Overview variants of captions or any caption changes — the dial affects
  visuals only.
- Levels on `compare` documents (both sides are always essential) and on
  sequence actors (lifelines are structural; only steps layer).
- Any per-visual or per-nibble dial — the dial is one plate-wide setting.
