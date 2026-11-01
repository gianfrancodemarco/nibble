# Tasks

## 1. Scaffolding

- [x] 1.1 Create `cli/cmd/nibble/main.go` (dispatcher only) and `cli/internal/cmd` with `Ctx` (stdout/stderr/env/home) and usage/exit-code plumbing; verify `go build ./...` produces a `nibble` binary and `nibble frobnicate` exits 2 with usage on stderr (table test on the dispatcher)
- [x] 1.2 RED→GREEN: `gitRepo` interface + real implementation (`rev-parse --show-toplevel`, `rev-parse HEAD`, `show <rev>:<path>`) with integration tests against a temp git repo; verify side resolution for worktree and range

## 2. new (plate-authoring)

- [x] 2.1 RED: `TestRunNew` — creates valid open plate under temp `NIBBLE_HOME`, prints path only, `--about` forms (`code` default, `worktree`, `main..feat`), `cli.repo.missing` outside a repo, `--json` shape; verify tests fail
- [x] 2.2 GREEN: implement `new` (plate id scheme, 0700 dirs, header via protocol types); verify tests pass and a created plate round-trips `protocol.ParsePlate`

## 3. add (plate-authoring)

- [x] 3.1 RED: `TestRunAdd` — happy path appends contiguous fingerprinted nibble; rejection table: `ref.range.beyond-eof` (names count), `ref.file.missing`, `visual.field.unknown`, `plate.sealed`, dangling `@anchor`; nothing written on rejection; atomic write (no `.tmp` left); worktree + range diff refs resolved via the temp git repo; verify tests fail
- [x] 3.2 GREEN: implement `add` (ref check → fingerprint → visual validation → budgets → atomic write under flock); verify tests pass
- [x] 3.3 RED→GREEN: budgets — 41-word caption rejected with `cli.budget` naming the limit and `--because`; with `--because` the nibble lands with the reason stored; 8th nibble on a `code` plate rejected, allowed on a `range` plate up to 12; verify tests pass

## 4. done + lint (plate-authoring)

- [x] 4.1 RED→GREEN: `done` writes `{"total": N}`, refuses empty plates (`cli.plate.empty`), idempotent re-seal; `lint` validates a visual file standalone (valid map exits 0, pixel-smuggling exits 1 with `visual.field.unknown`); verify tests pass

## 5. serve (review-wait)

- [x] 5.1 RED: `TestRunServe` — pre-existing review prints and exits immediately; review written after start detected < 2s; verdict → exit code table (0/2/3/4); `--timeout 100ms` exits 5 leaving the plate untouched; markdown output names verdict and comment targets; `--json` prints the review object; invalid plate exits 1 before blocking; verify tests fail
- [x] 5.2 GREEN: implement `serve` (250ms poll, timeout, renderers); verify tests pass and the full suite is green

## 6. Worked example, docs & site

- [x] 6.1 End-to-end script test (worked example): in a temp git repo, drive `new → add ×3 (one per visual kind, one over budget with --because) → done → serve` with a review written mid-wait; assert the final plate matches a new golden fixture `protocol/golden/plates/cli-authored/`; verify suite green
- [x] 6.2 Document the CLI in `protocol/PROTOCOL.md` (new CLI error codes in the index — the index test enforces this) and `cli/README.md` (commands, budgets, exit codes); verify index test passes
- [x] 6.3 Update the site: roadmap splits the Go CLI item (authoring + headless serve ✓; HTTP server moves to the reader item), guide "For agents" page gains budgets/exit-code details and drops the "ships with v0.1" chip from what now exists; verify pages render and deploy cleanly
