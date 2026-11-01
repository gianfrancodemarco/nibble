# Design

## Context

`internal/protocol` already owns parsing, validation, fingerprints and trust;
this change wraps it in a binary and adds the pieces only the CLI can own:
filesystem layout, git access, budgets, exit codes. See proposal.md for scope
and the two spec deltas for behavior.

## Goals / Non-Goals

**Goals:**
- Commands as pure functions (`run(args, stdout, stderr) int`) so the test
  suite drives them in-process; `main` is a two-liner.
- Every rejection an agent can act on: protocol/CLI error code + fix-it text,
  identical information in `--json`.
- The serve contract final from day one — the reader change must not alter it.

**Non-Goals:**
- No HTTP, no SSE, no browser (reader change). No gh/network. No config file.

## Decisions

1. **Stdlib `flag` with a subcommand dispatcher, no cobra.** Five commands,
   ~15 flags total; a dependency buys nothing but weight in a binary whose
   pitch is "single static file". Revisit only if completion/help outgrows it.

2. **`internal/cmd` package, one file per command**, each exporting
   `func Run<Name>(ctx Ctx, args []string) int` where `Ctx` carries stdout,
   stderr, env and the plates home. Tests construct `Ctx` with buffers and a
   temp `NIBBLE_HOME` — no exec, no PATH games.

3. **Git via `exec.Command("git", …)`, behind a tiny `gitRepo` interface.**
   Needed: `rev-parse --show-toplevel`, `rev-parse HEAD`, `show <rev>:<path>`.
   An interface so unit tests fake it; integration tests use real temp repos
   (git is already a dev dependency of everything).

4. **Plate ids: `p-<yyyymmdd>-<hhmmss>-<4 hex rand>`**, directories created
   `0700` (plates can quote code). `$NIBBLE_HOME` overrides `~/.nibble` —
   the test hook and the future packaging hook in one.

5. **Atomic nibble writes**: marshal → `n<N>.json.tmp` → `rename`. The reader
   (later) watches the directory; it must never observe a half-written file.
   The next `N` is derived by scanning, serialized by an `flock` on the plate
   dir to keep concurrent `add`s from racing.

6. **Budget constants live in `internal/cmd`,** not the protocol: caption 40
   words (counted on whitespace after stripping markdown syntax), nibbles 7
   (`code`/`worktree`) or 12 (`range`). The protocol only transports
   `because`. New CLI-owned error codes `cli.budget`, `cli.repo.missing`,
   `cli.plate.empty` join the protocol index in PROTOCOL.md (the index test
   already enforces documentation).

7. **`serve` watches with a 250ms poll**, not fsnotify: one dependency saved,
   2-second detection budget met with margin, identical behavior on all
   platforms. Exit codes 0/2/3/4/5 map approve/changes/question/closed/timeout;
   1 stays errors — chosen so plain `if nibble serve …` fails shell-style on
   anything but approval.

## Risks / Trade-offs

- [Word-count budget is crude] → it's a backstop, not typography; the skill
  teaches brevity, the CLI only catches runaways. Counting rule documented.
- [Polling serve wastes a few wakeups] → 250ms × idle hours is negligible;
  fsnotify can replace it inside the same contract if ever needed.
- [flock semantics differ on exotic filesystems] → plates live under the
  user's home, not NFS, and the failure mode is a clear error, not corruption.

## Open Questions

- None blocking. Budget numbers may be retuned after dogfooding; they are
  constants with tests, not architecture.
