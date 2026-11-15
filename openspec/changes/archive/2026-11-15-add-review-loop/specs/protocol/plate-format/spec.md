# Spec Delta

## MODIFIED Requirements

### Requirement: Plate folder layout

A plate SHALL be a single directory containing `plate.json` (the header),
zero or more nibble files named `n1.json`, `n2.json`, … in reading order,
an optional `done` marker file, an optional `ledger.json` (the not-shown
ledger), and the review thread: an optional `review.json` (round 1) with an
optional `reply.json`, then `review.2.json` / `reply.2.json` and so on, one
pair per round. No other files are part of protocol v1; consumers SHALL
ignore unknown files.

#### Scenario: Minimal valid plate
- **WHEN** a directory contains a valid `plate.json` and a valid `n1.json`
- **THEN** it parses as a valid plate with one nibble and no review

#### Scenario: Unknown extra file
- **WHEN** a plate directory also contains an unrelated file (e.g. `.DS_Store`)
- **THEN** parsing succeeds and the file is ignored

#### Scenario: A v1 plate with one review still parses
- **WHEN** a plate carries `review.json` and no reply file
- **THEN** it parses as a valid plate whose thread has one unanswered round

### Requirement: Plate lifecycle

A plate SHALL be append-only while open: nibble files are added with
increasing numbers and never renumbered. The `done` file seals the plate and
SHALL carry the final count as `{"total": N}` (an empty marker could not
detect later additions); a nibble file numbered beyond `total` SHALL make the
plate invalid (`plate.sealed`). The review thread — rounds of the reader's
comments and the agent's replies — marks the plate answered round by round;
a review round with no comments means done — nothing to address now, never
an end: a later round may follow. A reader
SHALL be able to consume a plate that has nibbles but no `done` yet.

#### Scenario: Reading while writing
- **WHEN** a plate has `n1.json` and `n2.json` and no `done`
- **THEN** it parses as a valid, open plate with two nibbles

#### Scenario: Malformed review
- **WHEN** `review.json` carries a comment without text, or is not a review
  object
- **THEN** parsing fails with error code `review.malformed`

## ADDED Requirements

### Requirement: Review rounds

The thread SHALL be numbered rounds: round 1 is `review.json`, round `k ≥ 2`
is `review.k.json`, each a review (`{"comments": […]}`). Rounds SHALL be
contiguous and a round MAY only follow a round whose every comment has a
reply — a done round (no comments) trivially qualifies, so the chat never
closes. Either broken is `review.round`.

#### Scenario: Two rounds
- **WHEN** a plate has `review.json` with two comments, a `reply.json`
  answering both, and `review.2.json` with `{"comments": []}`
- **THEN** it parses with two rounds, the second done, and the turn the
  reader's

#### Scenario: Round numbering gap
- **WHEN** a plate has `review.json` and `review.3.json` but no `review.2.json`
- **THEN** parsing fails with `review.round`

#### Scenario: Round before its predecessor is answered
- **WHEN** `review.2.json` exists while a comment of `review.json` has no
  reply
- **THEN** parsing fails with `review.round`

#### Scenario: Round after done
- **WHEN** `review.json` is `{"comments": []}` and `review.2.json` carries a
  comment
- **THEN** the plate parses with two rounds and the turn is `agent`

### Requirement: Comment ids and thread continuation

Every comment SHALL have the derived id `<round>.<index>` (1-based index in
its round). A comment MAY carry `"thread": "<id>"` naming a comment of an
earlier round that itself carries no `thread` (the opener); it then belongs
to that thread and inherits the opener's target, and a `target` it carries
SHALL equal the opener's. A `thread` naming a missing comment, a comment of
the same or a later round, or a continuation, or a mismatched target, is
`review.thread`.

#### Scenario: Follow-up continues a thread
- **WHEN** `review.json` comment 2 targets `n2:s4` and `review.2.json`
  comment 1 is `{"thread": "1.2", "text": "and if the queue is full?"}`
- **THEN** the plate parses and comment 2.1 belongs to thread 1.2 with
  target `n2:s4`

