# cli/plate-authoring Specification

## Purpose
The agent-facing command surface for writing plates: create, grow, seal, lint.
Strict validation with machine-readable, correctable errors is the product
promise — an agent mid-run must be able to read a rejection and fix itself.

## Requirements

### Requirement: Creating a plate

`nibble new --title <t> [--about code|worktree|<base>..<head>]` SHALL create a
fresh plate directory under `$NIBBLE_HOME/plates` (default `~/.nibble/plates`),
write a valid `plate.json` (version 1, repo root and `head_sha` discovered from
the working directory's git repository, `about` defaulting to `code`), and
print the plate path as the only stdout line (or `{"plate": "<path>"}` with
`--json`).

#### Scenario: New plate in a git repo
- **WHEN** `nibble new --title "Why checkout slows"` runs inside a git repo
- **THEN** it exits 0 and prints a path whose `plate.json` parses as a valid
  open plate about `code`

#### Scenario: Range about
- **WHEN** `nibble new --title t --about main..feat` runs
- **THEN** `plate.json` carries `{"range": "main..feat"}`

#### Scenario: Outside a git repo
- **WHEN** `nibble new` runs outside any git repository
- **THEN** it exits 1 with error code `cli.repo.missing`

### Requirement: Adding a nibble

`nibble add <plate> --caption <md> --visual <file.json> [--ref <ref>]...`
SHALL validate the visual, validate and fingerprint every ref against the real
repository, and write the next `n<N>.json` atomically (temp file + rename).
On any rejection nothing is written, the error code and a fix-it message go
to stderr (or structured `--json`), and the exit code is 1.

#### Scenario: Add to a sealed plate
- **WHEN** `add` targets a plate whose `done` exists
- **THEN** exit 1 with `plate.sealed`

#### Scenario: Valid nibble is appended
- **WHEN** `add` runs with a valid caption, visual and refs on an open plate
- **THEN** it exits 0 and the plate gains a contiguous `n<N>.json` whose refs
  carry `fp1:` fingerprints

#### Scenario: Ref beyond end of file
- **WHEN** a `--ref` names lines past the file's end
- **THEN** exit 1 with `ref.range.beyond-eof` naming the actual line count,
  and no nibble file is written

### Requirement: Diff-ref sides resolve through git

For diff refs, `add` SHALL resolve the named side through git: `worktree` is
the file as it is on disk (against `HEAD` as base), and `<base>..<head>#side`
reads `git show <side>:<path>`. A side that does not contain the path SHALL
reject with `ref.diff.side-missing`.

#### Scenario: Worktree diff ref resolves
- **WHEN** a `--ref "diff:<path>@worktree:…"` names a file modified on disk
- **THEN** the ref validates against the worktree side and is fingerprinted
  from it

#### Scenario: Path absent from the base side
- **WHEN** a `--ref "diff:<path>@main..feat#base:…"` names a file that only
  exists on `feat`
- **THEN** exit 1 with `ref.diff.side-missing`

### Requirement: Budgets with a reason

`add` SHALL enforce the authoring budgets: a caption of more than 40 words,
or a nibble count exceeding the plate's budget (7 for `code` and `worktree`
plates, 12 for `range` plates), SHALL be rejected with code `cli.budget`
unless `--because "<reason>"` is given, in which case the nibble is written
with the reason in its `because` field. The rejection message SHALL say what
the budget is and how to override it.

#### Scenario: Over-long caption rejected with fix-it
- **WHEN** `add` runs with a 41-word caption and no `--because`
- **THEN** exit 1 with `cli.budget`, the message naming 40 as the limit and
  `--because` as the override

#### Scenario: Reason is stored
- **WHEN** the same `add` runs with `--because "the race needs three actors"`
- **THEN** it exits 0 and the written nibble's `because` equals the reason

### Requirement: Sealing a plate

`nibble done <plate>` SHALL write the `done` marker with the current nibble
count as `{"total": N}`. Sealing an empty plate SHALL be rejected
(`cli.plate.empty`); sealing twice SHALL be idempotent (exit 0, no change).

#### Scenario: Seal then re-seal
- **WHEN** `done` runs twice on a plate with 3 nibbles
- **THEN** both runs exit 0 and `done` reads `{"total": 3}`

### Requirement: Standalone visual linting

`nibble lint <visual.json>` SHALL validate a visual document exactly as `add`
would, without requiring a plate, printing the protocol error code and message
on failure. Exit 0 on valid, 1 on invalid.

#### Scenario: Linting a pixel-smuggling map
- **WHEN** `lint` runs on a map whose node carries an `x` field
- **THEN** exit 1 with `visual.field.unknown`

### Requirement: Output and exit conventions

Every command SHALL support `--json` (one JSON object on stdout; errors as
`{"error": {"code", "message"}}`). Exit codes SHALL be: 0 success, 1
validation or protocol error, 2 usage error (unknown flag or subcommand,
missing required argument). Diagnostics never go to stdout.

#### Scenario: Unknown subcommand
- **WHEN** `nibble frobnicate` runs
- **THEN** exit 2 with usage on stderr and nothing on stdout
