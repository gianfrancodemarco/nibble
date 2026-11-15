# Spec Delta

## ADDED Requirements

### Requirement: Code responses carry the lines' address

Every `/api/code` and `/api/ledger` response SHALL carry `at`: the location
part of a v1 ref string for the lines it shows — `<path>` for the worktree
or a plain file, `diff:<path>@worktree`, or `diff:<path>@<base>..<head>#<side>`
— so a client can name a range of those lines as `<at>:<start>-<end>`
without parsing the ref grammar. Every ref `/api/plate` serves SHALL carry
the same `at`.

#### Scenario: Plain ref
- **WHEN** `/api/code` serves nibble 1's ref `src/pool.ts:3-4 the ttl`
- **THEN** the response's `at` is `src/pool.ts`

#### Scenario: Ledger base side on a range plate
- **WHEN** `/api/ledger?file=src/b.ts&side=base` serves a plate about
  `abc..def`
- **THEN** the response's `at` is `diff:src/b.ts@abc..def#base`

#### Scenario: Ledger head side on a worktree plate
- **WHEN** `/api/ledger?file=src/b.ts` serves a worktree plate
- **THEN** the response's `at` is `src/b.ts`

### Requirement: Comment lines in the drawer

`GET /api/code?comment=<id>` SHALL serve the lines of the ref carried by
comment `<id>` (`<round>.<index>`; a continuation serves its opener's ref)
in the shape of a nibble ref's drawer response, with trust computed when
the ref carries a fingerprint and `unverified` otherwise. An unknown id, or
a comment without a ref, SHALL be 404.

#### Scenario: Fingerprinted comment ref
- **WHEN** comment 1.1 carries a fingerprinted ref on lines 15-19 and
  `/api/code?comment=1.1` is fetched
- **THEN** the response holds lines 12-22 with 15-19 marked in-range and a
  computed trust

#### Scenario: Hand-written comment ref
- **WHEN** comment 1.1's ref has no fingerprint
- **THEN** the response holds the lines at the ref's range with trust
  `unverified`

#### Scenario: Follow-up serves the opener's lines
- **WHEN** comment 2.1 continues thread 1.1 and `/api/code?comment=2.1` is
  fetched
- **THEN** the response is comment 1.1's lines

#### Scenario: Comment without lines
- **WHEN** `/api/code?comment=1.2` is fetched and comment 1.2 carries no ref
- **THEN** the response is 404

## MODIFIED Requirements

### Requirement: Plate endpoint with computed trust

`GET /api/plate` SHALL return the plate header, seal state, the review
thread (whose turn it is — `reader`, `agent` or `done` — and every round:
its comments with their ids, targets, `thread` links and, when a comment
carries one, its `ref` with computed trust like a nibble's — a
continuation showing its opener's — each with its reply when one exists,
the reply's refs carrying computed trust like a nibble's), the ledger (when
`ledger.json` exists: `shown`, `total` and the uncovered hunks, in a
presentable shape) and all nibbles, with every stored ref accompanied by
trust computed server-side against the code as it is now: `level` of
`exact`, `shifted` or `stale`, the resolved `line`, and the signed `shift`.
The reader SHALL NOT receive fingerprint hashes as something it must
interpret.

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

#### Scenario: Line comment carries its ref with trust
- **WHEN** comment 1.1 carries a fingerprinted ref on lines that have since
  moved down by two
- **THEN** the response's comment 1.1 carries `ref` with `path`, `start`,
  `end`, `at` and trust `shifted` with `line` at the new position, and a
  comment without a ref carries no `ref`

#### Scenario: Hand-written ref is unverified
- **WHEN** comment 1.1's ref carries no fingerprint
- **THEN** the response's comment ref has trust `unverified`

#### Scenario: Fresh plate
- **WHEN** `/api/plate` is fetched for a plate with no review
- **THEN** the thread has no rounds and the turn is `reader`

### Requirement: Review submission

`POST /api/review` with `{"comments"}` SHALL validate the review against the
protocol (every comment carries non-empty text; no comments means done; a
comment's `thread`, when given, names an opener of an earlier round and any
target matches it; a comment's `ref`, when given, is `{"ref": "<v1 ref
string>"}` with no anchor, verified against the code — a range past the
file's end is refused — and stored with its fingerprint when the code is
available, bare otherwise), write it atomically as the next round —
`review.json` first, then `review.2.json` and so on — and answer 200. A
malformed review SHALL be 400 with `review.malformed`, a bad thread link 400
with `review.thread`, a bad ref 400 with its ref code or `review.ref`.
While the latest round has a comment without a reply the POST SHALL be 409
with `review.exists`; every refusal leaves the plate untouched. A done
round is no end: the next round may follow it.

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

#### Scenario: Line comment is fingerprinted on the way in
- **WHEN** a POSTed comment carries `"ref": {"ref": "src/pool.ts:3-4"}` on
  a plate whose root is present
- **THEN** the written comment's ref carries an `fp1:` fingerprint and line
  hashes, and `/api/plate` reports it `exact`

#### Scenario: Line comment on a missing root
- **WHEN** the plate's root is not on this machine and a POSTed comment
  carries a ref
- **THEN** the review lands with the ref stored bare and `/api/plate`
  reports it `unverified`

#### Scenario: Line comment past the file's end
- **WHEN** a POSTed comment's ref names lines beyond the file's last line
- **THEN** the response is 400 with `ref.range.beyond-eof` and nothing is
  written

#### Scenario: Line comment with an anchor
- **WHEN** a POSTed comment's ref string carries `@cache`
- **THEN** the response is 400 with `review.ref` and nothing is written

#### Scenario: A round after done
- **WHEN** the latest review is `{"comments": []}` and a review with a
  comment is POSTed
- **THEN** it lands as the next round and the turn becomes `agent`
