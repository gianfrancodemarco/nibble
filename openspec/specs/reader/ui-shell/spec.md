# reader/ui-shell Specification

## Purpose

The chassis the visual kinds plug into: one canvas, a camera, the code
drawer, comments and verdict. Pure presentation — TypeScript compiled to one
static file, embedded in the Go binary, talking only to the JSON API.

## Requirements

### Requirement: One canvas, a camera

The shell SHALL render the whole plate on one canvas: a card per nibble
(caption, the rendered visual as the card's body, budget reason when
present) laid out in reading order. At standard window sizes the active
card's visual SHALL take the majority of the viewport (R1: visual-first),
caption below, code in the drawer. Stepping (buttons, arrow keys) SHALL move
a camera — an animated transform centering the active card — never a page
navigation.

#### Scenario: Stepping moves the camera
- **WHEN** the reader shows a 3-nibble plate and the user steps forward
- **THEN** the canvas transform animates to center card 2; the document URL
  and page do not change

#### Scenario: The visual is the card
- **WHEN** the active card renders a map at a standard window size
- **THEN** the rendered visual is the dominant element — larger than caption
  and chrome combined — with the caption beneath it

### Requirement: Code drawer with trust badges

Each ref on a card SHALL be clickable and open a drawer showing the code from
`/api/code`: line numbers, the referenced range distinguished from context,
and a trust badge — `exact`, `shifted ±N` (with the resolved position), or
`stale` with a visible warning that the code has moved on.

#### Scenario: Stale ref is not presented as current
- **WHEN** a ref's trust is `stale` and its drawer is opened
- **THEN** the drawer shows the stale badge and warning alongside whatever is
  at the original range now

### Requirement: Comments and verdict

The shell SHALL let the reader attach comments to a nibble (target `n<N>`)
or to a selected visual element (target `n<N>:<element-id>`), and choose one
verdict (`approve` / `changes` / `question` / `closed`). Choosing is a
draft: nothing is posted, the verdict can be changed, and `serve` keeps
running. Only an explicit send action SHALL `POST /api/review` — the
irreversible step is one deliberate button, never a stray click. After a
successful send — or on a plate that already has a review — the shell SHALL
show the review and lock input.

#### Scenario: Choosing a verdict is not sending
- **WHEN** the reader clicks `approve` and nothing else
- **THEN** no request is made, `review.json` does not exist, and `serve` keeps
  waiting

#### Scenario: Send ends the loop
- **WHEN** the reader adds a comment on n2, chooses `changes`, and clicks send
- **THEN** the POST carries `{"verdict":"changes","comments":[{"target":"n2",...}]}`
  and the UI switches to the submitted, locked state, then attempts to close
  the tab (falling back to a visible "sent — you can close this tab" state
  where the browser refuses)

#### Scenario: Anchored comment rides the same review
- **WHEN** the reader selects a visual element `cache` on n2, pins a comment,
  and sends with verdict `changes`
- **THEN** the POST's comments include one with target `n2:cache`

### Requirement: Follows a live plate

The shell SHALL subscribe to `/api/events` and reflect new nibbles and the
seal without a reload, and show open/sealed state (`n of N` once sealed).

#### Scenario: Plate grows while open
- **WHEN** the reader is open on a 2-nibble plate and the agent adds n3
- **THEN** card 3 appears without a reload

### Requirement: Built TS, embedded, drift-guarded

The UI SHALL be TypeScript under `reader/` compiled (pinned tsc, no bundler,
no runtime deps) to a committed `app.js` embedded via `go:embed`, so
`go install` needs no Node. CI SHALL rebuild the UI and fail on drift between
source and committed output.

#### Scenario: Drift fails CI
- **WHEN** `app.ts` changes but the committed `app.js` is not rebuilt
- **THEN** the CI job fails on the diff


### Requirement: The ledger card ends a diff plate

When the plate carries a ledger, the shell SHALL render one final card after
the last nibble — the not-shown ledger — showing every changed file of the
diff as a directory tree, one row per file and side with its uncovered line
ranges and a badge on covered files, plus the shown/total coverage. A fully
covered diff SHALL render the card saying so, never omit it; a plate without
a ledger renders no ledger card. The card joins the strip: camera, stepping
and keys treat it like a nibble card.

#### Scenario: Single-child directories collapse
- **WHEN** the changed files are `docs/guide/deep/one.md` and
  `docs/guide/deep/two.md`
- **THEN** the tree shows one `docs/guide/deep` directory holding both rows

#### Scenario: Partly covered file badged as such
- **WHEN** a file has three hunks and one is covered
- **THEN** its row is badged `1/3 shown` and its label lists only the two
  uncovered ranges

#### Scenario: Changed files listed as a tree
- **WHEN** a sealed worktree plate's ledger lists two uncovered hunks in
  `src/b.ts`, one uncovered in `src/c.ts` and one covered in `src/pool.ts`
- **THEN** the strip ends with a ledger card showing a `src` directory with
  rows for `b.ts`, `c.ts` and `pool.ts`, `pool.ts` badged as shown, and
  arrow-key navigation reaches the card after the last nibble

#### Scenario: Full coverage still shown
- **WHEN** the ledger is `{"shown": 6, "total": 6, "hunks": []}`
- **THEN** the ledger card states that everything in the diff was shown

#### Scenario: Ledger arrives with the seal
- **WHEN** an open plate seals while the reader is watching (SSE `sealed`)
- **THEN** the ledger card appears without a reload

### Requirement: Ledger files open their code

Each listed file row SHALL be activatable and open the code drawer on
`/api/ledger?file=<path>&side=<side>`, showing all of that file-and-side's
uncovered hunks with their lines highlighted and the stretches between
distant hunks elided, with the same trust/unavailability presentation as a
ref: real lines when the side is servable, the server's reason when it is
not.

#### Scenario: File row opens the drawer
- **WHEN** the reader activates a file row with two uncovered hunks on the
  ledger card
- **THEN** the drawer shows both hunks' lines highlighted, with a gap mark
  between non-adjacent segments

### Requirement: Ledger comments

The shell SHALL let the reader attach review comments to the ledger card as
a whole (target `ledger`) or to one file row (target `ledger:<path>` for a
head-side row, `ledger:<path>#base` for a deleted-lines row), through the
same pending-comments flow as nibble comments, posted in the same review.

#### Scenario: Comment pinned to a file
- **WHEN** the reader selects the `src/b.ts` row and adds "why is this
  change not in the walkthrough?"
- **THEN** the pending comment's target is `ledger:src/b.ts` and it posts
  with the review

#### Scenario: Comment on the ledger itself
- **WHEN** the reader comments with the ledger card active and no hunk
  selected
- **THEN** the comment's target is `ledger`
