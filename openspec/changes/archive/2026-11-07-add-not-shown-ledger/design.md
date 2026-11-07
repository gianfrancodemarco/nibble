# Design

## Context

See proposal.md for motivation. The pieces this touches: `nibble done`
(cli/internal/cmd/done.go) currently just writes `{"total": N}`;
`ParsePlate` (cli/internal/protocol/plate.go) knows nothing of ledgers; the
git seam is the three-method `gitRepo` interface (cli/internal/cmd/git.go);
the reader strip renders one card per nibble (reader/src/app.ts) with
comments targeted `n<N>[:element]` via `commentTarget` (host.ts). The
binding PRD decision: Go owns every protocol decision; the reader presents
what the API computed.

## Goals / Non-Goals

**Goals:**

- The ledger is computed once, by the CLI, at seal time, from git — and is
  part of the plate on disk, so a portable plate keeps its coverage story.
- An agent can see its coverage *before* sealing (`--check`) without any new
  lifecycle state.
- The reader treats the ledger as one more card: same camera, same drawer,
  same comment flow.

**Non-Goals:**

- No fingerprints or staleness on ledger entries — the ledger states what
  was true at seal, like the seal itself.
- No coverage-quality judgment, no thresholds, no failing exit on poor
  coverage.
- No dial interaction: the ledger card reads the same at overview and
  standard.

## Decisions

### A `ledger.json` file, written by `done` just before the seal

Alternatives: (a) inside the `done` marker — rejected: `done` is the seal
promise, consumers parse it for `total` alone, and the protocol doc sells it
as exactly `{"total": N}`; (b) computed server-side at serve time — rejected:
a portable plate (relative `repo`, no git) could never show its ledger, and a
worktree that moved on after sealing would silently rewrite history the
reviewer is approving. A file keeps the plate self-contained and append-only:
`ledger.json` lands first, then `done` — a crash between the two leaves an
open plate with a stale ledger, which the next `done` simply rewrites.

### Shape mirrors refs, counts carried explicitly

```json
{"shown": 4, "total": 6, "hunks": [
  {"path": "src/retry.ts", "side": "head", "start": 10, "end": 14,
   "added": 5, "removed": 2}
]}
```

`shown`/`total` are stored, not derived, so "everything was shown" is a
statement the reader can render (`{"shown": 6, "total": 6, "hunks": []}`)
and the plate stays meaningful if a tool trims hunks. `side` reuses the ref
grammar's base/head vocabulary. Binary file changes carry
`"binary": true` with `added`/`removed` 0 — a PR adding a PNG must not be
invisible to exactly the feature that promises nothing slips by.

### Diff source per `about`

- `worktree`: `git diff -U0 HEAD` (staged + unstaged, matching what
  `@worktree` refs mean: HEAD → disk) plus `git ls-files --others
  --exclude-standard` for untracked files, each a fully added head-side hunk
  (1..line count).
- `range`: `git diff -U0 <base> <head>` — exact endpoints, consistent with
  how `#base`/`#head` ref sides resolve (`git show <rev>:<path>`); agents
  that want merge-base semantics pass the merge base, as they already must
  for refs.
- Git's default rename detection stands: a pure rename produces no hunks and
  therefore no ledger noise; edits on a renamed file surface under the new
  path, where head-side refs point anyway.

`-U0` gives minimal hunks, so coverage is judged against what actually
changed, not context lines.

### Coverage: path + side + line overlap, any ref of any nibble

A head-side hunk is covered by any ref to the same path whose range overlaps
it and whose content is head-shaped: plain refs, `@worktree` refs, and
`#head` refs. A base-side hunk (pure deletion) is covered by a `#base` ref
overlapping it, or by a head-shaped ref overlapping the deletion seam
`[max(1, c), c+1]` where `c` is git's head-side position (`+c,0`) — the
reviewer who looked at the seam saw the code disappear; without this,
deletions on worktree plates (which have no base-side ref form) could never
be covered. The rev pair on `#head`/`#base` refs is *not* matched against
the plate's range: one plate is about one diff, and policing mixed ranges is
`add`'s concern if it ever becomes one. Any overlap counts — R17 says
"hunks no nibble referenced", and partial-coverage judgment is the
reviewer's job (proposal, out of scope).

### Where the code lives

The hunk model, unified-diff parsing and coverage matching are pure
functions in `cli/internal/protocol` (ledger.go: `ParseUnifiedDiff`,
`Coverage(hunks, refs)`), tested without git; ledger file
validation joins `ParsePlate` (error code `plate.ledger`, including the
about-kind check). The `gitRepo` interface grows what `done` needs —
`DiffRaw(base, head string)` / `DiffWorktree()` returning unified diff text
and `Untracked()` — shelling out in `realGit`, faked in tests like `Show`
is today. No new dependencies: `@@ -a,b +c,d @@` plus the `---`/`+++`/
`Binary files` headers is a small, fixture-tested parser.

### `--check` prints, writes nothing, exits 0

Uncovered hunks are information, not failure: exiting non-zero would teach
agents that honesty is an error state and push them toward padding plates.
The skill owns the judgment ("cover what matters, let the ledger disclose
the rest"). `--check` output is byte-equal in shape to what `done` reports,
so the agent reads one format.

### API: ledger in `/api/plate`, hunks served by `GET /api/ledger?hunk=<I>`

A separate endpoint rather than overloading `/api/code` — that one is keyed
(nibble, ref index) and resolves through stored fingerprints; ledger hunks
have neither. The handler reuses `loadRefContent`-style side resolution and
the `/api/code` response shape (path, lines, in-range marks, a `why` on
degradation), so the drawer renders both without new UI paths. Index-keyed
(`hunk=<I>` into the stored array) like refs are — stable because a sealed
ledger never changes.

### Reader: one ledger card, HTML rows, host comment flow

The ledger card appends to the strip with its own class (`.nibble.ledger` or
sibling) and participates in `setActive`/camera/arrow keys by being part of
the same card query. Hunk rows are HTML (path, range, ±counts, a code chip)
— no SVG visual kind, no dial levels. Selecting a row sets the comment
target via the existing host selection seam extended with a ledger-aware
`commentTarget` (card index beyond the last nibble ⇒ `ledger[:...]`);
clicking the chip opens the drawer on `/api/ledger`. The target grammar
`ledger:<path>:<start>[-<end>]` is self-describing in review JSON, so the
agent maps a comment straight back to a hunk without a lookup table.

## Risks / Trade-offs

- [Huge diffs ⇒ long ledgers] → `-U0` already minimizes hunks; the card
  groups by file and scrolls; the stored file keeps everything (the ledger
  is the honesty mechanism — truncating it would defeat it). Budgets stay
  untouched.
- [Worktree moves between `add` and `done`] → coverage is computed against
  the seal-time diff; refs that drifted show up as reduced coverage, which
  is true, and ref trust already surfaces the drift on the nibbles
  themselves.
- [Unified-diff parsing edge cases (renames, mode changes, CRLF)] →
  fixture-driven parser tests with real `git diff` outputs captured as
  goldens; mode-only changes produce no hunks and are deliberately not
  ledger material.
- [`done` newly depends on git succeeding] → that is the point (a diff plate
  must not seal unchecked), and the error path is machine-readable; `about:
  code` plates keep the old, git-free seal.
- [Older plates/readers] → `ledger.json` was always an ignorable unknown
  file; old plates without one stay valid; the reader renders the card only
  when the API sends a ledger.

## Open Questions

None blocking. (Presentation details of the ledger card — typography,
grouping affordances — follow the existing card styling and the v0.2 "UI
improvement & design adherence" item.)
