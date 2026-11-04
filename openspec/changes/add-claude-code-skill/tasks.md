# Tasks

## 1. Skill package: examples first

- [x] 1.1 Red: Go test in `cli/internal/cmd` that walks the embedded skill FS
  (empty for now) and asserts it contains `claude-code/SKILL.md` plus at
  least one example visual per kind, and that every `*.json` visual passes
  the same validation `lint` uses (fails: nothing embedded yet).
- [x] 1.2 Write the four example visuals under `cli/skill/claude-code/examples/`
  — one map, sequence, timeline (with what-if `states`) and compare — fresh
  didactic examples around one coherent story, each passing `nibble lint`.
  Verify: `go run ./cmd/nibble lint` exits 0 on each.
- [x] 1.3 Green: single canonical copy at `cli/skill/claude-code/`,
  `//go:embed` in a small exported `cli/skill` package, 1.1's test passes.
  Verify: `go test ./...` green.

## 2. SKILL.md

- [x] 2.1 Write `cli/skill/claude-code/SKILL.md`: frontmatter (name `nibble`,
  trigger description), when a plate is worth building and when not, the
  authoring loop with a complete worked transcript (new → add with captions,
  the example visuals and `--ref` strings → done → serve), one section per
  visual kind pointing at its example, refs and anchors, budgets and an
  honest `--because` (one case each way), a real rejection + corrected retry,
  and reading/answering the review with an `n<N>:<element-id>` comment.
  Verify against the `skill/claude-code` delta spec requirements one by one;
  de-slop pass on the prose.
- [x] 2.2 Red→Green: e2e test that executes the transcript's command sequence
  in a temp git repo using the embedded example visuals and asserts every
  step exits 0 and ends with a sealed plate. Sync the mirror. Verify:
  `go test ./...` green.

## 3. nibble setup

- [x] 3.1 Red: `setup` command tests — fresh install writes
  `.claude/skills/nibble/` byte-identical to the embedded skill and prints
  the path (plain and `--json`); outside a git repo exits 1 with
  `cli.repo.missing`; `--agent cursor` exits 2 naming `claude-code`;
  usage shows `setup`.
- [x] 3.2 Green: `RunSetup` in `cli/internal/cmd/setup.go` wired into the
  dispatcher — repo-root discovery via the existing git plumbing, exact
  mirror sync (write differing, remove extra inside the skill dir, touch
  nothing else), atomic per-file writes. Verify: 3.1 tests pass.
- [x] 3.3 Idempotency tests red→green: second run changes no mtimes/bytes;
  hand-edited `SKILL.md` restored; a file removed from the embedded set is
  deleted on re-run while a stray file elsewhere under `.claude/` survives.
  Verify: `go test ./...` green.

## 4. CI drift check and docs

- [x] 4.1 No drift surface: the skill has a single canonical copy at
  `cli/skill/claude-code/`, embedded from where it lives — nothing for CI
  to diff. Verify: `go test ./...` green covers the package tests.
- [x] 4.2 Docs/site: roadmap flips "Claude Code skill" to done; PRD status
  note names the next item; user guide agents page documents `nibble setup`;
  `cli/README.md` gains `setup` and points at `cli/skill/claude-code/` as
  the single copy. Verify: pages render, wording de-slopped.

## Workflow follow-up

- Archive this change after implementation (`/opsx:archive
  add-claude-code-skill`), syncing the delta specs into the main specs.
