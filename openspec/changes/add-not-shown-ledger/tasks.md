# Tasks

## 1. Protocol: `ledger.json` joins the plate (Go, TDD)

- [x] 1.1 Red: tests in `cli/internal/protocol/plate_test.go` for ledger
  parsing — valid ledger with hunks exposed on `Plate`; empty-hunks ledger
  valid; malformed shapes → `plate.ledger` (bad side, `end < start`,
  absolute path, `shown > total`, both counts zero without `"binary": true`);
  ledger on an `about: code` plate → `plate.ledger`; diff plate without a
  ledger stays valid. Verify: `go test ./internal/protocol/` fails on the
  new cases only.
- [x] 1.2 Green: `Ledger`/`LedgerHunk` types and validation in
  `cli/internal/protocol` (new ledger.go), parsed from `ledger.json` in
  `ParsePlate`; `CodePlateLedger` in errors.go with fix-it messages naming
  the offending hunk. Verify: 1.1 tests pass, `go test ./...` green.
- [x] 1.3 Worked-example golden plates under `protocol/golden/plates/`: a
  sealed worktree-review plate with a ledger holding uncovered hunks, one
  with a fully covered (empty-hunks) ledger, and invalid fixtures
  (`ledger-on-code-plate`, `ledger-bad-hunk`) with `expected.json` codes.
  Verify: `go test ./internal/protocol/ -run Golden` passes and fails if an
  expected code is edited.
- [x] 1.4 Document the ledger in `protocol/PROTOCOL.md`: the file in the
  plate-folder listing, its shape (counts stored, sides, binary hunks), when
  it may be present, who writes it (`nibble done`, the CLI, never the
  agent), and `plate.ledger` in the error-code index. Verify: section
  present and consistent with the fixtures.

## 2. Protocol: diff parsing and coverage (Go, TDD, pure)

- [x] 2.1 Red: fixture-driven tests for `ParseUnifiedDiff` — real
  `git diff -U0` outputs captured as test fixtures covering: add/modify
  hunks (head side), pure deletions (base side, with the head-side seam
  position), new file, deleted file, rename with edits, binary change,
  CRLF content, multi-hunk files. Verify: tests fail (no parser yet).
- [x] 2.2 Green: implement `ParseUnifiedDiff` in ledger.go — `@@ -a,b +c,d @@`
  plus `---`/`+++`/`Binary files` headers, no dependencies. Verify: 2.1
  passes.
- [x] 2.3 Red: tests for `Coverage(hunks, refs)` — overlapping plain /
  `@worktree` / `#head` refs cover head-side hunks; non-overlapping or
  wrong-path refs don't; `#base` refs cover base-side hunks; a head-shaped
  ref overlapping the deletion seam `[max(1,c), c+1]` covers a pure
  deletion; binary hunks covered by any same-path same-side-shape ref;
  refs from every nibble count; resulting `Ledger` carries correct
  `shown`/`total`. Verify: tests fail.
- [x] 2.4 Green: implement coverage matching, returning a `Ledger` ready to
  serialize. Verify: 2.3 passes, `go test ./...` green.

## 3. CLI: `done` becomes the coverage check (Go, TDD)

- [x] 3.1 Red: tests in `cli/internal/cmd/done_test.go` using real temp git
  repos (existing pattern) — sealing an `about: worktree` plate with a
  partly covered diff writes `ledger.json` (uncovered hunks only) and
  reports the not-shown count, `--json` carries the full ledger; untracked
  files appear as fully added hunks; sealing an `about: code` plate writes
  no ledger and prints no coverage; sealing an `about: <base>..<head>` plate
  diffs the two revs; re-seal stays idempotent and leaves the ledger alone;
  an unresolvable range side exits 1 writing nothing. Verify: tests fail.
- [x] 3.2 Green: grow the `gitRepo` seam with `DiffWorktree()`,
  `DiffRange(base, head)` and `Untracked()` (shelling out in `realGit`);
  wire `RunDone` — compute diff per `about`, run coverage over all nibbles'
  refs, write `ledger.json` atomically, then the `done` marker. Verify: 3.1
  passes.
- [x] 3.3 Red: tests for `done --check` — prints the would-be ledger, writes
  neither `ledger.json` nor `done`, exits 0, plate still accepts `add`;
  on `about: code` says there is nothing to check; on a sealed plate reports
  the sealed ledger. Verify: tests fail.
- [x] 3.4 Green: implement `--check` sharing the seal path's computation.
  Verify: 3.3 passes, full `go test ./...` green.
- [x] 3.5 Extend the e2e test with the check-then-cover-then-seal loop: build
  a worktree plate, `done --check` reports an uncovered hunk, `add` a nibble
  reffing it, `done` seals with that hunk gone from `ledger.json`. Verify:
  e2e green.
- [x] 3.6 Document in `cli/README.md`: `done` as the coverage check,
  `--check`, the ledger in `done`'s output and `--json`. Verify: README
  matches the implemented flags and output.

## 4. Server API: the ledger served (Go, TDD)

