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

`ledger.json` SHALL carry `shown` and `total` (hunk counts) and `hunks`:
every hunk of the diff in diff order — covered ones flagged `"covered":
true` — each with `path` (repo-relative, same path rules as refs), `side`
(`"head"` or `"base"`), `start`/`end` (`1 ≤ start ≤ end`) and
`added`/`removed` line counts. `total` SHALL equal the hunk count and
`shown` the covered count. Any other shape SHALL be rejected with
`plate.ledger`; unknown fields SHALL be preserved by tools that rewrite the
file.

#### Scenario: Binary hunk
- **WHEN** a hunk declares `"binary": true`
- **THEN** its `added`/`removed` may both be 0 (no lines to count); on a
  non-binary hunk both zero is rejected with `plate.ledger`

#### Scenario: Valid ledger, partly covered
- **WHEN** a plate contains `{"shown": 1, "total": 2, "hunks": [{"path":
  "src/pool.ts", "side": "head", "start": 1, "end": 1, "added": 1,
  "removed": 1, "covered": true}, {"path": "src/retry.ts", "side": "head",
  "start": 10, "end": 14, "added": 5, "removed": 2}]}` as `ledger.json`
- **THEN** the plate parses and exposes the ledger

#### Scenario: Fully covered ledger
- **WHEN** every hunk in `hunks` is `"covered": true` and `shown` equals
  `total`
- **THEN** the plate parses: full coverage is a ledger whose every hunk is
  covered (an empty `hunks` is only valid for an empty diff, `total` 0)

#### Scenario: Malformed ledger rejected
- **WHEN** `ledger.json` has a hunk whose `side` is `"worktree"`, or whose
  `end` is below its `start`, or an absolute `path`
- **THEN** parsing fails with `plate.ledger` naming the offending hunk

#### Scenario: Inconsistent counts rejected
- **WHEN** `shown` differs from the number of covered hunks, or `total` from
  the number of hunks
- **THEN** parsing fails with `plate.ledger` naming the mismatch

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
