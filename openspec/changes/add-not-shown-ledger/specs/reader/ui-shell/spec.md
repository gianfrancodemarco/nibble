# Spec Delta

## ADDED Requirements

### Requirement: The ledger card ends a diff plate

When the plate carries a ledger, the shell SHALL render one final card after
the last nibble — the not-shown ledger — listing the uncovered hunks grouped
by file (side, line range, +/− counts) with the shown/total coverage. An
empty ledger SHALL render the card in an explicit "every hunk was shown"
state, never omit it; a plate without a ledger renders no ledger card. The
card joins the strip: camera, stepping and keys treat it like a nibble card.

#### Scenario: Uncovered hunks listed
- **WHEN** a sealed worktree plate's ledger lists hunks in `src/b.ts` and
  `src/c.ts`
- **THEN** the strip ends with a ledger card grouping the hunks under their
  files, and arrow-key navigation reaches it after the last nibble

#### Scenario: Full coverage still shown
- **WHEN** the ledger is `{"shown": 6, "total": 6, "hunks": []}`
- **THEN** the ledger card states that everything in the diff was shown

#### Scenario: Ledger arrives with the seal
- **WHEN** an open plate seals while the reader is watching (SSE `sealed`)
- **THEN** the ledger card appears without a reload

### Requirement: Ledger hunks open their code

Each listed hunk SHALL be activatable and open the code drawer on
`/api/ledger?hunk=<I>`, with the same trust/unavailability presentation as a
ref: real lines when the side is servable, the server's reason when it is
not.

#### Scenario: Hunk opens the drawer
- **WHEN** the reader activates a hunk row on the ledger card
- **THEN** the drawer shows that hunk's lines with the hunk range marked

### Requirement: Ledger comments

The shell SHALL let the reader attach review comments to the ledger card as
a whole (target `ledger`) or to one hunk (target
`ledger:<path>:<start>[-<end>]`, the hunk's path and range verbatim), through
the same pending-comments flow as nibble comments, posted in the same review.

#### Scenario: Comment pinned to a hunk
- **WHEN** the reader selects the `src/b.ts:4-9` hunk and adds "why is this
  change not in the walkthrough?"
- **THEN** the pending comment's target is `ledger:src/b.ts:4-9` and it posts
  with the review

#### Scenario: Comment on the ledger itself
- **WHEN** the reader comments with the ledger card active and no hunk
  selected
- **THEN** the comment's target is `ledger`
