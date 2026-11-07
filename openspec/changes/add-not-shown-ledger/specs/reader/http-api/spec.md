# Spec Delta

## MODIFIED Requirements

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

## ADDED Requirements

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
