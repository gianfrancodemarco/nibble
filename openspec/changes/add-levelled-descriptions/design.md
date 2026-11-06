# Design

## Context

See proposal.md for motivation. What exists today: nibbles carry `caption`
(`cli/internal/protocol/plate.go`), enforced at 40 words by `add`
(`cli/internal/cmd/add.go`, `captionWordBudget`), served verbatim over
`/api/plate` (`http.go`) and rendered by `app.ts` through `mdLite`. The dial
(add-detail-dial, in the working tree) gives the reader a plate-wide
`DialLevel` and re-renders every card on a flip — levelled text can ride that
exact mechanism. Golden plates under `protocol/golden/plates/` and the live
demo (`docs/demo/make.sh`) are the only plates in existence.

## Goals / Non-Goals

**Goals:**

- One symmetric text model: plate and nibble each have `title` (one level)
  and optional `description` (overview + standard), per the owner's decision
  (2026-11-06).
- The rename lands completely: no alias, no half-renamed surface — specs,
  CLI, protocol, reader, skill, goldens, demo all say `title`.
- Rejections keep teaching: the old flag and the old field each point at the
  new name.

**Non-Goals:**

- No `caption` compatibility window. Pre-adoption, the cost of carrying an
  alias forever exceeds the cost of regenerating dogfood plates.
- No new markdown features; descriptions render through the existing mdLite.
- No per-element text levels inside visuals (that is the `level` hint's job).

## Decisions

**1. Hard rename `caption` → `title`, no alias.**
Protocol v1 is days old and every existing plate is ours. A nibble carrying
`caption` without `title` fails with `nibble.title.missing` and a message
naming the rename; `nibble add --caption` is a usage error (exit 2) whose
message names `--title`. Alternative rejected: accepting both — it would make
the golden suite ambiguous and the skill teach two names.

**2. `description` is `{overview: required, standard: optional}`.**
An object, not a string, so a third variant (`deep`, v0.2) slots in without
reshaping. Overview is required because the skim is the product's promise —
`--description-standard` alone is rejected (`plate.description` /
`nibble.description`, matching where it sits). Fallback is downward only:
standard falls back to overview; overview never shows the long text.
Alternative rejected: two flat fields (`description`,
`description_standard`) — works on the CLI as flags, but on disk the object
groups what the dial switches.

**3. Budgets live in the CLI, like the caption budget they extend.**
Title keeps 40 words under the renamed check; overview ≤ 100, standard ≤ 250
(owner's pick). All reuse `cli.budget` and `--because`; `new` stores the
reason as `because` on `plate.json`, mirroring the nibble field. The protocol
package validates only shape (`description` object, non-empty variants),
never word counts — same split as visuals (schema/semantics in protocol,
budgets in CLI).

**4. The reader swaps text on the existing dial re-render.**
`setDial` already re-renders every card; the card template picks
`description.standard ?? description.overview` at standard and
`description.overview` at overview, and the header does the same for the
plate. No new state, no new events. The "nothing moves" guarantee stays
scoped to visual geometry: text length differs between levels, so card
heights may change; `render()` already re-runs `camera()`, which recenters
the active card.

**5. Goldens and demo regenerate; the skill reteaches.**
Golden plate fixtures switch to `title` and one gains a two-variant
description (the conformance example). An invalid fixture pins
`nibble.title.missing` on an old-style nibble. `docs/demo/make.sh` passes
`--title`/`--description`/`--description-standard`, so the live demo shows
levelled prose. The skill's model: title is the claim (≤40 words),
description.overview is the skim paragraph, description.standard is the full
story — picture first, prose bounded.

## Risks / Trade-offs

- [Longer prose erodes "picture first, prose last" (PRD opinion 01)] → The
  budgets (100/250) and the required-overview rule keep prose bounded and
  skimmable; the PRD text is updated in this change so the single source
  stays true.
- [Rename misses a spot (an old `caption` lingering in reader, demo, skill or
  docs)] → A repo-wide grep gate is an explicit task; the golden suite and
  the demo rebuild catch the executable surfaces.
- [Card height changes on dial flips feel like movement] → Camera recenters
  on every render already; visuals keep identical geometry, which is what the
  stability promise covers.

## Migration Plan

Breaking but contained: regenerate golden plates and the demo in this change;
delete-and-rebuild any personal dogfood plates (`~/.nibble/plates`) rather
than migrating them. Rollback is reverting the change.

## Open Questions

None.
