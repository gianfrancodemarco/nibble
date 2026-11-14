# Proposal

## Why

Reading real plates showed the prose is too thin: a plate is a bare title and
each nibble a ≤40-word caption, with nowhere to put the paragraph of context a
claim sometimes needs. The dial (just shipped) already lets visuals carry two
depths; text should follow it. Decided with the owner (2026-11-06): plates and
nibbles each get a title (one level) and a description (two levels).

## What Changes

- **BREAKING** — a nibble's `caption` is renamed `title`: same role (the
  one-or-two-sentence claim under the visual), same ≤40-word budget, new name.
  Only dogfood plates exist, so golden files and the demo are regenerated and
  no migration path ships. `nibble add --caption` becomes `--title`.
- Plates and nibbles gain an optional `description`: an object with a
  required `overview` and an optional `standard` markdown variant. The dial
  picks the variant: overview shows `overview`; standard shows `standard`,
  falling back to `overview` when absent. Budgets: overview ≤ 100 words,
  standard ≤ 250, both overridable with `--because`.
- `nibble new` and `nibble add` take `--description <md>` (the overview
  variant) and `--description-standard <md>`.
- The reader shows the plate description under the header and each nibble's
  description under its title, switching with the existing dial.
- The skill teaches the model: title is the claim, description.overview is
  the skim paragraph, description.standard is the full story.

## Capabilities

### New Capabilities

None — levelled text is new behavior of existing capabilities.

### Modified Capabilities

- `protocol/plate-format`: plate header gains `description`; nibble files
  carry `title` (renamed from `caption`) and optional `description`, with
  shape validation for the description object.
- `cli/plate-authoring`: `--title` replaces `--caption`; the two description
  flags on `new` and `add`; word budgets for both description variants.
- `reader/ui-shell`: plate description in the chrome, nibble description on
  the card, both following the dial with downward fallback.

## Impact

- `cli/internal/protocol` (plate/nibble parsing and validation, golden
  plates), `cli/internal/cmd` (flags, budgets, HTTP payloads).
- `reader/src/app.ts` (NibbleData/Plate shapes, card and header rendering).
- `cli/skill/claude-code/SKILL.md` + examples; `docs/demo/make.sh` and the
  regenerated live demo; `protocol/PROTOCOL.md`.
- `docs/` site: PRD (opinion 01 wording, R-table, vs-deck row), user guide.

## Out of Scope

- A third (deep) text variant — reserved with the dial's v0.2 deep level.
- Levelled text anywhere else (visual titles, refs, comments, review).
- Markdown beyond the reader's existing mdLite (bold/code/italic).
- Any alias or migration support for the old `caption` field.
