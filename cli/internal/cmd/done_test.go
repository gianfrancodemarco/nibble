package cmd

import (
	"encoding/json"

	"github.com/gianfrancodemarco/nibble/cli/internal/protocol"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRunDone(t *testing.T) {
	repo := gitInit(t)
	visual := writeFile(t, t.TempDir(), "map.json", testMap)

	t.Run("seals with the count, idempotently", func(t *testing.T) {
		ctx, plate := newTestPlate(t, repo)
		for i := 0; i < 3; i++ {
			if code, _, errb := run(t, ctx, "add", plate, "--title", "c", "--visual", visual); code != 0 {
				t.Fatal(errb)
			}
		}
		for i := 0; i < 2; i++ { // twice: re-seal must be a no-op success
			if code, _, errb := run(t, ctx, "done", plate); code != 0 {
				t.Fatalf("done run %d: exit %d, %s", i, code, errb)
			}
		}
		raw, err := os.ReadFile(filepath.Join(plate, "done"))
		if err != nil {
			t.Fatal(err)
		}
		var d struct {
			Total int `json:"total"`
		}
		if json.Unmarshal(raw, &d) != nil || d.Total != 3 {
			t.Fatalf("done = %s", raw)
		}
	})

	t.Run("refuses an empty plate", func(t *testing.T) {
		ctx, plate := newTestPlate(t, repo)
		code, _, errb := run(t, ctx, "done", plate)
		if code != 1 || !strings.Contains(errb, "cli.plate.empty") {
			t.Fatalf("exit %d stderr %q", code, errb)
		}
	})
}

func TestRunLint(t *testing.T) {
	ctx := Ctx{Dir: t.TempDir(), Home: t.TempDir()}

	good := writeFile(t, t.TempDir(), "good.json", testMap)
	if code, _, errb := run(t, ctx, "lint", good); code != 0 {
		t.Fatalf("valid visual: exit %d, %s", code, errb)
	}

	bad := writeFile(t, t.TempDir(), "bad.json", `{"kind":"map","title":"m","nodes":[{"id":"a","label":"A","x":1}]}`)
	code, _, errb := run(t, ctx, "lint", bad)
	if code != 1 || !strings.Contains(errb, "visual.field.unknown") {
		t.Fatalf("exit %d stderr %q", code, errb)
	}
}

// readLedger parses a plate's ledger.json.
func readLedger(t *testing.T, plate string) *protocol.Ledger {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(plate, "ledger.json"))
	if err != nil {
		t.Fatal(err)
	}
	var l protocol.Ledger
	if err := json.Unmarshal(raw, &l); err != nil {
		t.Fatalf("ledger.json: %v\n%s", err, raw)
	}
	return &l
}

