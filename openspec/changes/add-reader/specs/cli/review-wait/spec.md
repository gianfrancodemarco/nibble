# Spec Delta

## MODIFIED Requirements

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
- **THEN** it prints the review and exits immediately with the verdict's code

#### Scenario: Pre-existing review, with the reader
- **WHEN** `serve` (UI on) starts on a plate that already has a valid review
- **THEN** it prints the review, announces the reader URL, and keeps serving
  the plate read-only — the review visible, input locked — until interrupted
  or `--timeout` elapses, then exits with the verdict's code (not 5: the
  review exists)

#### Scenario: Reader URL announced
- **WHEN** `serve` starts on an open plate without `--no-ui`
- **THEN** stderr carries one `reader: http://127.0.0.1:<port>` line before
  the wait and stdout stays empty until the review

#### Scenario: Review submitted through the reader
- **WHEN** a review with verdict `question` is POSTed to the running reader
- **THEN** `serve` prints the review and exits 3, same as a hand-written file
