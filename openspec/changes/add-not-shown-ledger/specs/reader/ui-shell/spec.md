# Spec Delta

## ADDED Requirements

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
