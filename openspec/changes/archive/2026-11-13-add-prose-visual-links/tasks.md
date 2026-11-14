# Tasks

## 1. Protocol: the link grammar in Go (TDD)

- [x] 1.1 Red: table tests in `cli/internal/protocol` for a new
      `ProseAnchors(md string) []ProseLink` scan (`[phrase](@id)` with the
      ref-anchor charset; empty phrase reported; `](` inside backtick code
      spans ignored; `[text](url)` without `@` ignored); green: implement in
      a new `prose.go`; verify `go test ./...` passes
- [x] 1.2 Red: `loadNibble` tests — a title link to a declared id validates;
      a description link to an undeclared id fails with
      `nibble.prose.anchor.dangling` and the message lists the visual's ids;
      empty phrase fails too; green: add the two error codes to `errors.go`
      and the checks beside the ref-anchor loop in `plate.go`
- [x] 1.3 Red: plate-header tests — an anchor link in either description
      variant of `plate.json` fails with `plate.prose.anchor`; a plain
      `[text](url)` passes untouched; green: check in the plate-header path
      only
- [x] 1.4 Golden plates: `protocol/golden/plates/prose-links` (valid, links
      in title and description) and `prose-link-dangling` (expected error
      file, per the existing bad-plate fixture convention); wire into the
      golden suite and verify it passes

## 2. Protocol docs

- [x] 2.1 `protocol/PROTOCOL.md`: document the link form under the prose
      section, add both codes to the error table; re-read the title/
      description rows so budgets still read correctly with links counted
      as their phrase text

## 3. Reader: the prose module (TDD, node suite)

- [x] 3.1 Red: `reader/test/prose.test.ts` for `linkIds(md)` and
      `proseToHtml(md, drawn)` — escaping (phrase is escaped, code spans
      shield `](`), drawn ids render `a.plink[data-link-anchor]` with
      `tabindex="0"`, undrawn render `span.plink-inert`, bold/code/italic
      still work around and inside phrases; add `src/prose.ts` and the test
      to both tsconfig `files` lists; green: implement, extracting mdLite's
      core so `mdLite` delegates to it; verify `npm test` passes
- [x] 3.2 `buildNibbleCard` renders title and description through
      `proseToHtml` with `drawn = (id) => anchorDrawnAt(nb.visual, id,
      dialLevel)`; plate description and ledger card keep `mdLite`; verify
      the dial tests and descriptions tests still pass

## 4. Reader: the host handshake

- [x] 4.1 Red: host tests for the pure pieces — `linkTargets(card, id)`
      selector building and the "click a plink takes the element-click
      path" contract (selection, visited, comment target), plus
      `applySelection` marking `.plink` phrases of the selected id; green:
      implement in `host.ts`
- [x] 4.2 Wire hover in `wireVisualHost`: `mouseover`/`mouseout` +
      `focusin`/`focusout` delegation on the strip toggling `.lit` both
      ways (phrase → `[data-anchor]`, element → `.plink`), scoped to the
      card; click/Enter on `.plink` selects via the existing path; Escape
      and background-click behavior unchanged
- [x] 4.3 Styles in `cli/internal/cmd/ui/style.css`: `.plink` (underline
      affordance), `.plink-inert`, `.plink.lit/.sel`, and `.lit` on SVG
      anchored elements (stroke/glow) — both themes, reusing existing
      theme variables; no layout shift on hover
- [x] 4.4 Headless-browser run over a fixture plate with links: hover each
      way lights the counterpart and clears; click selects and the comment
      target reads `n<N>:<id>`; dial to overview turns a standard-only
      link inert and back; a live arrival's links work with no re-wiring

## 5. Selection opens the code

- [x] 5.1 Red: node test — code chips carry `data-for="<id>"` and
      `codeChipSelector(id)` builds the card-scoped selector the host uses
      to find the selected element's chip; green: tag both chip flavours in
      `host.ts`, add the selector helper, and in `selectId` open the chip's
      ref via `wiring.openRef` on a fresh selection only (toggle-off opens
      nothing; no chip, no drawer)
- [x] 5.2 Headless-browser run: a phrase click and an element click both
      select and open the drawer on the anchored ref's code; clicking the
      selected element again clears without re-opening; the code chip still
      opens without selecting

## 6. Skill + ship

- [x] 6.1 Skill: add the linking guidance (form, restraint, the dangling
      error by code) to `skill/` authoring docs and put a resolving
      `[phrase](@id)` into at least one worked example's prose; verify the
      skill's example lint (CI task) stays green
- [x] 6.2 Rebuild the embedded UI (`npm run build` → `cli/internal/cmd/ui/`),
      sync `docs/visuals/` per the drift guard, run the full Go + node
      suites, and update `docs/roadmap.html`'s v0.2 list if it marks items
