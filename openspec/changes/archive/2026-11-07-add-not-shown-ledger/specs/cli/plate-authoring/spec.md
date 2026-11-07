# Spec Delta

## MODIFIED Requirements

### Requirement: Sealing a plate

`nibble done <plate>` SHALL write the `done` marker with the current nibble
count as `{"total": N}`. On a plate whose `about` names a diff the CLI can
resolve (`worktree`, `range`), it SHALL first compute the not-shown ledger
and write `ledger.json`, and its output SHALL report the not-shown count
(`--json` includes the full ledger). Sealing an empty plate SHALL be rejected
(`cli.plate.empty`); sealing twice SHALL be idempotent (exit 0, no change,
ledger left as sealed).

#### Scenario: Seal then re-seal
- **WHEN** `done` runs twice on a plate with 3 nibbles
- **THEN** both runs exit 0 and `done` reads `{"total": 3}`

#### Scenario: Sealing a worktree plate writes the ledger
- **WHEN** `done` runs on an `about: worktree` plate whose nibbles cover only
  part of the uncommitted diff
- **THEN** `ledger.json` lists the uncovered hunks, and the success line
  reports how many of the diff's hunks were not shown

#### Scenario: Sealing a code plate stays ledger-free
- **WHEN** `done` runs on an `about: code` plate
- **THEN** the plate is sealed with no `ledger.json` and no coverage output

## ADDED Requirements

### Requirement: Coverage computation

At seal (and `--check`) time the CLI SHALL compute the diff itself via git —
`worktree`: `HEAD` against the working tree plus untracked files as fully
added hunks; `range`: `<base>` against `<head>` — and SHALL mark a hunk
covered when any ref of any nibble names the same path and overlaps its
lines on the matching side. The agent never computes the ledger. Hunks that
only add or change lines live on the `head` side; hunks that only remove
lines live on the `base` side.

#### Scenario: Overlapping ref covers a hunk
- **WHEN** a hunk changes `src/a.ts` lines 10–14 and some nibble carries
  `src/a.ts:12-30` or `diff:src/a.ts@worktree:14` or a head-side range ref
  overlapping it
- **THEN** the hunk is covered and stays out of the ledger

#### Scenario: Untouched file in the diff is uncovered
- **WHEN** the diff also changes `src/b.ts`, which no ref in any nibble names
- **THEN** the ledger lists `src/b.ts`'s hunks

#### Scenario: Untracked file counts as diff
- **WHEN** an `about: worktree` plate seals while a new untracked file exists
- **THEN** that file appears as a fully added hunk, covered only if a ref
  names it

#### Scenario: Pure deletion covered at its seam
- **WHEN** a hunk only removes base lines and a head-side ref spans the line
  where the removal happened
- **THEN** the deletion hunk is covered — the reader saw the seam the code
  disappeared from

### Requirement: Coverage preview without sealing

`nibble done <plate> --check` SHALL compute and print the would-be ledger
(the same output `done` would report, full ledger with `--json`) and write
nothing — no `ledger.json`, no `done` marker — exiting 0, so an agent can
see what it missed while the plate is still open to another `add`. On an
`about: code` plate `--check` SHALL say there is nothing to check and write
nothing. `--check` on a sealed plate SHALL report the sealed ledger as it is.

#### Scenario: Check leaves the plate open
- **WHEN** `done --check` runs on an open worktree plate with uncovered hunks
- **THEN** it exits 0, prints the uncovered hunks, and the plate still
  accepts `nibble add`

#### Scenario: Check then cover then seal
- **WHEN** an agent runs `done --check`, adds a nibble reffing the reported
  hunk, and runs `done`
- **THEN** the sealed `ledger.json` no longer lists that hunk

### Requirement: Coverage failures are correctable errors

When the ledger cannot be computed — the repo is gone, git fails, a range
side no longer resolves — `done` SHALL reject with a machine-readable error
and seal nothing, so a plate never silently seals without the coverage check
its `about` promises. The message SHALL name what failed and how to proceed.

#### Scenario: Range side gone
- **WHEN** `done` runs on an `about: main..feat` plate after `feat` was
  deleted
- **THEN** it exits 1 with an error naming the unresolvable side, and neither
  `done` nor `ledger.json` is written
