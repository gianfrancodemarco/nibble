# Proposal

## Why

PR review is nibble's first use case, and the PRD makes the blast-radius map
part of its core promise (R16, P0; §11 MVP): a reviewer should see the change
in three rings — what changed, what depends on it but did not change, and the
rest — and should never leave a plate unaware of a dependent they did not
look at. Today a map renders tiered columns with no notion of a change's
reach, and nothing tracks what the reader has inspected. The PRD's decision
log names blast-radius rings the next item.

## What Changes

- Map nodes gain an optional semantic hint `ring: changed | dependent | rest`.
  The agent declares what each node is to the change — it computes the
  dependents (callers, importers, tests, configs) itself, since it has the
  repo; nibble never runs dependency analysis. As with every hint, no pixels:
  nibble decides how rings look.
- Ring coherence validation: rings are all-or-nothing per map
  (`map.ring.partial`), and a ringed map must contain at least one `changed`
  node (`map.ring.empty`) — rings only mean something anchored on a change.
- The reader renders a ringed map as three concentric zones — changed at the
  centre, dependents around it, the rest outside — labelled, visually
  distinct, deterministic, and layered under the detail dial like any map
  (positions never shift with the dial).
- The reader tracks which dependent-ring nodes the reader has looked at
  (selected, or opened their code): unvisited dependents carry a badge, and
  the map shows how many dependents are still unvisited. Visited state is
  session-local presentation state; it is never written to the plate.
- The Claude Code skill and its worked examples teach the PR-review shape:
  open the plate with a ring map, how to pick the three rings, and grouping
  dependents (callers / importers / tests / configs) with the existing
  `group` hint.

## Capabilities

### New Capabilities

None — rings are new behavior of the existing visual pipeline, not a new
boundary.

### Modified Capabilities

- `protocol/visual-schemas`: the `ring` hint on map nodes and the two
  ring-coherence validation rules with their error codes.
- `reader/visual-kinds`: ring layout for ringed maps, the unvisited-dependent
  badge, visited tracking semantics, and the unvisited count.

## Impact

- `protocol/schemas/map.schema.json`, `protocol/PROTOCOL.md`; new golden
  files: valid ringed maps and invalid fixtures for both new error codes.
- `cli/internal/protocol/visual.go` (Go validation) — new rules surface
  through the existing `add` / `lint` paths; no CLI command or flag changes.
- `reader/src/visual/map.ts` (ring layout, badges, visited state),
  regenerated `types.gen.d.ts`, rebuilt committed `app.js`.
- `cli/skill/claude-code/SKILL.md` and `examples/` — teach the PR-review
  ring map; examples stay lint-clean.
- `docs/` site pages: roadmap (item ships), PRD shipped note, guide pages
  that describe reading a map.

## Out of Scope

- Churn colouring (the other half of R14) — files coloured by amount of
  change is a separate, small follow-up.
- Any dependency analysis in the CLI or reader — the agent declares rings;
  nibble validates and draws.
- Persisting visited state across reader sessions or into the plate /
  review; visited is in-memory per open tab.
- The not-shown ledger (R17) — the next roadmap item, its own change.
- Chapter flow for big PRs (v0.2).
