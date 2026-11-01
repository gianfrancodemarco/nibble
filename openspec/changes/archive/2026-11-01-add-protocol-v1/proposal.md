# Proposal

## Why

Every other nibble component — CLI commands, reader, skill, pill — is written
against the protocol, so it must exist first, as the PRD's component section
says: "the contract everything else is written against." Defining it now as
spec + schemas + a tested Go package + golden fixtures lets later changes build
on validated ground instead of ad-hoc JSON.

## What Changes

- Add `protocol/PROTOCOL.md`: the versioned (v1) specification of the plate
  folder format, lifecycle, ref grammar, fingerprint & trust rules.
- Add JSON Schemas under `protocol/schemas/` for `plate.json`, nibble files
  (`n*.json`), `review.json`, and the four P0 visual kinds (`map`, `sequence`,
  `timeline`, `compare`), including semantic layout hints (group, tier, focus)
  and what-if toggles as precomputed states.
- Add golden conformance fixtures under `protocol/golden/`: worked examples of
  valid plates (one per entry mode: explain, worktree, PR) and invalid cases
  with expected error codes, plus fingerprint/trust test vectors.
- Add the Go protocol package (new `cli/` module, `internal/protocol`):
  parsing, schema validation, ref parsing (plain and `diff:` refs), the
  fingerprint algorithm, and trust computation (`exact`/`shifted`/`stale`) —
  developed test-first, with the golden fixtures as the conformance suite.
- Update the site: roadmap marks "Protocol v1" in progress/done; PRD's
  on-disk section links to `PROTOCOL.md`.

**Out of scope:** CLI commands (`new`/`add`/`done`/`serve`) and the local
server; budget *enforcement* (the protocol only reserves the `because` field);
the reader; `state`/`data`/`chart` schemas (v0.2); TS type generation from the
schemas (lands with the reader).

## Capabilities

### New Capabilities

- `protocol/plate-format`: the plate folder on disk — layout, required files,
  field semantics, lifecycle (`writing → done → reviewed`), versioning rules.
- `protocol/refs-and-trust`: ref grammar (`path:start-end`, `diff:` refs,
  `@anchor`), the line fingerprint algorithm, and trust computation
  (`exact` / `shifted` / `stale`).
- `protocol/visual-schemas`: the declarative visual format — the four P0 kinds,
  semantic hints, controls, and precomputed what-if states.

### Modified Capabilities

(none — first change in the project)

## Impact

- New top-level dirs: `protocol/` (spec, schemas, golden) and `cli/` (Go module
  `github.com/gianfrancodemarco/nibble/cli`, package `internal/protocol`).
- New CI need: `go test ./...` (workflow can land with this change or the next).
- Site: `docs/roadmap.html` status, PRD on-disk section link.
- No existing code affected (first code in the repo).
