# nibble CLI

The agent-facing half of nibble: seven commands over the
[protocol](../protocol/PROTOCOL.md). Agents drive these; humans mostly don't.

```sh
go install github.com/gianfrancodemarco/nibble/cli/cmd/nibble@main
```

## Commands

```sh
nibble new   --title <t> [--description <md>] [--description-standard <md>]
             [--about code|worktree|<base>..<head>] [--json]
             # creates a plate under $NIBBLE_HOME/plates (default ~/.nibble/plates),
             # prints its path — the only stdout line

nibble add   <plate> --title <md> [--description <md>] [--description-standard <md>]
             --visual <file.json> [--ref <ref>]... [--because <reason>] [--json]
             # validates the visual and every ref against the real repo
             # (diff-ref sides resolved through git), fingerprints refs,
             # writes n<N>.json atomically; rejections are fix-its with
             # protocol error codes and nothing gets written

nibble done  <plate> [--check] [--json]
             # the coverage check, then the seal. On a worktree/range plate
             # it computes the diff via git, matches every hunk against every
             # nibble's refs, writes the not-shown ledger (ledger.json), then
             # seals with {"total": N} and reports the not-shown count
             # (--json carries the full ledger); a failed check (git gone, a
             # range side unresolvable) is cli.ledger and seals nothing.
             # --check prints the would-be ledger and writes NOTHING, so an
             # agent can still add a covering nibble; idempotent re-seal
             # leaves the sealed ledger alone

nibble lint  <visual.json>    # validate a visual standalone
nibble serve <plate> [--timeout <dur>] [--addr <host:port>] [--no-ui] [--json]
             # serves the reader on 127.0.0.1 (random port; the one
             # "reader: http://…" line goes to stderr) and blocks until the
             # next review round lands — submitted in the reader or written
             # by any tool — then prints it (a follow-up with its thread's
             # history) and exits with its code. That exit is what wakes
             # the agent — but the page outlives the exit: a detached keeper
             # takes the listening socket, so replies show in the open tab
             # as they land, and the next serve takes the address back
             # (.serve.json in the plate dir records it; --addr overrides).
             # A round the agent already answered is waited past; the one
             # it was just handed is served while the replies stream in; a
             # round that landed while nothing was waiting prints at once.
             # --no-ui waits headless, prints any owed round at once, and
             # leaves no keeper; --addr pins the port (loopback only)

nibble reply <plate> --to <N> --text <md> [--ref <ref>]... [--because <reason>] [--json]
             # answers comment N of the latest round on the same plate:
             # refs verified and fingerprinted like add (no @anchor; prose
             # [phrase](@id) links resolve against the thread's nibble),
             # appended to reply.json (reply.<k>.json for round k) under
             # the plate lock; reports "N of M" and when the round is
             # answered. reply.target names the round's comments when N
             # is off; reply.duplicate refuses a second answer

nibble setup [--agent claude-code] [--json]
             # installs the embedded agent skill into the current repo at
             # .claude/skills/nibble/ and prints that path; idempotent —
             # re-running upgrades the copy to exactly what the binary ships
             # and touches nothing else under .claude/
```

## The reader

`serve` embeds the reader UI (a single static bundle built from
[`reader/`](../reader/)) and a JSON API that keeps every protocol decision
server-side — the UI receives computed trust, never hashes. The reader
renders the four v1 visual kinds (map · sequence · timeline · compare) as
interactive SVG; its visual types are generated from
`protocol/schemas/*.schema.json` by `npm run gen` in `reader/` (committed as
`src/visual/types.gen.d.ts`; CI regenerates and fails on drift, like it does
for `app.js`):

| endpoint | does |
| --- | --- |
| `GET /api/plate` | header + nibbles, each ref with trust (`exact` / `shifted ±N` / `stale`) computed against the code as it is now, and the thread — every comment with its reply, a comment's `ref` (the lines it is on) resolved the same way |
| `GET /api/code?n=2&ref=0` | the drawer: referenced lines ±3 context from the live repo (diff sides via git), at the trust-resolved position; `?round=1&comment=1&ref=0` for a reply's ref, `?comment=1.1` for the lines a comment is on. Every drawer response (and every ref) carries `at`, the lines' address in the ref grammar (`src/a.ts`, `diff:src/a.ts@abc..def#base`), so a client names a range as `<at>:<start>-<end>` |
| `POST /api/review` | writes the next round (`review.json`, then `review.2.json`…) atomically; a comment may carry `thread` to continue one, or `ref: {"ref": "<at>:<start>-<end>"}` to point at lines — verified against the code and fingerprinted on the way in (`400 ref.range.beyond-eof`, `400 review.ref` for an anchor), stored bare when the code is not on this machine; `409 review.exists` while the agent still owes replies |
| `GET /api/events` | SSE: `nibble`, `sealed`, `review`, `reply` — an open reader follows a plate still being written and a thread still being answered |

Serving degrades per ref by what is available: a full git repo serves
everything; a plain directory of files (the plate’s `repo` may be relative
to the plate dir) verifies plain and `@worktree` refs and marks
`base..head` refs `unverified`; a missing root serves titles, descriptions
and visuals with every ref `unverified` — the review loop works regardless.

Done is not an end: a round with no comments means nothing to address now,
the chat stays open, and `serve` waits for the next round like after any
answered one. So the bundled example plate works in place:

```sh
nibble serve protocol/golden/plates/cli-authored/plate   # ships with a conversation; waits for your next word
# to answer it yourself, serve a copy with the thread removed:
tmp=$(mktemp -d) && cp -R protocol/golden/plates/cli-authored/* "$tmp" && rm "$tmp"/plate/review*.json "$tmp"/plate/reply*.json
nibble serve "$tmp/plate"
```

## The skill

The Claude Code skill lives in [`skill/claude-code/`](skill/claude-code/)
— the single copy, embedded into the binary from there and installed into a
repo by `nibble setup`. The example visuals are linted by the test suite,
and the SKILL.md transcript is executed as a test, so the prose cannot
drift from the commands.

## Budgets

Small by default, with a reason as the escape hatch — the reason is stored in
the written file (`because`: the nibble for `add`, `plate.json` for `new`)
and shown to the reader:

- titles: **40 words**
- description overview: **100 words** · description standard: **250 words**
- replies: **150 words** (`because` is stored on the reply)
- nibbles per plate: **7** (`code`, `worktree`) · **12** (`<base>..<head>`)

Over budget without `--because "<reason>"` → `cli.budget`, with the limit and
the override named in the message.

## Exit codes

| code | meaning |
| --- | --- |
| 0 | success — and `serve`: the reader sent done, nothing to address now |
| 1 | validation / protocol error (code + fix-it on stderr, or `{"error":…}` with `--json`) |
| 2 | usage error — and `serve`: a round with comments the agent still owes replies to |
| 5 | `serve`: it stopped waiting (timeout or interrupt) with nothing owed |

(`serve` only emits 2 for a review after a successful wait; its usage errors
print before blocking, so scripts can tell them apart by stderr. On a
timeout while a round is still unanswered it exits 2, not 5: the review
exists and is owed.)

## Environment

- `NIBBLE_HOME` — overrides `~/.nibble` (plates land in `$NIBBLE_HOME/plates`).
