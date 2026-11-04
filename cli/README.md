# nibble CLI

The agent-facing half of nibble: six commands over the
[protocol](../protocol/PROTOCOL.md). Agents drive these; humans mostly don't.

```sh
go install github.com/gianfrancodemarco/nibble/cli/cmd/nibble@main
```

## Commands

```sh
nibble new   --title <t> [--about code|worktree|<base>..<head>] [--json]
             # creates a plate under $NIBBLE_HOME/plates (default ~/.nibble/plates),
             # prints its path — the only stdout line

nibble add   <plate> --caption <md> --visual <file.json> [--ref <ref>]...
             [--because <reason>] [--json]
             # validates the visual and every ref against the real repo
             # (diff-ref sides resolved through git), fingerprints refs,
             # writes n<N>.json atomically; rejections are fix-its with
             # protocol error codes and nothing gets written

nibble done  <plate>          # seals: writes {"total": N}; idempotent
nibble lint  <visual.json>    # validate a visual standalone
nibble serve <plate> [--timeout <dur>] [--addr <host:port>] [--no-ui] [--json]
             # serves the reader on 127.0.0.1 (random port; the one
             # "reader: http://…" line goes to stderr) and blocks until
             # review.json appears — submitted in the reader or written by
             # any tool — then prints the review and exits with the
             # verdict's code. That exit is what wakes the agent.
             # --no-ui waits headless; --addr pins the port (loopback only)

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
| `GET /api/plate` | header + nibbles, each ref with trust (`exact` / `shifted ±N` / `stale`) computed against the code as it is now |
| `GET /api/code?n=2&ref=0` | the drawer: referenced lines ±3 context from the live repo (diff sides via git), at the trust-resolved position |
| `POST /api/review` | writes `review.json` atomically; `409 review.exists` if the plate already has one |
| `GET /api/events` | SSE: `nibble`, `sealed`, `review` — an open reader follows a plate still being written |

Serving degrades per ref by what is available: a full git repo serves
everything; a plain directory of files (the plate’s `repo` may be relative
to the plate dir) verifies plain and `@worktree` refs and marks
`base..head` refs `unverified`; a missing root serves captions and visuals
with every ref `unverified` — the review loop works regardless.

A plate that already has a review serves read-only (review shown, input
locked) until interrupted or `--timeout`, exiting with the verdict's code;
`--no-ui` keeps the print-and-exit path for scripts. So the bundled example
plate works in place:

```sh
nibble serve protocol/golden/plates/cli-authored/plate   # read-only: it ships reviewed
# to answer it yourself, serve an unreviewed copy:
tmp=$(mktemp -d) && cp -R protocol/golden/plates/cli-authored/* "$tmp" && rm "$tmp/plate/review.json"
nibble serve "$tmp/plate"
```

## The skill

The Claude Code skill lives in [`skill/claude-code/`](../skill/claude-code/)
— that is the file to edit. `go:embed` cannot reach above the module, so a
copy is committed at `internal/cmd/skillfs/claude-code/`: after editing,
sync it (`cp -R ../skill/claude-code/ internal/cmd/skillfs/claude-code/`).
CI diffs the two and fails on drift, the example visuals are linted by the
test suite, and the SKILL.md transcript is executed as a test.

## Budgets

Small by default, with a reason as the escape hatch — the reason is stored in
the nibble (`because`) and shown to the reader:

- captions: **40 words**
- nibbles per plate: **7** (`code`, `worktree`) · **12** (`<base>..<head>`)

Over budget without `--because "<reason>"` → `cli.budget`, with the limit and
the override named in the message.

## Exit codes

| code | meaning |
| --- | --- |
| 0 | success — and `serve`: verdict `approve` |
| 1 | validation / protocol error (code + fix-it on stderr, or `{"error":…}` with `--json`) |
| 2 | usage error — and `serve`: verdict `changes` |
| 3 | `serve`: verdict `question` |
| 4 | `serve`: verdict `closed` |
| 5 | `serve`: timeout |

(`serve` only emits 2 for a verdict after a successful wait; its usage errors
print before blocking, so scripts can tell them apart by stderr.)

## Environment

- `NIBBLE_HOME` — overrides `~/.nibble` (plates land in `$NIBBLE_HOME/plates`).