// TestDoneWritesLedger: sealing a diff plate computes coverage and writes
// the not-shown ledger.
func TestDoneWritesLedger(t *testing.T) {
	t.Run("worktree plate: covered and uncovered hunks, untracked file", func(t *testing.T) {
		repo := gitInit(t) // main, with an uncommitted edit on src/pool.ts line 1
		writeFile(t, repo, "notes.txt", "n1\nn2\nn3\n")
		ctx, plate := newTestPlate(t, repo, "--about", "worktree")
		visual := writeFile(t, t.TempDir(), "map.json", testMap)
		code, _, errb := run(t, ctx, "add", plate, "--title", "c", "--visual", visual,
			"--ref", "src/pool.ts:1 @cache the pool bump")
		if code != 0 {
			t.Fatal(errb)
		}
		code, out, errb := run(t, ctx, "done", plate)
		if code != 0 {
			t.Fatalf("done: exit %d, %s", code, errb)
		}
		if !strings.Contains(out+errb, "not shown") {
			t.Fatalf("done should report the not-shown count, got %q / %q", out, errb)
		}
		l := readLedger(t, plate)
		if l.Shown != 1 || l.Total != 2 || len(l.Hunks) != 1 {
			t.Fatalf("ledger = %+v", l)
		}
		h := l.Hunks[0]
		if h.Path != "notes.txt" || h.Side != "head" || h.Start != 1 || h.End != 3 || h.Added != 3 {
			t.Fatalf("untracked hunk = %+v", h)
		}
	})

	t.Run("code plate: no ledger, no coverage talk", func(t *testing.T) {
		repo := gitInit(t)
		ctx, plate := newTestPlate(t, repo)
		visual := writeFile(t, t.TempDir(), "map.json", testMap)
		if code, _, errb := run(t, ctx, "add", plate, "--title", "c", "--visual", visual); code != 0 {
			t.Fatal(errb)
		}
		code, out, errb := run(t, ctx, "done", plate)
		if code != 0 {
			t.Fatal(errb)
		}
		if _, err := os.Stat(filepath.Join(plate, "ledger.json")); !os.IsNotExist(err) {
			t.Fatalf("code plate grew a ledger.json")
		}
		if strings.Contains(out, "ledger") || strings.Contains(out, "not shown") {
			t.Fatalf("code plate output mentions coverage: %q", out)
		}
	})

	t.Run("range plate diffs the two revs, --json carries the ledger", func(t *testing.T) {
		repo := gitInit(t) // feat edits src/prices.ts:3 and adds src/retry.ts (2 lines)
		ctx, plate := newTestPlate(t, repo, "--about", "main..feat")
		visual := writeFile(t, t.TempDir(), "map.json", testMap)
		code, _, errb := run(t, ctx, "add", plate, "--title", "c", "--visual", visual,
			"--ref", "diff:src/prices.ts@main..feat#head:3 @cache the jitter line")
		if code != 0 {
			t.Fatal(errb)
		}
		code, out, errb := run(t, ctx, "done", plate, "--json")
		if code != 0 {
			t.Fatalf("done: exit %d, %s", code, errb)
		}
		var res struct {
			Total  int              `json:"total"`
			Sealed bool             `json:"sealed"`
			Ledger *protocol.Ledger `json:"ledger"`
		}
		if err := json.Unmarshal([]byte(out), &res); err != nil {
			t.Fatalf("--json output: %v\n%s", err, out)
		}
		if res.Ledger == nil || res.Ledger.Shown != 1 || res.Ledger.Total != 2 || len(res.Ledger.Hunks) != 1 {
			t.Fatalf("json ledger = %+v", res.Ledger)
		}
		h := res.Ledger.Hunks[0]
		if h.Path != "src/retry.ts" || h.Side != "head" || h.Start != 1 || h.End != 2 {
			t.Fatalf("uncovered hunk = %+v", h)
		}
		if diskL := readLedger(t, plate); diskL.Total != 2 {
			t.Fatalf("ledger.json = %+v", diskL)
		}
	})

	t.Run("re-seal leaves the sealed ledger alone", func(t *testing.T) {
		repo := gitInit(t)
		ctx, plate := newTestPlate(t, repo, "--about", "worktree")
		visual := writeFile(t, t.TempDir(), "map.json", testMap)
		if code, _, errb := run(t, ctx, "add", plate, "--title", "c", "--visual", visual); code != 0 {
			t.Fatal(errb)
		}
		if code, _, errb := run(t, ctx, "done", plate); code != 0 {
			t.Fatal(errb)
		}
		before := readLedger(t, plate)
		writeFile(t, repo, "later.txt", "l1\n") // the diff grows after sealing
		if code, _, errb := run(t, ctx, "done", plate); code != 0 {
			t.Fatalf("re-seal: %s", errb)
		}
		after := readLedger(t, plate)
		if after.Total != before.Total || len(after.Hunks) != len(before.Hunks) {
			t.Fatalf("re-seal rewrote the ledger: %+v -> %+v", before, after)
		}
	})

	t.Run("unresolvable range side seals nothing", func(t *testing.T) {
		repo := gitInit(t)
		ctx, plate := newTestPlate(t, repo, "--about", "main..nope")
		visual := writeFile(t, t.TempDir(), "map.json", testMap)
		if code, _, errb := run(t, ctx, "add", plate, "--title", "c", "--visual", visual); code != 0 {
			t.Fatal(errb)
		}
		code, _, errb := run(t, ctx, "done", plate)
		if code != 1 || !strings.Contains(errb, "nope") {
			t.Fatalf("exit %d stderr %q", code, errb)
		}
		if _, err := os.Stat(filepath.Join(plate, "done")); !os.IsNotExist(err) {
			t.Fatalf("plate sealed despite the failed coverage check")
		}
		if _, err := os.Stat(filepath.Join(plate, "ledger.json")); !os.IsNotExist(err) {
			t.Fatalf("ledger written despite the failed coverage check")
		}
	})
}

