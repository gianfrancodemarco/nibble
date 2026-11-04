# Design

## Context

See proposal.md — Why. Constraints that shape the approach:

- The PRD's monorepo layout names top-level `skill/` as where the agent skill
  and worked examples live; humans should find it there.
- The Go module is `cli/`, and `go:embed` cannot reach above the package
  directory — the same constraint the reader hit, solved there with a
  committed copy under `cli/internal/cmd/ui/` and a CI drift check.
- The CLI's conventions are already specified (`cli/plate-authoring`:
  `--json`, exit codes 0/1/2, `cli.repo.missing`) and `cmd.Ctx` + in-process
  `Run*` functions make commands testable without exec.
- TDD is binding; worked examples double as conformance fixtures.

## Goals / Non-Goals

**Goals:**

- One command (`nibble setup`) makes a checkout plate-literate for Claude
  Code, with nothing to download: the skill ships inside the binary.
- Skill content that can never drift from the protocol: examples are linted
  by the Go test suite, and the transcript is executed as an e2e test.

**Non-Goals:**

- Codex and Cursor installation (v0.2, behind the same `--agent` flag).
- A user-level (`~/.claude`) install target; per-repo is the v1 default.
- Teaching features that don't exist yet (detail dial, blast radius,
  not-shown ledger) — the skill documents the shipped surface only.

## Decisions

**D1 — canonical source at `skill/claude-code/`, committed mirror embedded
from `cli/internal/cmd/skillfs/claude-code/`.** `go:embed` forces a copy
inside the module; the reader already set the pattern (source in `reader/`,
committed `ui/app.js`, CI `git diff --exit-code`). A `cmp -r`-style CI step
keeps mirror and source identical. Alternative — keeping the only copy inside
`cli/internal/` — rejected: the PRD reserves top-level `skill/` and that is
where a human (or an agent reading the repo) will look.

**D2 — install target is `.claude/skills/nibble/` at the git repo root.**
Project-level skills travel with the repo, show up in PRs, and opt in one
repo at a time — the calm default. Repo-root discovery reuses the existing
git plumbing (`cli/internal/cmd/git.go`), and running outside a repo is the
already-specified `cli.repo.missing`. Alternative — `~/.claude/skills` —
deferred; it's a flag away if dogfooding wants it.

**D3 — `setup` syncs to an exact mirror.** Write files whose bytes differ,
remove files inside `.claude/skills/nibble/` that the embedded skill no
longer ships, touch nothing else under `.claude/`. This makes re-runs no-ops,
upgrades one command, and hand-edits self-healing. Alternative — refuse to
overwrite local edits — rejected: the binary is the source of truth and a
diverged skill silently mis-teaches; anyone customizing can fork the
directory under another name.

**D4 — examples are enforced, not just reviewed.** A Go test walks the
embedded skill FS and runs every `*.json` visual through the same validation
`lint` uses; a second e2e test executes the SKILL.md transcript's command
sequence (new → add ×N with the example visuals → done) in a temp repo and
asserts exit 0 throughout. CI needs no new job: `go test ./...` already runs
both; the only new CI line is the mirror drift check.

**D5 — SKILL.md structure.** Frontmatter (`name: nibble`, `description`
naming the triggers: reviewing a PR/worktree, explaining architecture or an
incident), then: when to build a plate / when not to; the authoring loop with
the transcript; a section per visual kind with its example file; refs and
anchors; budgets and `--because`; reading and answering the review. Examples
live next to it as plain JSON files referenced by relative path. Prose is
written in the repo's voice (de-slop pass before it ships).

## Risks / Trade-offs

- [Skill prose goes stale as commands evolve] → the transcript is an e2e
  test and the examples are linted; prose that names flags wrong will still
  pass, so command surface changes must grep `skill/` (noted in tasks as a
  convention, and the drift check makes the mirror impossible to forget).
- [Two copies of the skill in the repo] → CI drift step fails any PR that
  edits one side only; same trade the reader already made.
- [Deleting files inside `.claude/skills/nibble/` on sync] → scoped strictly
  to that directory, which `setup` owns by contract; spec'd and tested.

## Open Questions

(none)
