# cli/review-wait Specification

## Purpose
The blocking half of the loop: an agent runs `nibble serve` and is woken by
the process ending with the human's answer. In this change the wait is
headless — the review file may be written by any tool; the reader arrives in
a later change and plugs into the same contract.

## Requirements

### Requirement: Blocking on the review

`nibble serve <plate> [--timeout <dur>] [--addr <host:port>] [--no-ui]`
SHALL block until the plate's thread gains a review round the agent has not
answered, then print that round and exit. If the plate is missing or invalid
it SHALL exit 1 with the protocol error code before blocking. A done round
is nothing to address, not an end: `serve` waits past it like any answered
round. A plate whose latest round is
unanswered and which this agent has not been handed yet (no serve on this
plate ended with that round) SHALL be printed at once with exit 2, in either
mode — a round that landed while nothing was waiting is still owed. With
the reader up, the round the previous `serve` ended with SHALL be served and
waited on, so the agent can stream replies into the open page, ending only
on the next round, a timeout or an interrupt. With `--no-ui`, any unanswered
round prints and exits at once — the resume path for scripts.

While blocking, `serve` SHALL also serve the reader over HTTP on `127.0.0.1`
(a random free port by default, `--addr` to pin) and print the reader URL as
a `reader: http://…` line to **stderr** before waiting — stdout stays
reserved for the review. `--no-ui` skips the HTTP side entirely. The wait
contract is one code path: a review submitted through the reader ends the
wait exactly like an externally written review file, and the HTTP server
stops when the wait ends.

#### Scenario: Review arrives while waiting
- **WHEN** `serve` is started on an open plate and a valid `review.json` is
  written afterwards
- **THEN** `serve` prints the review and exits within 2 seconds of the write

#### Scenario: Pre-existing review
- **WHEN** `serve --no-ui` starts on a plate whose `review.json` has
  comments and no reply
- **THEN** it prints the review and exits immediately with code 2

#### Scenario: Pre-existing review, with the reader
- **WHEN** `serve` (UI on) starts on a plate whose latest review is done
- **THEN** it announces the reader URL and waits for the next round,
  exiting 5 on `--timeout` with nothing printed

#### Scenario: Answered round waits for the next
- **WHEN** `serve` starts on a plate whose `review.json` has two comments
  and `reply.json` answers both, and `review.2.json` is written afterwards
- **THEN** `serve` prints round 2 and exits with its code within 2 seconds

#### Scenario: Unanswered round stays up for replies
- **WHEN** a `serve` ended with round 1 (comments, no reply) and `serve`
  (UI on) starts again on that plate
- **THEN** it keeps serving; `/api/plate` answers while the agent writes
  `reply.json`, and `serve` exits only on round 2, a timeout or an interrupt

#### Scenario: A round that landed unwatched is printed at once
- **WHEN** `serve` (UI on) starts on a plate whose `review.json` has an
  unreplied comment and no `serve` on this plate ever ended with that round
- **THEN** it prints the round and exits 2 immediately

#### Scenario: Reader URL announced
- **WHEN** `serve` starts on an open plate without `--no-ui`
- **THEN** stderr carries one `reader: http://127.0.0.1:<port>` line before
  the wait and stdout stays empty until the review

#### Scenario: Review submitted through the reader
- **WHEN** a review with one comment is POSTed to the running reader
- **THEN** `serve` prints the review and exits 2, same as a hand-written file

### Requirement: Review exit codes

`serve` SHALL exit with a code that says what the agent owes when it ends:
2 when the latest round has comments the agent has not replied to, 0 when
the round that ended the wait was done (nothing to address now), 5 when it
stopped waiting (timeout or interrupt) with nothing owed. (1 stays reserved for errors.) The mapping is
part of the stable contract agents script against.

#### Scenario: Comments to handle
- **WHEN** a round with at least one comment ends the wait
- **THEN** `serve` exits with code 2

#### Scenario: Done
- **WHEN** a round with no comments ends the wait
- **THEN** `serve` exits with code 0

#### Scenario: Timeout while a round is still owed
- **WHEN** `serve --timeout 100ms` runs with the reader up on a plate whose
  latest round has an unreplied comment and no new round arrives
- **THEN** it exits 2, not 5

#### Scenario: Timeout with nothing owed
- **WHEN** `serve --timeout 100ms` runs on a plate whose latest round is
  fully answered and no new round arrives
- **THEN** it exits 5

### Requirement: Review output