// TestDoneCheck: --check previews coverage without sealing anything.
func TestDoneCheck(t *testing.T) {
	t.Run("leaves the plate open, then cover and seal", func(t *testing.T) {
		repo := gitInit(t) // uncommitted edit on src/pool.ts line 1
		ctx, plate := newTestPlate(t, repo, "--about", "worktree")
		visual := writeFile(t, t.TempDir(), "map.json", testMap)
		if code, _, errb := run(t, ctx, "add", plate, "--title", "c", "--visual", visual); code != 0 {
			t.Fatal(errb)
		}

		code, out, errb := run(t, ctx, "done", plate, "--check", "--json")
		if code != 0 {
			t.Fatalf("check: exit %d, %s", code, errb)
		}
		var res struct {
			Sealed bool             `json:"sealed"`
			Ledger *protocol.Ledger `json:"ledger"`
		}
		if err := json.Unmarshal([]byte(out), &res); err != nil {
			t.Fatalf("--check --json: %v\n%s", err, out)
		}
		if res.Sealed {
			t.Fatalf("--check claims sealed: %s", out)
		}
		if res.Ledger == nil || len(res.Ledger.Hunks) != 1 || res.Ledger.Hunks[0].Path != "src/pool.ts" {
			t.Fatalf("check ledger = %+v", res.Ledger)
		}
		for _, f := range []string{"done", "ledger.json"} {
			if _, err := os.Stat(filepath.Join(plate, f)); !os.IsNotExist(err) {
				t.Fatalf("--check wrote %s", f)
			}
		}

		// The plate is still open: cover the reported hunk, then seal.
		if code, _, errb := run(t, ctx, "add", plate, "--title", "c2", "--visual", visual,
			"--ref", "src/pool.ts:1 @cache the pool bump"); code != 0 {
			t.Fatalf("add after check: %s", errb)
		}
		if code, _, errb := run(t, ctx, "done", plate); code != 0 {
			t.Fatal(errb)
		}
		if l := readLedger(t, plate); len(l.Hunks) != 0 || l.Shown != l.Total {
			t.Fatalf("sealed ledger after covering = %+v", l)
		}
	})

	t.Run("nothing to check on a code plate", func(t *testing.T) {
		repo := gitInit(t)
		ctx, plate := newTestPlate(t, repo)
		visual := writeFile(t, t.TempDir(), "map.json", testMap)
		if code, _, errb := run(t, ctx, "add", plate, "--title", "c", "--visual", visual); code != 0 {
			t.Fatal(errb)
		}
		code, _, errb := run(t, ctx, "done", plate, "--check")
		if code != 0 {
			t.Fatalf("exit %d, %s", code, errb)
		}
		if !strings.Contains(errb, "nothing to check") {
			t.Fatalf("stderr %q should say there is nothing to check", errb)
		}
		if _, err := os.Stat(filepath.Join(plate, "done")); !os.IsNotExist(err) {
			t.Fatalf("--check sealed a code plate")
		}
	})

	t.Run("sealed plate reports the sealed ledger as it is", func(t *testing.T) {
		repo := gitInit(t)
		ctx, plate := newTestPlate(t, repo, "--about", "worktree")
		visual := writeFile(t, t.TempDir(), "map.json", testMap)
		if code, _, errb := run(t, ctx, "add", plate, "--title", "c", "--visual", visual); code != 0 {
			t.Fatal(errb)
		}
		if code, _, errb := run(t, ctx, "done", plate); code != 0 {
			t.Fatal(errb)
		}
		sealed := readLedger(t, plate)
		writeFile(t, repo, "later.txt", "l1\n") // diff grows after the seal
		code, out, errb := run(t, ctx, "done", plate, "--check", "--json")
		if code != 0 {
			t.Fatalf("exit %d, %s", code, errb)
		}
		var res struct {
			Ledger *protocol.Ledger `json:"ledger"`
		}
		if err := json.Unmarshal([]byte(out), &res); err != nil {
			t.Fatal(err)
		}
		if res.Ledger == nil || res.Ledger.Total != sealed.Total || len(res.Ledger.Hunks) != len(sealed.Hunks) {
			t.Fatalf("check on sealed plate = %+v, want the sealed %+v", res.Ledger, sealed)
		}
	})
}
