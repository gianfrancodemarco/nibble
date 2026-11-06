# cli/review-wait Specification

## Purpose
The blocking half of the loop: an agent runs `nibble serve` and is woken by
the process ending with the human's answer. In this change the wait is
headless — the review file may be written by any tool; the reader arrives in
a later change and plugs into the same contract.

## Requirements

### Requirement: Blocking on the review

`nibble serve <plate> [--timeout <dur>] [--addr <host:port>] [--no-ui]`
SHALL block until the plate's `review.json` exists and parses, then print the
review and exit. If the plate is missing or invalid it SHALL exit 1 with the
protocol error code before blocking. A plate whose `review.json` already
exists SHALL print and exit immediately.

While blocking, `serve` SHALL also serve the reader over HTTP on `127.0.0.1`
(a random free port by default, `--addr` to pin) and print the reader URL as
a `reader: http://…` line to **stderr** before waiting — stdout stays
reserved for the review. `--no-ui` skips the HTTP side entirely. The wait
contract is one code path: a review submitted through the reader ends the
wait exactly like an externally written `review.json`, and the HTTP server
stops when the wait ends.

#### Scenario: Review arrives while waiting
- **WHEN** `serve` is started on an open plate and a valid `review.json` is
  written afterwards
- **THEN** `serve` prints the review and exits within 2 seconds of the write

#### Scenario: Pre-existing review
- **WHEN** `serve --no-ui` starts on a plate that already has a valid review
- **THEN** it prints the review and exits immediately with the review's code

#### Scenario: Pre-existing review, with the reader
- **WHEN** `serve` (UI on) starts on a plate that already has a valid review
- **THEN** it prints the review, announces the reader URL, and keeps serving
  the plate read-only — the review visible, input locked — until interrupted
  or `--timeout` elapses, then exits with the review's code (not 5: the
  review exists)

#### Scenario: Reader URL announced
- **WHEN** `serve` starts on an open plate without `--no-ui`
- **THEN** stderr carries one `reader: http://127.0.0.1:<port>` line before
  the wait and stdout stays empty until the review

#### Scenario: Review submitted through the reader
- **WHEN** a review with one comment is POSTed to the running reader
- **THEN** `serve` prints the review and exits 2, same as a hand-written file

### Requirement: Review exit codes

`serve` SHALL exit with a code that encodes the review: 0 done (no
comments), 2 comments to handle, 5 timeout. (1 stays reserved for errors.)
The mapping is part of the stable contract agents script against.

#### Scenario: Comments to handle
- **WHEN** the review carries at least one comment
- **THEN** `serve` exits with code 2

#### Scenario: Done
- **WHEN** the review carries no comments
- **THEN** `serve` exits with code 0

### Requirement: Review output

By default `serve` SHALL print the review as markdown: a `done — no
comments` line for an empty review, or a comment count followed by one
section per comment with its target and trust context. With `--json` it SHALL
print the parsed review object instead. Output goes to stdout only after the
wait ends.

#### Scenario: Markdown review
- **WHEN** a review with one comment targeting `n2:cache` is served
- **THEN** stdout contains `comments: 1` and a section naming `n2:cache`
  with the comment text

### Requirement: Timeout

With `--timeout <duration>` (default: none), `serve` SHALL stop waiting after
the duration, print a timeout notice to stderr, and exit 5. The plate is left
untouched and a later `serve` can resume waiting.

#### Scenario: Timeout elapses
- **WHEN** `serve --timeout 100ms` runs on a plate that never gets a review
- **THEN** it exits 5 after ~100ms and `review.json` still does not exist
