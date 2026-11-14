# Design

## Context

See proposal.md — Why. The pieces already in place:

- Every visual element has a stable id; the Go validator collects them with
  `CollectAnchors` (cli/internal/protocol/visual.go) and already rejects
  dangling ref anchors in `loadNibble` (cli/internal/protocol/plate.go).
- Nibble prose is markdown rendered by `mdLite` (reader/src/app.ts): escape
  first, then bold/code/italic only. Cards carry `.ntitle` and `.desc`.
- Renderers mark addressable elements with `data-anchor`; the host wires
  selection by delegation on `#strip` (reader/src/visual/host.ts), toggles
  `.sel` classes via `applySelection`, and tells renderers about selection
  with the `anchorselection` custom event.
- `anchorDrawnAt(visual, id, level)` already answers "is this id drawn at
  this dial level" — the exact question an inert link needs.
- The reader's pure logic lives in top-level `const`/`function` files
  concatenated by tsc (no modules); node tests exercise them through
  reader/test/*.test.ts.

Constraints: protocol logic stays in Go (the reader never validates);
visuals and schemas are untouched — the link lives inside existing markdown
strings; no new npm dependency.

## Goals / Non-Goals

**Goals:**

- One link grammar shared by validator and reader: `[phrase](@id)` with
  `id` matching the ref-anchor charset `[A-Za-z0-9_-]+`.
- Hover is cosmetic and instant (class toggles, no re-render); click joins
  the existing selection path rather than inventing a second one.
- Live-safe: arriving cards get the behavior with no extra wiring (event
  delegation, like every other strip interaction).

**Non-Goals:**

- No URL links, no autolinking bare `@id` outside the bracket form (plain
  `@cache` in prose stays text — refs use that form in their own field).
- No persistence: hover/lit state never reaches comments, reviews or the
  plate.
- No per-kind renderer changes beyond what the host can do centrally.

## Decisions

**Link syntax: markdown link with an `@` target.** `[phrase](@id)` reads as
markdown anywhere else (plain link with an odd href), degrades to visible
text in old readers, reuses the `@anchor` spelling refs already taught
agents, and is unambiguous to scan with one regex. Alternatives: bare
`@id` autolinking (false positives on prose that mentions emails/handles,
no way to choose the phrase), custom `{{id|phrase}}` (foreign to markdown,
ugly when unrendered).

**Validation sits beside the ref-anchor check.** `loadNibble` already has
the visual's anchor ids in hand; a `proseAnchors(title, description)` scan
feeds the same `slices.Contains` loop. Error codes follow the existing
grammar: `nibble.prose.anchor.dangling` (cf. `ref.anchor.dangling`),
`plate.prose.anchor` (cf. `plate.description`). The plate-header check runs
in `validateDescription`'s caller for the plate only — nibble descriptions
are checked against their visual instead.

**Reader: one pure module, `reader/src/prose.ts`.** Exports (concatenated,
not imported): `proseToHtml(md, drawn)` — mdLite's pipeline plus the link
rule, rendering `<a class="plink" data-link-anchor="id" tabindex="0">` when
`drawn(id)` is true and `<span class="plink-inert">` otherwise — and
`linkIds(md)` for tests and future use. `mdLite` stays for prose without a
visual (plate description, ledger card) and delegates to the same
bold/code/italic core so the two can't drift. Node tests cover escaping
(link text is escaped, `](` inside code spans does not open a link),
drawn/inert branching, and id charset.

**Hover wiring: host delegation + one CSS class.** `wireVisualHost` gains
`mouseover`/`mouseout`/`focusin`/`focusout` listeners on `#strip`:

- over a `.plink` → toggle `.lit` on `[data-anchor="<id>"]` within the same
  card; over a `[data-anchor]` → toggle `.lit` on the card's
  `.plink[data-link-anchor="<id>"]`.
- click on `.plink` → exactly `selectAndVisit` + `applySelection` +
  `onTarget`, the path an element click takes (and it marks the element
  visited, consistently with "selecting counts as looking").
- `applySelection` additionally marks linked phrases of the selected id with
  `.sel`, so selection persistence on prose falls out of the existing walk.

SVG elements take `.lit` as a stroke/glow via CSS in both themes; prose
`.lit`/`.sel` get an underline-plus-tint. No renderer file changes: the
host owns both sides of the handshake through attributes renderers already
emit. (`anchorselection` consumers keep working; hover deliberately does
not fire it — hover must stay cheap.)

**Dial behavior is render-time, not event-time.** `buildNibbleCard` passes
`drawn = (id) => anchorDrawnAt(nb.visual, id, dialLevel)` into
`proseToHtml`; a dial turn already rebuilds the strip, so links re-evaluate
for free, and the hover code never needs to ask.

## Risks / Trade-offs

- **Hover listeners on a strip that re-renders**: delegation on `#strip`
  (which is never replaced, only emptied) avoids re-wiring, matching the
  click wiring that already survives rebuilds and live arrivals.
- **Phrase inside the title of a card whose visual failed to render** (no
  registered renderer): the fallback summary still shows anchor pills
  without `data-anchor`, so hover finds nothing — harmless; click still
  selects (selection is host state, not renderer state). Acceptable: that
  path exists only for unknown kinds.
- **Escaping regressions in mdLite refactor**: the shared core is extracted,
  not rewritten; existing descriptions tests plus new prose tests pin it.
- **Golden-file churn**: two new golden plates (`prose-links`,
  `prose-link-dangling`) rather than editing existing ones, so other suites
  stay byte-stable.
