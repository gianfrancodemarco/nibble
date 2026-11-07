# Spec Delta

## MODIFIED Requirements

### Requirement: Plate folder layout

A plate SHALL be a single directory containing `plate.json` (the header),
zero or more nibble files named `n1.json`, `n2.json`, … in reading order,
an optional `done` marker file, an optional `ledger.json` (the not-shown
ledger), and an optional `review.json`. No other files are part of protocol
v1; consumers SHALL ignore unknown files.

#### Scenario: Minimal valid plate
- **WHEN** a directory contains a valid `plate.json` and a valid `n1.json`
- **THEN** it parses as a valid plate with one nibble and no review

#### Scenario: Unknown extra file
- **WHEN** a plate directory also contains an unrelated file (e.g. `.DS_Store`)
- **THEN** parsing succeeds and the file is ignored

## ADDED Requirements

### Requirement: Ledger file shape

`ledger.json` SHALL carry `shown` and `total` (hunk counts, `0 ≤ shown ≤
total`) and `hunks`: the uncovered hunks, each with `path` (repo-relative,
same path rules as refs), `side` (`"head"` or `"base"`), `start`/`end`
(`1 ≤ start ≤ end`) and `added`/`removed` line counts. Any other shape SHALL
be rejected with `plate.ledger`; unknown fields SHALL be preserved by tools
that rewrite the file.

#### Scenario: Binary hunk
- **WHEN** a hunk declares `"binary": true`
- **THEN** its `added`/`removed` may both be 0 (no lines to count); on a
  non-binary hunk both zero is rejected with `plate.ledger`

#### Scenario: Valid ledger with uncovered hunks
- **WHEN** a plate contains `{"shown": 4, "total": 6, "hunks": [{"path":
  "src/retry.ts", "side": "head", "start": 10, "end": 14, "added": 5,
  "removed": 2}, …]}` as `ledger.json`
- **THEN** the plate parses and exposes the ledger

#### Scenario: Fully covered ledger
- **WHEN** `ledger.json` is `{"shown": 6, "total": 6, "hunks": []}`
- **THEN** the plate parses: an empty ledger states full coverage, it is not
  an error

#### Scenario: Malformed ledger rejected
- **WHEN** `ledger.json` has a hunk whose `side` is `"worktree"`, or whose
  `end` is below its `start`, or an absolute `path`
- **THEN** parsing fails with `plate.ledger` naming the offending hunk

### Requirement: Ledger only on diff plates

A `ledger.json` SHALL be valid only on a plate whose `about` names a diff
(`worktree`, `{"range": …}` or `{"pr": …}`); on an `about: code` plate it
SHALL be rejected with `plate.ledger` — there is no diff for a ledger to
cover. A diff plate without a `ledger.json` SHALL remain valid (plates
predating the ledger, or sealed by other tools).

#### Scenario: Ledger on a code plate rejected
- **WHEN** a plate with `"about": "code"` contains a `ledger.json`
- **THEN** parsing fails with `plate.ledger`

#### Scenario: Diff plate without a ledger still valid
- **WHEN** a sealed `about: worktree` plate has no `ledger.json`
- **THEN** the plate parses with no ledger
