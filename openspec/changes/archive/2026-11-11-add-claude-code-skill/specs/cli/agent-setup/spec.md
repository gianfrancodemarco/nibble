# Spec Delta

## Purpose

The `nibble setup` command: installs the agent skill from the binary into a
repository, so one command makes any checkout plate-literate. Claude Code is
the v1 target; other agents arrive later behind the same command.

## ADDED Requirements

### Requirement: Installs the Claude Code skill into the repo

`nibble setup` SHALL install the embedded Claude Code skill into the current
git repository at `.claude/skills/nibble/` — `SKILL.md` plus every example
file, byte-identical to the skill packaged in the binary. Run outside a git
repository it SHALL reject with `cli.repo.missing`. On success it SHALL print
the installed path as the only stdout line (or `{"installed": "<path>"}` with
`--json`).

#### Scenario: Fresh install
- **WHEN** `nibble setup` runs at the root of a git repo with no `.claude/`
  directory
- **THEN** it exits 0, prints `.claude/skills/nibble`'s path, and the
  directory contains `SKILL.md` and the example files from the binary

#### Scenario: Outside a git repo
- **WHEN** `nibble setup` runs outside any git repository
- **THEN** it exits 1 with `cli.repo.missing`

### Requirement: Idempotent and current

Re-running `setup` SHALL be safe: files already matching the embedded content
are left alone, outdated or missing files are rewritten, and files the
embedded skill no longer ships are removed from `.claude/skills/nibble/`.
Files elsewhere under `.claude/` SHALL never be touched. The result after any
run is exactly the embedded skill.

#### Scenario: Re-run is a no-op
- **WHEN** `setup` runs twice in a row
- **THEN** both runs exit 0 and the second changes no file contents

#### Scenario: Upgrade replaces stale content
- **WHEN** `.claude/skills/nibble/SKILL.md` was edited by hand and `setup`
  runs again
- **THEN** it exits 0 and the file matches the embedded content again

### Requirement: Unknown agents are a usage error

`setup` SHALL accept `--agent claude-code` (the default). Any other agent
name SHALL be a usage error (exit 2) naming the supported agents, so future
agents extend the flag without changing the contract.

#### Scenario: Unsupported agent
- **WHEN** `nibble setup --agent cursor` runs
- **THEN** it exits 2 and the error names `claude-code` as the supported agent
