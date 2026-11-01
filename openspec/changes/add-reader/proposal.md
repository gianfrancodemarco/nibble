# Add the reader: HTTP server + UI shell

## Why

The loop is half-built: agents can author and seal plates and `nibble serve`
blocks on `review.json` — but the human has nothing to open. Today the review
file must be written by hand. The reader is the product's face: the roadmap
item is "local HTTP server + one canvas, camera moves, code drawer, comments,
live SSE".

## What Changes

- `nibble serve` grows an HTTP side: while it blocks, it serves the reader on
  `127.0.0.1` (random port by default, `--addr` to pin, `--no-ui` to stay
  headless) and prints the URL to stderr. The wait contract is unchanged —
  a review submitted from the reader ends `serve` with the verdict's exit
  code exactly like an externally written `review.json`.
- A JSON API, served by Go, that keeps ALL protocol logic server-side per the
  decision log: `GET /api/plate` (header + nibbles + **computed trust** per
  ref), `GET /api/code` (the drawer: referenced lines + context from the live
  repo, diff sides resolved through git), `POST /api/review` (atomic
  `review.json` write; one review per plate), `GET /api/events` (SSE: nibble
  added, plate sealed, review landed).
- A TypeScript UI shell, pure presentation, compiled to a single static JS
  file and embedded in the Go binary (`go:embed`): one canvas of nibble
  cards, camera that steps between nibbles, code drawer with trust badges,
  per-nibble comments, verdict buttons, SSE live updates.
- One new protocol error code: `review.exists` (a plate takes one review).

## Out of Scope

- **Per-kind visual rendering and interactions** (map layout, sequence
  stepping, timeline scrubbing, compare flip) — that is the next roadmap
  item ("Visual kinds"). The shell renders each visual as a typed summary
  card with its anchors; the canvas, camera and drawer it ships are the
  chassis those kinds plug into.
- Detail dial, blast radius, not-shown ledger (separate roadmap items).
- Generating TS types from the JSON Schemas — deferred to the visual-kinds
  change, where the reader first consumes visual internals; the shell's
  hand-written API types cover plate/nibble/review only.
- The Tauri pill, auth, remote access (the server binds loopback only).
- Review edits after submit; comment threads.

## Impact

- Affected specs: new `reader/http-api`, new `reader/ui-shell`; modified
  `cli/review-wait` (serve gains the HTTP side).
- Affected code: `cli/internal/cmd` (serve wiring, new `http.go`), new
  `reader/` TS workspace, embedded `cli/internal/cmd/ui/`, protocol error
  index, CI (build-drift job), site docs.
