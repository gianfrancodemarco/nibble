# Proposal

## Why

The CLI, protocol and reader are shipped, but no agent knows nibble exists:
today a plate only gets built if a human dictates every `nibble` command. The
Claude Code skill is the named next item in the PRD — it is what turns the
tooling into the product: the agent learns when a plate is worth building,
how to write captions, visuals and refs that pass validation first try, and
how to drive the serve/review loop. Worked examples are first-class
deliverables and must be real, lint-clean protocol JSON.

## What Changes

- New `skill/` directory in the monorepo (the layout the PRD reserves for it)
  holding the Claude Code skill: a `SKILL.md` plus worked examples — real
  visual documents and a worked plate transcript — that teach:
  - when a plate is worth building (and when plain text is the right answer)
  - the authoring loop: `new` → `add` (caption + visual + refs) → `done` →
    `serve`, reading validation errors and self-correcting
  - caption and visual authoring per kind (map, sequence, timeline, compare),
    with the ref grammar and anchors
  - the budgets (40-word captions, 7/12 nibbles, 12 map nodes) and when
    `--because` is honest to use
  - reading the review that comes back (verdict + targeted comments) and how
    to answer
- Worked example JSON in the skill is validated in CI with `nibble lint` /
  protocol tests, so the examples can never drift from the protocol.
- New `nibble setup` command that installs the skill for Claude Code into the
  current repo (`.claude/skills/nibble/`), idempotent and `--json`-capable
  per the existing CLI conventions. The skill content is embedded in the
  binary, exactly as the reader is. Codex and Cursor remain v0.2.

## Capabilities

### New Capabilities

- `skill/claude-code`: what the installed Claude Code skill must teach and
  the guarantee that its worked examples are valid protocol documents.
- `cli/agent-setup`: the `nibble setup` command — what it installs, where,
  idempotency, and its output/exit conventions.

### Modified Capabilities

(none — plate authoring, serve and the protocol are unchanged; the skill
teaches what they already enforce)

## Impact

- New top-level `skill/` directory (source of truth for the skill content).
- `cli/`: new `setup` subcommand; `go:embed` of the skill files; tests.
- CI: a job/step that lints the skill's worked-example visuals and plate.
- Docs/site: roadmap flips "Claude Code skill" to done; PRD status note
  updated; user guide "Agents" page points at `nibble setup`.
- No protocol, reader or existing-command changes.
