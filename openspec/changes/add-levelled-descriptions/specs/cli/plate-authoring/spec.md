# Spec Delta

## MODIFIED Requirements

### Requirement: Creating a plate

`nibble new --title <t> [--description <md>] [--description-standard <md>]
[--about code|worktree|<base>..<head>]` SHALL create a fresh plate directory
under `$NIBBLE_HOME/plates` (default `~/.nibble/plates`), write a valid
`plate.json` (version 1, repo root and `head_sha` discovered from the working
directory's git repository, `about` defaulting to `code`, the description
variants stored under `description` when given), and print the plate path as
the only stdout line (or `{"plate": "<path>"}` with `--json`).
`--description-standard` without `--description` SHALL be rejected
(`plate.description`): the overview variant is what makes a description
skimmable.

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

#### Scenario: Plate description stored
- **WHEN** `nibble new --title t --description "the gist"
  --description-standard "the full story"` runs
- **THEN** `plate.json` carries both variants under `description`

#### Scenario: Standard variant alone rejected
- **WHEN** `nibble new --title t --description-standard "only long"` runs
- **THEN** exit 1 with `plate.description` and a message asking for the
  overview variant

### Requirement: Adding a nibble

`nibble add <plate> --title <md> [--description <md>]
[--description-standard <md>] --visual <file.json> [--ref <ref>]...` SHALL
validate the visual, validate and fingerprint every ref against the real
repository, and write the next `n<N>.json` atomically (temp file + rename),
with the description variants stored under `description` when given. The
removed `--caption` flag SHALL be a usage error (exit 2) whose message names
`--title`. `--description-standard` without `--description` SHALL be rejected
(`nibble.description`). On any rejection nothing is written, the error code
and a fix-it message go to stderr (or structured `--json`), and the exit code
is 1.

#### Scenario: Add to a sealed plate
- **WHEN** `add` targets a plate whose `done` exists
- **THEN** exit 1 with `plate.sealed`

#### Scenario: Valid nibble is appended
- **WHEN** `add` runs with a valid title, visual and refs on an open plate
- **THEN** it exits 0 and the plate gains a contiguous `n<N>.json` whose refs
  carry `fp1:` fingerprints

#### Scenario: Ref beyond end of file
- **WHEN** a `--ref` names lines past the file's end
- **THEN** exit 1 with `ref.range.beyond-eof` naming the actual line count,
  and no nibble file is written

#### Scenario: Descriptions stored on the nibble
- **WHEN** `add` runs with `--description "skim"` and
  `--description-standard "full"`
- **THEN** the written nibble's `description` carries both variants

#### Scenario: Old flag names the new one
- **WHEN** `add` runs with `--caption "the claim"`
- **THEN** exit 2 and the usage error names `--title`

## REMOVED Requirements

### Requirement: Budgets with a reason
**Reason**: Restructured for the caption → title rename and the new
description budgets; replaced by "Text and count budgets with a reason".
**Migration**: The 40-word budget now applies to `--title`; description
variants get their own budgets. `--because` still overrides every budget.

## ADDED Requirements

### Requirement: Text and count budgets with a reason

`new` and `add` SHALL enforce the authoring budgets — title ≤ 40 words,
description `overview` ≤ 100 words, description `standard` ≤ 250 words,
nibble count ≤ the plate's budget (7 for `code`/`worktree`, 12 for `range`) —
rejecting with `cli.budget` unless `--because "<reason>"` is given, which
stores the reason in the written file's `because` field. The rejection names
the exceeded budget, its limit, and the override.

#### Scenario: Over-long title rejected with fix-it
- **WHEN** `add` runs with a 41-word title and no `--because`
- **THEN** exit 1 with `cli.budget`, the message naming 40 as the limit and
  `--because` as the override

#### Scenario: Over-long overview description rejected
- **WHEN** `add` runs with a 101-word `--description` and no `--because`
- **THEN** exit 1 with `cli.budget`, the message naming the overview
  description budget of 100

#### Scenario: Over-long standard description rejected
- **WHEN** `new` runs with a 251-word `--description-standard` and no
  `--because`
- **THEN** exit 1 with `cli.budget`, the message naming the standard
  description budget of 250

#### Scenario: Reason is stored
- **WHEN** an over-budget `add` runs with `--because "the race needs three
  actors"`
- **THEN** it exits 0 and the written nibble's `because` equals the reason