#### Scenario: Thread names a missing comment
- **WHEN** a comment carries `"thread": "1.9"` and round 1 has two comments
- **THEN** parsing fails with `review.thread`

#### Scenario: Thread names a continuation
- **WHEN** comment 3.1 carries `"thread": "2.1"` and comment 2.1 itself
  continues thread 1.2
- **THEN** parsing fails with `review.thread`

#### Scenario: Thread target mismatch
- **WHEN** a continuation of thread 1.2 (target `n2:s4`) carries
  `"target": "n3"`
- **THEN** parsing fails with `review.thread`

#### Scenario: Thread within the same round
- **WHEN** comment 2.2 carries `"thread": "2.1"`
- **THEN** parsing fails with `review.thread`

### Requirement: Reply file shape

A round's replies SHALL live in `reply.json` (round 1) or `reply.k.json`:
`{"replies": [{"to": N, "text": "<md>", "refs": […], "because": "…"}]}`.
`to` is the 1-based index of a comment in that round's review; `text` is
non-empty markdown; `refs` (optional) are stored refs in the nibble form,
fingerprinted, with no `@anchor`; `because` (optional) is a budget reason
shown to the reader. Unknown fields SHALL be preserved by tools that rewrite
the file.

#### Scenario: Valid reply with refs
- **WHEN** `reply.json` carries a reply to comment 1 with text and one stored
  ref carrying a valid `fp1:` fingerprint
- **THEN** the plate parses and the reply's ref resolves like a nibble ref

#### Scenario: Malformed reply
- **WHEN** a reply has empty text, a non-integer `to`, or the file is not a
  replies object
- **THEN** parsing fails with `reply.malformed`

#### Scenario: Reply to no comment
- **WHEN** `reply.json` replies `to` 3 and the round has two comments, or the
  round's review is done
- **THEN** parsing fails with `reply.target`

#### Scenario: Two replies to one comment
- **WHEN** `reply.json` carries two replies with the same `to`
- **THEN** parsing fails with `reply.duplicate`

#### Scenario: Reply without its review
- **WHEN** `reply.2.json` exists and `review.2.json` does not
- **THEN** parsing fails with `reply.orphan`

#### Scenario: Reply ref carries an anchor
- **WHEN** a reply's stored ref is `src/a.ts:1-3 @cache note`
- **THEN** parsing fails with `reply.anchor`

### Requirement: Reply prose anchor links

A reply's `text` MAY carry `[phrase](@id)` anchor links when its thread's
target is a nibble (`n<N>` or `n<N>:<id>`); each id SHALL name an element
of that nibble's visual. A link that names no such element, or any anchor
link in a reply on a `ledger…` or untargeted thread, is `reply.anchor`.

#### Scenario: Reply links into the thread's nibble
- **WHEN** a reply to a comment on `n2:s4` reads "the [enqueue](@s4) is
  retried" and nibble 2's visual declares `s4`
- **THEN** the plate parses

#### Scenario: Reply to a follow-up resolves against the opener's nibble
- **WHEN** comment 2.1 continues thread 1.2 (target `n2:s4`) and its reply
  links `[s4](@s4)`
- **THEN** the plate parses

#### Scenario: Dangling reply link
- **WHEN** a reply to a comment on `n2` links `[x](@nope)` and nibble 2's
  visual declares no `nope`
- **THEN** parsing fails with `reply.anchor`

### Requirement: Whose turn it is

A parsed plate SHALL expose the thread's turn, derived from the files:
`agent` when the latest review has a comment without a reply; `reader`
otherwise (no review yet, every comment of the latest round answered, or a
done round).

#### Scenario: Fresh plate
- **WHEN** a plate has no review file
- **THEN** its turn is `reader`

#### Scenario: Comments awaiting replies
- **WHEN** the latest round has two comments and one reply
- **THEN** its turn is `agent`

#### Scenario: Round answered
- **WHEN** the latest round has two comments and two replies
- **THEN** its turn is `reader`

#### Scenario: Done is the reader's turn
- **WHEN** the latest review is `{"comments": []}`
- **THEN** its turn is `reader`
