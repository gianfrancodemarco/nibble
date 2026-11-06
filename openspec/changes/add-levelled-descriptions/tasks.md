# Tasks

## 1. Protocol: title rename + description shape (Go, TDD)

- [x] 1.1 Red: tests in `cli/internal/protocol/plate_test.go` — a nibble with
  `title` parses; `caption` without `title` fails `nibble.title.missing` with
  the rename named in the message; `description` accepted on plate header and
  nibble with `{overview}` and `{overview, standard}`; `{standard}` alone,
  a string, or an empty variant fails `plate.description` /
  `nibble.description`; plate-header `because` round-trips. Verify:
  `go test ./internal/protocol/` fails on the new cases only.
- [x] 1.2 Green: rename the struct field and JSON tag in `plate.go`, add the
  `Description` type (overview/standard) to plate header and nibble, the new
  error codes in `errors.go`, and shape validation. Verify: 1.1 tests pass.
- [x] 1.3 Golden fixtures: regenerate `protocol/golden/plates/` to `title`,
  give one plate a two-variant plate+nibble description (the worked example),
  and add an invalid fixture pinning `nibble.title.missing` on an old-style
  nibble plus one pinning `nibble.description`. Verify:
  `go test ./internal/protocol/ -run Golden` passes and fails when an
  `expect` code is edited.
- [x] 1.4 Document in `protocol/PROTOCOL.md`: the nibble `title` field, the
  `description` object with the dial fallback rule, plate `because`, and the
  new codes in the error index. Verify: `TestErrorCodeIndex` passes.

## 2. CLI: flags and budgets (Go, TDD)

- [x] 2.1 Red: tests in `cli/internal/cmd` — `add --title` writes `title`;
  `add --caption` exits 2 naming `--title`; `--description` /
  `--description-standard` stored on nibble and plate; standard-only
  description rejected; budgets: 41-word title, 101-word overview, 251-word
  standard each `cli.budget` naming their limit; `--because` overrides and is
  stored (`because` on the nibble for `add`, on `plate.json` for `new`).
  Verify: tests fail.
- [x] 2.2 Green: rename the flag and budget in `add.go`, add the description
  flags to `add` and `new`, the word-count checks, and plate `because`.
  Verify: 2.1 tests pass; full `go test ./...` green.
- [x] 2.3 Serve surface: `/api/plate` carries nibble `title`, both
  descriptions and plate `because`; e2e test asserts the payload. Verify:
  `go test ./internal/cmd/ -run E2E` (or the suite's equivalent) green.

## 3. Reader: levelled text on the dial (TS, TDD)

- [x] 3.1 Red: pure tests — a `descriptionAt(desc, level)` helper returns
  overview at overview, standard at standard, overview as the standard
  fallback, and null when absent. Verify: test build fails.
- [x] 3.2 Green: implement the helper in the host seam; render the plate
  description under the header and the nibble description under the title
  (no element when absent); `NibbleData.caption` becomes `title`. Rebuild and
  commit `app.js`. Verify: reader tests green; no src/app.js drift.
- [x] 3.3 End-to-end check: build a plate with descriptions at both levels,
  `nibble serve`, flip `d` in the browser — texts swap in place, plate
  description follows, no-description cards unchanged. Verify: walkthrough
  done; full Go suite green.

## 4. Rename sweep, skill and site

- [x] 4.1 Sweep: repo-wide grep shows no live `caption` left outside
  archived changes and git history — skill (SKILL.md worked review, examples
  docs), `docs/demo/make.sh` (use `--title` + description flags and
  regenerate the demo), guide pages, PRD mentions. Verify:
  `grep -ri caption` across `cli/ reader/ protocol/ docs/` returns only
  deliberate historical text.
- [x] 4.2 Teach the skill: title is the claim, description.overview the skim
  paragraph (≤100), description.standard the full story (≤250); worked
  review transcript updated to the new flags with a levelled description.
  Verify: skill examples still lint clean; CI skill tests green.
- [x] 4.3 Update `docs/` site: PRD opinion 01 wording and vs-deck row
  (title + levelled description), R-table if touched, user-guide reading
  page (what the dial does to text), regenerated live demo showing a plate
  description. Verify: pages render locally and describe the shipped model;
  demo bundle byte-identical to the embedded UI.

## 5. Review feedback: room for the text

- [x] 5.1 One card at a time: the active card fills the canvas (neighbours
  fully off-screen), the camera still slides between cards; the card is a
  column where the visual flexes and shrinks before the title or description
  can leave the view. Verify: browser walkthrough — no scrolling needed to
  read a card's text at a standard window size.
- [x] 5.2 One title per card: drop the visual's document title from the card
  chrome (the kind chip stays); the nibble title is the card's only title.
  Verify: a rendered card shows exactly one title line.
- [x] 5.3 Legible descriptions: plate description reads as body text under
  the header; nibble descriptions sized as prose, not fine print. Verify:
  browser.
- [x] 5.4 Rebuild `app.js`, regenerate the live demo bundle (app.js,
  style.css, reader.html byte-identical to the embedded UI), reader + Go
  suites green. Verify: `cmp` on the demo copies; all tests pass.
