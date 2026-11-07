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

### Requirement: Ledger hunk code endpoint

`GET /api/ledger?hunk=<I>` SHALL return ledger hunk I's lines in the shape
of `/api/code`: resolved from the hunk's side (head: worktree or git head;
base: the base revision), with up to 3 context lines each way, each line
numbered and marked in/out of the hunk. It SHALL degrade exactly like refs —
an unavailable root or git side answers with a human-readable reason instead
of lines. An unknown hunk index, or a plate without a ledger, SHALL be 404.

#### Scenario: Head-side hunk served from the worktree
- **WHEN** the ledger lists a head-side hunk in `src/b.ts` and
  `/api/ledger?hunk=0` is fetched with the repo present
- **THEN** the response carries the hunk's lines with context, marked in/out
  of range

#### Scenario: Base-side hunk without git
- **WHEN** the plate's root is a plain directory (no git) and the hunk's side
  is `base`
- **THEN** the response carries a reason the code is unavailable instead of
  lines, and the reader can still comment on the hunk

#### Scenario: No ledger
- **WHEN** `/api/ledger?hunk=0` is fetched for a plate without `ledger.json`
- **THEN** the response is 404
