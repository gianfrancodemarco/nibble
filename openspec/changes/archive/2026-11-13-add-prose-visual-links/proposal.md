# Proposal

## Why

A nibble's prose and its visual talk about the same things, but nothing ties
them together: the title says "the cache misses fall through to the pool" and
the reader has to find `cache` and `pool` in the picture by scanning labels.
The v0.2 roadmap item promises the link: hover a phrase in a nibble's text and
the matching part of the visual lights up, and the other way round. The
protocol already has the one ingredient this needs — every visual element is
addressable by a stable anchor id (`ref.anchor.dangling` enforces it for
refs) — so prose only needs a way to name those ids.

## What Changes

- **Protocol**: nibble prose (the `title` and both `description` variants)
  MAY carry anchor links in markdown link syntax, `[phrase](@id)`, where `id`
  names an element of that nibble's own visual. Validation rejects a link to
  an id the visual does not declare (`nibble.prose.anchor.dangling`), the
  same contract refs already have. Plate-level prose (the header
  `description`) has no visual, so anchor links there are rejected too
  (`plate.prose.anchor`). Golden plates cover both.
- **CLI**: the Go validator learns the link scan; `nibble add`/`seal` reject
  dangling prose anchors with a fix-it message naming the ids the visual does
  declare.
- **Reader**: `mdLite` renders `[phrase](@id)` as a link span. Hovering the
  phrase lights the matching element in the card's visual; hovering an
  element (or selecting it) lights every phrase that names it. Clicking a
  prose link selects the element — same selection the visual click path
  produces, so comment targets follow. A link whose element is not drawn at
  the current dial level renders as plain emphasized text (no glow, no
  dead hover), mirroring how selections fall back on a dial turn.
- **Skill**: the Claude Code skill's authoring guidance and worked examples
  show anchor links in titles and descriptions, so agents produce them.

Out of scope: general markdown links (`[text](https://…)`) in prose; links
in comments or ledger notes; cross-nibble links (an id always resolves in
the nibble's own visual); any new visual kinds or protocol version bump —
the field is additive inside existing markdown strings.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `protocol/plate-format`: nibble prose gains anchor links with validation
  (`nibble.prose.anchor.dangling`); plate header prose rejects them
  (`plate.prose.anchor`).
- `reader/ui-shell`: prose links render as interactive spans; hover lights
  the visual element and the reverse; click selects; undrawn targets fall
  back to plain text at the current dial level.
- `skill/claude-code`: authoring guidance and worked examples use anchor
  links in prose.

## Impact

- `cli/internal/protocol/plate.go` (nibble/plate prose validation),
  `errors.go` (two codes), tests and `protocol/golden/plates/*` fixtures.
- `protocol/PROTOCOL.md` prose section and error-code table.
- `reader/src/app.ts` (`mdLite`, card wiring), `reader/src/visual/host.ts`
  (hover/light seam shared with renderers), `reader/src/style` additions in
  `cli/internal/cmd/ui/style.css`; new pure module + node tests.
- `skill/` SKILL.md and worked examples.
- No API or schema-file changes: visuals are untouched; prose stays a
  markdown string.
