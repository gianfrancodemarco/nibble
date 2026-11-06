# reader/http-api Specification

## Purpose

The reader's data plane. Go owns all protocol logic: the reader receives
computed trust and resolved code, never hashes or raw plates. Served by
`nibble serve` on loopback while it waits for the review.

## Requirements

### Requirement: Plate endpoint with computed trust

`GET /api/plate` SHALL return the plate header, seal state, review (if any),
the ledger (when `ledger.json` exists: `shown`, `total` and the uncovered
hunks, in a presentable shape) and all nibbles, with every stored ref
accompanied by trust computed server-side against the code as it is now:
`level` of `exact`, `shifted` or `stale`, the resolved `line`, and the
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

### Requirement: Code drawer endpoint

`GET /api/code?n=<N>&ref=<I>` SHALL return the lines of nibble N's ref I from
the live repository (diff sides via git), at the trust-resolved position when
shifted, with up to 3 context lines on each side, each line carrying its
1-based number and whether it is inside the referenced range. Unknown nibble
or ref index SHALL be 404.

#### Scenario: Drawer content with context
- **WHEN** `/api/code` is fetched for a ref covering lines 3-4 of a 6-line
  file
- **THEN** the response holds lines 1-6 (3 context each side, clamped), lines
  3 and 4 marked in-range

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
protocol (every comment carries non-empty text; no comments means done),
write `review.json` atomically, and answer 200. A malformed review SHALL be
400 with `review.malformed`. A plate that already has a review SHALL answer
409 with `review.exists` and leave the existing review untouched;
`review.exists` joins the protocol error index.

#### Scenario: Review lands and serve wakes
- **WHEN** a review with one comment is POSTed while `serve` waits
- **THEN** the endpoint answers 200, `review.json` exists, and `serve` exits 2
  within its poll budget

#### Scenario: Second review refused
- **WHEN** a review is POSTed to a plate whose `review.json` exists
- **THEN** the response is 409 with code `review.exists` and the original
  review is unchanged

### Requirement: Live events

`GET /api/events` SHALL be a `text/event-stream` emitting `nibble` when a new
nibble file appears, `sealed` when the done marker lands, and `review` when a
review lands — each within 2 seconds of the change, so an open reader follows
a plate still being written.

#### Scenario: Nibble added while reading
- **WHEN** a client is connected to `/api/events` and `n4.json` is written
- **THEN** it receives a `nibble` event naming 4 within 2 seconds

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