By default `serve` SHALL print the round that ended the wait as markdown: a
`done — no comments` line for an empty review, or a comment count followed
by one section per comment with its id and target; a comment that carries
a ref (or continues a thread whose opener does) SHALL put the ref's
location on its heading and quote the lines it names, numbered, at the
trust-resolved position when the code is readable, with a trust word when
it is not `exact`; a comment that continues a thread SHALL print the
thread's earlier messages (the opener, each reply, each follow-up, in
order, marked reader or agent) before its own text, so the agent reads the
conversation it is answering. The first line SHALL carry the round number
(`· round N`). With `--json` it SHALL print the parsed review object with
`round` added and, on each comment, its `id`, a `history` array of the
thread's earlier messages and, when it has one, its `ref` with computed
`trust` and the current `lines`. Output goes to stdout only after the wait
ends; a timeout with nothing owed prints nothing to stdout.

#### Scenario: Markdown review
- **WHEN** a round-1 review with one comment targeting `n2:cache` is served
- **THEN** stdout contains `comments: 1 · round 1` and a section naming
  `n2:cache` with the comment text

#### Scenario: Line comment quotes its lines
- **WHEN** round 1's comment 1 targets `n2:s4` with ref
  `src/upload/handler.ts:16-18` and the file is readable
- **THEN** its section is headed `## n2:s4 · src/upload/handler.ts:16-18 ·
  1.1` and quotes lines 16, 17 and 18 with their numbers before the
  comment text

#### Scenario: Line comment on moved code
- **WHEN** the comment's fingerprinted ref now resolves `shifted +2`
- **THEN** the section says the lines moved to 18-20 and quotes them there

#### Scenario: Line comment with the code unavailable
- **WHEN** the plate's root is not on this machine
- **THEN** the section keeps the location on its heading and says the
  lines could not be read, instead of quoting them

#### Scenario: Follow-up prints its history
- **WHEN** `review.2.json`'s only comment continues thread 1.2, whose
  opener asked about the enqueue and whose reply said it is retried
- **THEN** the comment's section quotes the opener and the reply, marked as
  reader and agent, before the follow-up's text

#### Scenario: JSON of a later round
- **WHEN** `serve --json` ends on `review.2.json`
- **THEN** stdout is the review object with `"round": 2` and each comment
  carrying `id` and `history`

#### Scenario: JSON of a line comment
- **WHEN** `serve --json` ends on a round whose comment 1 carries a ref
- **THEN** that comment carries `ref` with `path`, `start`, `end`, `trust`
  and the current `lines`

### Requirement: Timeout

With `--timeout <duration>` (default: none), `serve` SHALL stop waiting after
the duration, print a timeout notice to stderr, and exit 5. The plate is left
untouched and a later `serve` can resume waiting.

#### Scenario: Timeout elapses
- **WHEN** `serve --timeout 100ms` runs on a plate that never gets a review
- **THEN** it exits 5 after ~100ms and `review.json` still does not exist

### Requirement: The page outlives the wake-up

When `serve` with the reader up ends because a round landed, it SHALL hand
its listener to a detached keeper that keeps serving the plate on the same
address — API, event stream and page — so replies show in the open tab the
moment they land, with no serve in between. The keeper ends when a later
`serve` takes the address back, on timeout (`--timeout`, else 2 hours), or
when the plate directory is gone; it never prints or wakes anyone.

#### Scenario: Replies show without a re-serve
- **WHEN** `serve` exits 2 on a posted round and the agent writes
  `reply.json` before running `serve` again
- **THEN** `GET /api/plate` on the same address still answers and carries
  the reply, and a connected event stream receives `reply`

#### Scenario: Headless leaves no keeper
- **WHEN** `serve --no-ui` ends with a round
- **THEN** nothing keeps serving and no address is recorded

### Requirement: Serve takes the address back

`serve` SHALL record the address it served, in a dotfile in the plate
directory that the protocol ignores. A later `serve` on that plate without
`--addr` SHALL reuse the recorded address, and in either case SHALL ask the
keeper on it to stand down before binding, so the tab that was left open
stays on the same URL through the whole loop; an explicit `--addr` on
another port is honoured, and a dead keeper is ignored.

#### Scenario: The next serve lands on the same URL
- **WHEN** a `serve` on `127.0.0.1:52314` ended with a round and the agent
  runs `serve <plate>` with no `--addr`
- **THEN** stderr announces `reader: http://127.0.0.1:52314` and the plate is
  served there by the new `serve`, with the keeper gone

#### Scenario: Keeper gone, record stale
- **WHEN** the recorded address answers nothing
- **THEN** `serve` binds it (or a free port) and carries on
