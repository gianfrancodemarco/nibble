# Spec Delta

## MODIFIED Requirements

### Requirement: Plate endpoint with computed trust

`GET /api/plate` SHALL return the plate header, seal state, the review
thread (whose turn it is — `reader`, `agent` or `done` — and every round:
its comments with their ids, targets and `thread` links, each with its
reply when one exists, the reply's refs carrying computed trust like a
nibble's), the ledger (when `ledger.json` exists: `shown`, `total` and the
uncovered hunks, in a presentable shape) and all nibbles, with every stored
ref accompanied by trust computed server-side against the code as it is
now: `level` of `exact`, `shifted` or `stale`, the resolved `line`, and the
signed `shift`. The reader SHALL NOT receive fingerprint hashes as something
it must interpret.

#### Scenario: Ref gone stale behind the reader's back
- **WHEN** a plate references lines that are then rewritten in the worktree,
  and `/api/plate` is fetched
- **THEN** that ref's trust is `{"level":"stale"}` while untouched refs stay
  `exact`

#### Scenario: Diff ref resolved through git
- **WHEN** a nibble ref names `diff:<path>@<base>..<head>#head:<range>`
- **THEN** its trust is computed against the file at `<head>` via git, not
  the worktree

#### Scenario: Sealed diff plate carries its ledger
- **WHEN** `/api/plate` is fetched for a sealed worktree plate whose
  `ledger.json` lists two hunks
- **THEN** the response carries the ledger with both hunks and the
  shown/total counts

#### Scenario: Thread with a reply
- **WHEN** `/api/plate` is fetched for a plate whose round 1 has two comments
  and `reply.json` answers the first with one ref
- **THEN** the response's thread says the turn is `agent`, round 1 lists both
  comments with ids `1.1` and `1.2`, the first carrying its reply with the
  ref's trust computed, the second with no reply

#### Scenario: Follow-up carries its thread link
- **WHEN** `review.2.json` comment 1 continues thread `1.2`
- **THEN** the response's round 2 lists it with `thread: "1.2"` and the
  opener's target

#### Scenario: Fresh plate
- **WHEN** `/api/plate` is fetched for a plate with no review
- **THEN** the thread has no rounds and the turn is `reader`

### Requirement: Review submission

`POST /api/review` with `{"comments"}` SHALL validate the review against the
protocol (every comment carries non-empty text; no comments means done; a
comment's `thread`, when given, names an opener of an earlier round and any
target matches it), write it atomically as the next round — `review.json`
first, then `review.2.json` and so on — and answer 200. A malformed review
SHALL be 400 with `review.malformed`, a bad thread link 400 with
`review.thread`. While the latest round has a comment without a reply the
POST SHALL be 409 with `review.exists`; every refusal leaves the plate
untouched. A done round is no end: the next round may follow it.

#### Scenario: Review lands and serve wakes
- **WHEN** a review with one comment is POSTed while `serve` waits
- **THEN** the endpoint answers 200, `review.json` exists, and `serve` exits 2

#### Scenario: Second review refused
- **WHEN** a review is POSTed to a plate whose `review.json` has a comment
  with no reply
- **THEN** the response is 409 with code `review.exists` and the original
  review is unchanged

#### Scenario: Next round after the replies
- **WHEN** `review.json` has one comment and `reply.json` answers it, and a
  review is POSTed
- **THEN** the endpoint answers 200 and the review lands as `review.2.json`

#### Scenario: Follow-up in the next round
- **WHEN** round 1 is answered and a review is POSTed whose comment carries
  `"thread": "1.1"` and no target
- **THEN** it lands as `review.2.json` and `/api/plate` shows the comment in
  thread 1.1 with the opener's target

#### Scenario: Bad thread link refused
- **WHEN** a POSTed comment carries `"thread": "1.7"` and round 1 has one
  comment
- **THEN** the response is 400 with code `review.thread` and nothing is
  written

#### Scenario: A round after done
- **WHEN** the latest review is `{"comments": []}` and a review with a
  comment is POSTed
- **THEN** it lands as the next round and the turn becomes `agent`

### Requirement: Live events

`GET /api/events` SHALL be a `text/event-stream` emitting `nibble` when a new
nibble file appears, `sealed` when the done marker lands, `review` when a
review round lands (its round number and comment count), and `reply` when a
round gains replies (its round number, answered and total counts) — each
within 2 seconds of the change, so an open reader follows a plate still
being written and a thread still being answered.

#### Scenario: Nibble added while reading
- **WHEN** a client is connected to `/api/events` and `n4.json` is written
- **THEN** it receives a `nibble` event naming 4 within 2 seconds

#### Scenario: Reply lands
- **WHEN** a client is connected and `reply.json` gains a reply to one of
  two comments
- **THEN** it receives a `reply` event for round 1 saying 1 of 2 within 2
  seconds

### Requirement: Code drawer endpoint

`GET /api/code?n=<N>&ref=<I>` SHALL return the lines of nibble N's ref I from
the live repository (diff sides via git), at the trust-resolved position when
shifted, with up to 3 context lines on each side, each line carrying its
1-based number and whether it is inside the referenced range. Unknown nibble
or ref index SHALL be 404. `GET /api/code?round=<K>&comment=<I>&ref=<J>`
SHALL serve ref J of round K's reply to comment I the same way, with unknown
round, comment or ref index 404.

#### Scenario: Drawer content with context
- **WHEN** `/api/code` is fetched for a ref covering lines 3-4 of a 6-line
  file
- **THEN** the response holds lines 1-6 (3 context each side, clamped), lines
  3 and 4 marked in-range

#### Scenario: Reply ref in the drawer
- **WHEN** round 1's reply to comment 1 carries one ref and
  `/api/code?round=1&comment=1&ref=0` is fetched
- **THEN** the response carries that ref's lines, context and trust exactly
  as a nibble ref's would
