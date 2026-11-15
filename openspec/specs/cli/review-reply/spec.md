# cli/review-reply Specification

## Purpose
The answering half of the review loop: how an agent replies to one comment
of the latest round on the same plate, validated like authoring, so the
answer lands in the conversation where the question was instead of in the
chat.

## Requirements

### Requirement: Replying to a comment

`nibble reply <plate> --to <N> --text <md> [--ref <ref>]... [--because
<reason>] [--json]` SHALL append one reply to the latest round's reply file
(`reply.json`, or `reply.k.json` for round `k ≥ 2`), written atomically under
the plate lock, and exit 0 reporting how many of the round's comments are
now answered. The plate MAY be open or sealed. Nothing SHALL be written when
any validation fails.

#### Scenario: First reply of a round
- **WHEN** the latest round has two comments and `reply` answers comment 1
- **THEN** `reply.json` holds one reply with `to: 1` and the command reports
  1 of 2 answered

#### Scenario: Round becomes answered
- **WHEN** the second of two comments gets its reply
- **THEN** the command reports the round answered and the plate's turn is
  `reader`

#### Scenario: Reply to a later round
- **WHEN** the plate has two rounds and the second has unanswered comments
- **THEN** the reply is written to `reply.2.json`

### Requirement: Reply targets are checked

`--to` SHALL name a comment of the latest round by its 1-based index. A
plate with no review, a done latest review, or an index outside the round
SHALL be refused with `reply.target` (the message listing the round's
comments); a comment that already has a reply SHALL be refused with
`reply.duplicate`.

#### Scenario: Nothing to answer
- **WHEN** `reply` runs on a plate whose latest review is `{"comments": []}`
- **THEN** it exits 1 with `reply.target` and writes nothing

#### Scenario: Index beyond the round
- **WHEN** the round has two comments and `--to 3` is given
- **THEN** it exits 1 with `reply.target` naming the two comments

#### Scenario: Already answered
- **WHEN** comment 1 already has a reply and `--to 1` is given again
- **THEN** it exits 1 with `reply.duplicate` and the existing reply is
  unchanged

### Requirement: Reply refs and prose validated like a nibble's

Each `--ref` SHALL be parsed in the v1 grammar, verified against the real
repo (diff sides through git) and fingerprinted exactly as `nibble add`
does; a ref carrying `@anchor` SHALL be refused with `reply.anchor`. Anchor
links in `--text` SHALL resolve against the visual of the nibble the
comment's thread targets (a follow-up inherits its opener's target), and be
refused with `reply.anchor` otherwise.

#### Scenario: Ref verified and fingerprinted
- **WHEN** `--ref "src/upload/handler.ts:15-19 the retry"` names real lines
- **THEN** the stored reply ref carries an `fp1:` fingerprint and line hashes

#### Scenario: Ref beyond the file
- **WHEN** the ref's range ends past the file's last line
- **THEN** it exits 1 with `ref.range.beyond-eof`, as `add` would

#### Scenario: Prose link resolves against the thread's nibble
- **WHEN** the comment targets `n2:s4` and `--text` links `[enqueue](@s4)`
- **THEN** the reply is accepted; linking `[x](@nope)` is `reply.anchor`

#### Scenario: Prose link on a follow-up
- **WHEN** the comment continues thread 1.2 (target `n2:s4`) with no target
  of its own and `--text` links `[enqueue](@s4)`
- **THEN** the reply is accepted

#### Scenario: Prose link on a ledger comment
- **WHEN** the comment targets `ledger:src/a.ts` and `--text` carries any
  `[phrase](@id)` link
- **THEN** it exits 1 with `reply.anchor`

### Requirement: Reply budget

A reply's text SHALL be budgeted at 150 words; over budget without
`--because` is `cli.budget` naming the limit and the override. With
`--because` the reason is stored on the reply and shown to the reader.

#### Scenario: Over budget
- **WHEN** `--text` has 151 words and no `--because`
- **THEN** it exits 1 with `cli.budget`

#### Scenario: Override with a reason
- **WHEN** `--text` has 151 words and `--because "the race needs the full
  trace"`
- **THEN** the reply is written with `because` set to that reason