- [x] 4.1 Red: tests in `cli/internal/cmd/http_test.go` — `/api/plate` on a
  sealed ledgered plate carries `ledger` (counts + hunks) and omits it on a
  plate without one; `GET /api/ledger?hunk=0` returns the hunk's lines in
  the `/api/code` shape (context, in-range marks) for head-side hunks from
  the worktree and base-side hunks via git; a plain directory root answers
  base-side hunks with a `why` reason instead of lines; unknown index and
  no-ledger plate → 404. Verify: tests fail.
- [x] 4.2 Green: ledger in `servePlate`'s response, new `serveLedger` handler
  on the mux reusing the side-resolution and drawer-shape helpers. Verify:
  4.1 passes, `go test ./...` green.

## 5. Reader: the ledger card (TS, TDD)

- [x] 5.1 Red: unit tests in `reader/test/ledger.test.ts` for the pure seam —
  grouping hunks by file preserving order; the hunk label
  (`side · start-end · +a −r`, binary labelled); comment targets: ledger
  card active with no selection → `ledger`, hunk selected →
  `ledger:<path>:<start>[-<end>]` (single-line hunks drop the `-<end>`);
  nibble targets unchanged; card count = nibbles + 1 only when a ledger is
  present; full-coverage state detected from `shown === total`. Verify:
  `npm test` fails on the new cases only.
- [x] 5.2 Green: render the ledger card at the end of the strip in
  `reader/src/app.ts` (+ a ledger module beside the visual kinds): file
  groups, hunk rows with code chips opening the drawer on
  `/api/ledger?hunk=<I>`, the shown/total line, the explicit "every hunk of
  the diff was shown" empty state; row selection feeds the extended
  `commentTarget`; camera/arrows/clicks treat it as the last card; the card
  appears without reload when the `sealed` SSE event triggers the refetch.
  Verify: 5.1 passes, existing reader tests green, `npm run build` clean.
- [x] 5.3 Rebuild and commit the embedded bundle (`npm run build`, sync
  `cli/internal/cmd/ui/app.js`) and eyeball a served ledgered plate in light
  and dark: card legible, drawer opens on a hunk, comment pins with the
  `ledger:` target, verdict flow untouched. Verify: CI drift check passes;
  screenshot acceptable.

## 6. Skill: teach check-then-seal

- [x] 6.1 Update `cli/skill/claude-code/SKILL.md`: the worked review runs
  `nibble done --check` before `done`, reads the reported hunks, covers what
  matters or seals with the ledger disclosing the rest; a short section on
  the ledger (the CLI computes it; never pad a plate to empty it; the review
  may carry `ledger:` comment targets — map them back to hunks like `n2:s4`).
  Update the transcript-executing skill test to the new flow. Verify:
  `go test ./internal/cmd/ -run Skill` green.

## 7. Docs site

- [x] 7.1 Update `docs/` pages: roadmap.html (Not-shown ledger → done; the
  v0.1 stage reads complete, v0.2 becomes the active stage), PRD.html
  shipped note in §"On disk" (ledger shipped; name the next item from v0.2)
  and R17 row stays consistent, guide/answering.html and guide/agents.html
  wording checked against the shipped behavior (`done --check`, `ledger:`
  targets), index.html principle 7 already matches. Verify: pages render
  locally with the theme toggle intact and no stale "next item" text.

## 8. Revision: one ledger entry per file

- [x] 8.1 Reader: the ledger card lists one row per file and side (hunks'
  line ranges + summed counts in the label); selection ids and comment
  targets become `ledger:<path>` / `ledger:<path>#base`. Update
  `reader/test/ledger.test.ts` first; `npm test` green.
- [x] 8.2 API: `GET /api/ledger?file=<path>&side=<head|base>` serves all of
  that file-and-side's hunks as merged ±3-context segments with in-range
  marks, replacing `?hunk=<I>`; 404 on no match. Update `http_test.go`
  first; `go test ./...` green.
- [x] 8.3 Reader drawer: file rows fetch by path+side, gaps between
  non-adjacent segments render an elision mark; rebuild `app.js`
  drift-clean. Docs: PROTOCOL.md target grammar, SKILL.md review example.

## 9. Revision: whole-diff ledger with seen badges and a file tree

- [x] 9.1 Protocol: `ledger.json` stores every hunk of the diff with a
  `covered` flag; `shown`/`total` must match the covered/hunk counts.
  Update `ledger_test.go`, `plate_test.go` and the golden fixtures first;
  `go test ./internal/protocol/` green.
- [x] 9.2 CLI/API: `done --check` prints only uncovered hunks; `/api/ledger`
  serves segments around all of a file-and-side's hunks, in-range marks on
  uncovered lines only. Update `done_test.go`, `e2e_test.go`,
  `http_test.go` first; `go test ./...` green.
- [x] 9.3 Reader: the ledger card renders every changed file as a collapsed
  directory tree, seen files badged (`shown` / partly shown), uncovered
  ranges in the row label; drawer note adapts when nothing is highlighted.
  Update `ledger.test.ts` first; `npm test` green, `app.js` rebuilt. Docs:
  PROTOCOL.md ledger section, guide/PRD wording.

## Workflow follow-up

- Archive the change (`opsx:archive`) once implementation and review are
  done, syncing the delta specs into `openspec/specs/`.
