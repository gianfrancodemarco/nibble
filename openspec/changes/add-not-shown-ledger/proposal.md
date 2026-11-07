# Proposal

## Why

PR review is nibble's first use case, and its core risk is false confidence:
a walkthrough shows the five interesting places and the reviewer approves a
diff whose sixth change nobody looked at. The PRD makes the answer part of
the product promise (R17, P0; §11 MVP): every plate about a diff ends with a
**not-shown ledger** — the diff hunks no nibble referenced, open to comments.
It is the last v0.1 roadmap item; the PRD's decision log and the user guide
(guide/answering.html) already name it as the next thing.

## What Changes

- **The protocol gains a `ledger.json` file**: an optional plate file, written
  at seal time, listing the diff hunks (path, side, line range, +/- counts)
  that no ref in any nibble covered — plus the totals, so "everything was
  shown" is a statement, not an absence. Only plates whose `about` names a
  diff (`worktree`, `range`, later `pr`) carry one. Malformed ledgers are
  rejected with a new `plate.ledger` error code.
- **`nibble done` becomes the coverage check** (as the PRD's CLI sketch always
  said: "coverage check, seals the plate"). On a diff plate it computes the
  diff with git (worktree: `HEAD` vs disk plus untracked files; range:
  `base` vs `head`), matches every hunk against every ref of every nibble,
  writes `ledger.json`, then seals — and reports the not-shown count. A new
  `nibble done --check` runs the same computation and prints the would-be
  ledger **without sealing**, so an agent can see what it missed while it can
  still add a nibble. The agent never computes the ledger itself; the CLI
  owns it, like every protocol decision.
- **The reader ends every diff plate with the ledger card**: after the last
  nibble, a final card lists the uncovered hunks grouped by file; each entry
  opens its code in the drawer (served by the Go server from the right diff
  side), and each entry — or the ledger as a whole — can take review comments
  (targets `ledger` and `ledger:<path>:<start>[-<end>]`), like anything else
  on the plate. A sealed diff plate with an empty ledger says so explicitly
  ("every hunk of the diff was shown").
- **The skill teaches the loop's new last step**: run `nibble done --check`,
  read what you missed, cover what matters or let the ledger disclose it
  honestly, then seal. The ledger is the product being honest, not the agent
  failing.

## Capabilities

### New Capabilities

None — the ledger is new behavior of the existing plate lifecycle, CLI
sealing, API and reader shell.

### Modified Capabilities

- `protocol/plate-format`: `ledger.json` joins the plate folder — its shape,
  when it may be present, and the `plate.ledger` error code.
- `cli/plate-authoring`: sealing a diff plate computes coverage and writes
  the ledger; `done --check` previews it without sealing.
- `reader/http-api`: `/api/plate` carries the ledger; a ledger entry's code
  is servable for the drawer with the same per-ref degradation rules.
- `reader/ui-shell`: the ledger card at the end of the strip, its drawer
  affordance, and the `ledger` / `ledger:<hunk>` comment targets.

(The skill teaches the new `done --check` step too — prompt content, updated
as a task like the blast-radius change did, not a spec delta.)

## Impact

- `protocol/PROTOCOL.md` (ledger file, error code index), new golden
  fixtures: plates with a valid ledger (covered and uncovered), invalid
  ledgers for `plate.ledger`.
- `cli/internal/protocol`: ledger parsing/validation in `ParsePlate`;
  coverage matching logic (pure, testable).
- `cli/internal/cmd`: git diff plumbing on the `gitRepo` seam (`done` is the
  only consumer), `done` rewrite, `--check`; `done` output and `--json` gain
  the ledger summary.
- `cli/internal/cmd/http.go`: ledger in `/api/plate`, a ledger-code endpoint
  for the drawer.
- `reader/src`: ledger card rendering, comment targets, drawer wiring;
  rebuilt committed `app.js`.
- `cli/skill/claude-code/SKILL.md`: the `--check` step in the worked review.
- `docs/` site: roadmap (last v0.1 item done), PRD shipped note, guide pages
  that describe the ledger, cli/README.md and protocol docs.

## Out of Scope

- Ledgers for `about: pr` plates — the CLI cannot create pr plates yet; when
  pr support lands it resolves to a range and inherits this behavior.
- Any notion of *partial* hunk coverage or coverage quality — a hunk any ref
  overlaps is shown; judging whether it was shown *well* is the reviewer's
  job.
- Re-checking the ledger against a worktree that changed after sealing
  (ledger entries carry no fingerprints; the ledger states what was true at
  seal time, like the seal itself).
- Unsealing, or mutating a plate the check finds wanting — `--check` exists
  precisely so the agent looks before it seals.
- Churn colouring (R14's other half) and chapter flow (v0.2).
