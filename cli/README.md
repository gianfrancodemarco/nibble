# nibble CLI

The agent-facing half of nibble: five commands over the
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
nibble serve <plate> [--timeout <dur>] [--json]
             # blocks until review.json appears, prints the review,
             # exits with the verdict's code — this is what wakes the agent
```

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
