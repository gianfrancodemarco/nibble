# Tasks

## 1. Scaffolding

- [ ] 1.1 Create Go module `cli/` (`github.com/gianfrancodemarco/nibble/cli`, Go ≥1.22) with `internal/protocol` package stub; verify `go test ./...` runs (no tests yet) and `go vet ./...` passes
- [ ] 1.2 Create `protocol/` tree (`PROTOCOL.md` skeleton, `schemas/`, `golden/{plates,refs,trust,visuals}/`) and a `cli/internal/protocol/golden_test.go` harness that walks `protocol/golden/` and fails on any fixture without a matching runner; verify it fails red on an empty placeholder fixture

## 2. Ref grammar (refs-and-trust: parsing)

- [ ] 2.1 RED: table-driven `TestParseRef` from spec scenarios (plain ref with range/anchor/note, worktree diff ref, base..head#side diff ref, `ref.syntax`, `ref.range`, `ref.path` rejections) + vectors in `golden/refs/grammar.json`; verify tests fail
- [ ] 2.2 GREEN: implement `ParseRef` until `TestParseRef` and the golden vectors pass; verify `go test ./...` green
- [ ] 2.3 RED→GREEN: write-time validation against an in-memory file (`ref.file.missing`, `ref.range.beyond-eof` reporting actual line count, `ref.diff.side-missing`); verify new tests pass and error codes match spec

## 3. Fingerprint & trust (refs-and-trust: trust)

- [ ] 3.1 RED: `TestFingerprint` — determinism across LF/CRLF and trailing whitespace, `fp1:` prefix, context capture at file edges; vectors in `golden/trust/fingerprint.json`; verify tests fail
- [ ] 3.2 GREEN: implement `Fingerprint` (SHA-256 over normalized lines + context line hashes); verify tests pass
- [ ] 3.3 RED: `TestTrust` vectors in `golden/trust/*.json` — exact, shifted ±N (insertions above/below), stale (rewritten), stale (ambiguous double match), stale (file gone); verify tests fail
- [ ] 3.4 GREEN: implement pure `Trust(storedRef, currentFile)`; verify all trust vectors pass

## 4. Visual schemas (visual-schemas)

- [ ] 4.1 Author JSON Schemas (draft 2020-12, `additionalProperties: false`) for the envelope and `map`, `sequence`, `timeline`, `compare`; embed via `go:embed`; verify schemas compile under santhosh-tekuri/jsonschema
- [ ] 4.2 RED: fixtures `golden/visuals/<kind>/{valid,invalid}/*.json` — at least: the PRD stampede timeline with `jitter off/on` states (worked example), a 3-node map with hints, pixel-smuggling and 13-node invalid maps, dangling sequence step, `compare.sides.mismatch`; verify harness fails
- [ ] 4.3 GREEN: implement `ValidateVisual` (schema pass + semantic pass: duplicate ids, dangling edges, budgets, state uniqueness, side mismatch) with spec error codes; verify all visual fixtures pass

## 5. Plate format (plate-format)

- [ ] 5.1 RED: fixtures `golden/plates/` — worked examples: `explain-stampede/` (full 4-nibble plate from the PRD example), `worktree-review/`, `pr-chapter/`; invalid: missing version, version 2, nibble gap, nibble without visual, sealed-then-added, unknown review verdict, dangling `@anchor`; each with `expected.json` (error codes only); verify harness fails
- [ ] 5.2 GREEN: implement `ParsePlate`/`ValidatePlate` (header, nibble ordering, lifecycle, review, cross-checks incl. `ref.anchor.dangling`, unknown-file tolerance, unknown-field preservation); verify every plate fixture passes and full suite is green
- [ ] 5.3 Write `protocol/PROTOCOL.md` v1: folder layout, field tables, ref grammar, fp1 + trust rules, error-code index — each section pointing at its golden fixtures; verify every error code in code appears in the index (grep check in a test)

## 6. CI & site

- [ ] 6.1 Add `.github/workflows/test.yml` running `go vet` + `go test ./...` on push/PR; verify the workflow passes on GitHub
- [ ] 6.2 Update the site: roadmap marks Protocol v1 done (stage stays "next" for remaining v0.1 items), PRD "On disk & CLI" section links to `protocol/PROTOCOL.md` on GitHub; verify pages render and push deploys cleanly
