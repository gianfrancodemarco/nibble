# reader/http-api Specification

## Purpose

The reader's data plane. Go owns all protocol logic: the reader receives
computed trust and resolved code, never hashes or raw plates. Served by
`nibble serve` on loopback while it waits for the review.

## Requirements

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

### Requirement: Ledger file code endpoint

`GET /api/ledger?file=<path>&side=<head|base>` (side defaults to `head`)
SHALL return all of that file-and-side's uncovered hunks as one code view in
the shape of `/api/code`: ±3-line segments around each hunk (covered ones
included), merged where they meet, each line marked in-range only when an
uncovered hunk holds it. Resolution and degradation
follow refs. No matching hunks, or no ledger, SHALL be 404.

#### Scenario: Head-side file served from the worktree
- **WHEN** the ledger lists two head-side hunks in `src/b.ts` and
  `/api/ledger?file=src/b.ts` is fetched with the repo present
- **THEN** the response carries both hunks' lines with context, every
  hunk line marked in-range, and no line repeated

#### Scenario: Base-side file without git
- **WHEN** the plate's root is a plain directory (no git) and the file's
  uncovered lines are on the `base` side
- **THEN** the response carries a reason the code is unavailable instead of
  lines, and the reader can still comment on the file

#### Scenario: No ledger
- **WHEN** `/api/ledger?file=src/b.ts` is fetched for a plate without
  `ledger.json`
- **THEN** the response is 404

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

### Requirement: Serving from files — per-ref degradation

A plate SHALL be servable from whatever is actually available, degrading per
ref rather than refusing. The plate's `repo` (absolute, or relative to the
plate directory) names the root refs resolve against. Three tiers:

- Root present and it is a git repository's top level: everything works.
- Root present without git: plain and `@worktree` refs get real trust and
  code from the files; `@<base>..<head>` diff refs report trust `unverified`.
- Root missing: the plate still opens and the review loop still works; every
  ref reports `unverified`.

`unverified` is a presentation-level trust value meaning "could not check" —
it is never written to disk and is distinct from `stale` ("checked, and the
code moved"). `/api/plate` SHALL say what was available (root found, git
found) so the reader can explain; `/api/code` for an unverifiable ref SHALL
carry a human-readable reason instead of lines.

#### Scenario: Files without git
- **WHEN** a plate's root is a plain directory holding the referenced files,
  not a git repository
- **THEN** plain refs report real trust (`exact` when unchanged) with code in
  the drawer, and a `base..head` diff ref reports `unverified`

#### Scenario: Root missing entirely
- **WHEN** a plate's root path does not exist on this machine
- **THEN** `/api/plate` serves the plate with every ref `unverified`, and a
  posted review still ends `serve` with the review's exit code

#### Scenario: Golden fixture serves from the checkout
- **WHEN** `nibble serve` runs on `protocol/golden/plates/cli-authored/plate`,
  whose `repo` is the relative `../repo` snapshot committed next to it
- **THEN** its plain and worktree refs report `exact`

### Requirement: Loopback only, errors in the CLI shape

The server SHALL bind `127.0.0.1` only. API errors SHALL use the CLI's JSON
error shape `{"error":{"code","message"}}` with protocol/CLI error codes.

#### Scenario: Error shape
- **WHEN** any API request fails validation
- **THEN** the body is `{"error":{"code":"<stable code>","message":...}}`

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
