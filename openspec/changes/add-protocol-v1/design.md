# Design

## Context

First code in the repo. The PRD's decision log fixes the hard constraints:
Go holds all protocol logic, the reader is pure presentation, plates are plain
JSON in `~/.nibble`, development is TDD with golden fixtures as the
conformance suite. See `proposal.md` for motivation and the three spec deltas
for behavior.

## Goals / Non-Goals

**Goals:**
- A Go package later changes (CLI commands, server) import unchanged.
- The golden fixtures are the spec made executable: every requirement scenario
  maps to at least one fixture or test vector.
- Schemas strict from day one (unknown fields rejected) so leniency never has
  to be clawed back.

**Non-Goals:**
- No CLI entrypoint, no server, no reader. Nothing here executes against a
  live repo except through the test suite.
- No schema→TS generation yet (reader change owns it; schemas are written to
  make it possible).

## Decisions

1. **Module layout: one Go module at `cli/`, package `cli/internal/protocol`.**
   The PRD fixes the binary as the home of all protocol logic, so the library
   lives inside the future binary's module from the start. Alternative — a
   separate `protocol/` Go module — rejected: two modules invite version skew
   between library and binary for zero benefit in a monorepo.

2. **`protocol/` holds artifacts, not code:** `PROTOCOL.md`, `schemas/*.json`,
   `golden/`. Go embeds the schemas (`go:embed`) so the binary stays single-file.
   The golden tree is language-neutral on purpose — a future TS test runner
   consumes the same fixtures.

3. **Validation: JSON Schema (draft 2020-12) for shape, Go code for semantics.**
   Schemas catch structure (fields, types, enums, unknown-field rejection);
   Go implements the cross-cutting rules schemas can't express (nibble
   numbering gaps, dangling edges/anchors, side mismatches, budgets).
   Error codes (`ref.range.beyond-eof`, …) are the stable API; messages are not.
   Alternative — all validation hand-rolled in Go — rejected: schemas are also
   the contract the reader's TS types are generated from.

4. **Fingerprint `fp1`: SHA-256 over normalized referenced lines, plus stored
   context.** Normalization: CRLF→LF, strip trailing whitespace per line.
   Stored as `fp1:<hex>` with the context line hashes alongside, enabling the
   shifted-search without storing source text (plates may be shared; code
   should not leak into them beyond what the agent quoted). Shifted detection
   slides the window over the current file comparing line-hash sequences —
   O(file) per ref, fine at plate scale (≤ ~20 refs).

5. **Trust is a pure function** `(storedRef, currentFile) → {level, offset}`
   with no filesystem access in the core; an outer helper does IO. Keeps the
   conformance vectors trivial (inputs and outputs are values) and the future
   server reuse direct.

6. **Golden layout mirrors the capabilities:**
   `golden/plates/<name>/{plate dir}` + `expected.json` (parse/validate
   outcome, error codes); `golden/refs/*.json` (ref grammar vectors);
   `golden/trust/*.json` (before/after file content + expected level/offset);
   `golden/visuals/<kind>/{valid,invalid}/*.json`. `expected.json` asserts
   error *codes*, never message text.

## Risks / Trade-offs

- [Strict schemas break early agents] → error codes + fix-it messages are part
  of the contract; the skill will quote them verbatim.
- [Fingerprint too brittle (whitespace-only edits → stale)] → normalization
  handles the common cases; threshold tuning is isolated behind `fp1`
  versioning, and `fp2` can ship without breaking stored plates.
- [Budgets at protocol level vs CLI level blur] → protocol validates only
  structural budgets it owns (12 nodes); word-count budgets stay with the CLI
  change, as the spec deltas state.
- [JSON Schema draft support in Go] → use a maintained validator
  (santhosh-tekuri/jsonschema); it's the only dependency this change adds.

## Open Questions

- Context width (2 lines) and shifted-search uniqueness rule may need tuning
  after dogfooding; both are internal to `fp1` and safe to revisit.
