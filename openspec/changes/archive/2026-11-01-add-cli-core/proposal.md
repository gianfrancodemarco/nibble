# Proposal

## Why

The protocol exists but nothing speaks it. The CLI is the one component agents
touch, and the roadmap's next v0.1 item: with `new`/`add`/`done` an agent can
write a validated plate, and with a minimal `serve` the full agent loop (write
→ wait → review wakes you) works end to end — testable before any UI exists.

## What Changes

- Add the `nibble` binary (`cli/`) with five subcommands:
  - `new` — create a plate under `$NIBBLE_HOME/plates` (default `~/.nibble`),
    with `--title` and `--about code|worktree|<base>..<head>`; prints the path.
  - `add` — append a nibble: validates refs against the real repo (including
    diff-ref sides via git), fingerprints them, validates the visual, enforces
    budgets; writes `n<N>.json` atomically. Rejections are fix-it messages with
    protocol error codes.
  - `done` — seal the plate (`{"total": N}`); refuses an empty plate.
  - `lint` — validate a visual JSON file standalone, without touching a plate.
  - `serve` — **minimal, headless**: block until `review.json` appears (or
    `--timeout`), then print the review (markdown, or `--json`) and exit with
    a code that encodes the verdict. No HTTP server yet; that lands with the
    reader. The process ending is what wakes the agent.
- Budgets with `--because`: caption over 40 words, or nibbles beyond the
  per-task budget, are rejected unless `--because "<reason>"` is given; the
  reason is stored in the nibble's `because` field (reserved by the protocol)
  for the reader to print.
- `--json` output on every command; stable exit codes.
- Update the site: roadmap Go CLI item, guide "For agents" page.

**Out of scope:** the HTTP server, SSE and the reader (next change); the tray;
`--about pr:N` sugar and chapters (PR-mode change, needs gh); coverage
reporting in `done` (C9, P1); `export` and `setup`; telemetry.

## Capabilities

### New Capabilities

- `cli/plate-authoring`: the agent-facing command surface — creating, growing
  and sealing plates, standalone visual linting, budgets and their `--because`
  escape, output and exit-code conventions.
- `cli/review-wait`: the blocking wait — how `serve` watches for a review,
  what it prints, how verdicts map to exit codes, timeouts.

### Modified Capabilities

(none — the protocol capabilities are consumed, not changed)

## Impact

- `cli/` gains `cmd/nibble` (main) and `internal/cmd` packages; `internal/protocol`
  gains nothing new except being called.
- New dependency: none planned (stdlib `flag`; git via `exec`).
- Site: `docs/roadmap.html`, `docs/guide/agents.html`.
- Existing specs: consumed as-is (`protocol/*`).
