package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gianfrancodemarco/nibble/cli/internal/protocol"
)

const testMap = `{"kind":"map","title":"what getPrice touches","nodes":[{"id":"cache","label":"cache"},{"id":"db","label":"db"}],"edges":[{"from":"cache","to":"db"}]}`

func writeFile(t *testing.T, dir, name, content string) string {
	t.Helper()
	p := filepath.Join(dir, name)
	if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

// newTestPlate creates a plate in a fresh home inside repo's context.
func newTestPlate(t *testing.T, repo string, aboutArgs ...string) (Ctx, string) {
	t.Helper()
	ctx := Ctx{Dir: repo, Home: t.TempDir()}
	args := append([]string{"new", "--title", "t"}, aboutArgs...)
	code, out, errb := run(t, ctx, args...)
	if code != 0 {
		t.Fatalf("new failed: %s", errb)
	}
	return ctx, strings.TrimSpace(out)
}

func TestRunAdd(t *testing.T) {
	repo := gitInit(t)
	ctx, plate := newTestPlate(t, repo)
	visual := writeFile(t, t.TempDir(), "map.json", testMap)

	t.Run("happy path appends fingerprinted nibble", func(t *testing.T) {
		code, out, errb := run(t, ctx, "add", plate,
			"--title", "The **cache** is where the trouble starts.",
			"--visual", visual,
			"--ref", "src/prices.ts:3-4 @cache the ttl lines")
		if code != 0 {
			t.Fatalf("exit = %d, stderr = %s", code, errb)
		}
		if out != "" {
			t.Fatalf("stdout should stay clean, got %q", out)
		}
		p, err := protocol.ParsePlate(plate)
		if err != nil || len(p.Nibbles) != 1 {
			t.Fatalf("plate after add: %v, %v", err, p)
		}
		ref := p.Nibbles[0].Refs[0]
		if !strings.HasPrefix(ref.FP, "fp1:") || len(ref.Lines) != 2 {
			t.Fatalf("ref not fingerprinted: %+v", ref)
		}
	})

	t.Run("second add is contiguous", func(t *testing.T) {
		code, _, errb := run(t, ctx, "add", plate, "--title", "c", "--visual", visual)
		if code != 0 {
			t.Fatalf("exit = %d, stderr = %s", code, errb)
		}
		if _, err := os.Stat(filepath.Join(plate, "n2.json")); err != nil {
			t.Fatal("n2.json missing")
		}
	})

	rejects := []struct {
		name string
		args []string
		code string
	}{
		{"ref beyond eof names count", []string{"--ref", "src/pool.ts:1-99"}, "ref.range.beyond-eof"},
		{"ref file missing", []string{"--ref", "src/nope.ts:1"}, "ref.file.missing"},
		{"dangling anchor", []string{"--ref", "src/pool.ts:1 @ghost"}, "ref.anchor.dangling"},
		{"base side missing", []string{"--ref", "diff:src/retry.ts@main..feat#base:1"}, "ref.diff.side-missing"},
	}
	for _, tt := range rejects {
		t.Run(tt.name, func(t *testing.T) {
			before, _ := protocol.ParsePlate(plate)
			args := append([]string{"add", plate, "--title", "c", "--visual", visual}, tt.args...)
			code, _, errb := run(t, ctx, args...)
			if code != 1 || !strings.Contains(errb, tt.code) {
				t.Fatalf("exit = %d, stderr = %q, want code %s", code, errb, tt.code)
			}
			after, _ := protocol.ParsePlate(plate)
			if len(after.Nibbles) != len(before.Nibbles) {
				t.Fatal("rejection must not write a nibble")
			}
			tmp, _ := filepath.Glob(filepath.Join(plate, "*.tmp"))
			if len(tmp) != 0 {
				t.Fatalf("temp files left behind: %v", tmp)
			}
		})
	}

	t.Run("beyond eof reports the real line count", func(t *testing.T) {
		code, _, errb := run(t, ctx, "add", plate, "--title", "c", "--visual", visual, "--ref", "src/pool.ts:1-99")
		if code != 1 || !strings.Contains(errb, "2 lines") {
			t.Fatalf("stderr should name the 2-line file: %q", errb)
		}
	})

	t.Run("pixel smuggling visual rejected", func(t *testing.T) {
		bad := writeFile(t, t.TempDir(), "bad.json", `{"kind":"map","title":"m","nodes":[{"id":"a","label":"A","x":3}]}`)
		code, _, errb := run(t, ctx, "add", plate, "--title", "c", "--visual", bad)
		if code != 1 || !strings.Contains(errb, "visual.field.unknown") {
			t.Fatalf("exit %d stderr %q", code, errb)
		}
	})

	t.Run("worktree diff ref fingerprints the disk side", func(t *testing.T) {
		code, _, errb := run(t, ctx, "add", plate, "--title", "c", "--visual", visual,
			"--ref", "diff:src/pool.ts@worktree:1-2")
		if code != 0 {
			t.Fatalf("exit = %d, stderr = %s", code, errb)
		}
	})

	t.Run("range head side resolves through git", func(t *testing.T) {
		code, _, errb := run(t, ctx, "add", plate, "--title", "c", "--visual", visual,
			"--ref", "diff:src/retry.ts@main..feat#head:1-2")
		if code != 0 {
			t.Fatalf("exit = %d, stderr = %s", code, errb)
		}
	})

	t.Run("sealed plate refuses adds", func(t *testing.T) {
		_, sealed := newTestPlate(t, repo)
		run(t, ctx, "add", sealed, "--title", "c", "--visual", visual)
		if code, _, _ := run(t, Ctx{Dir: repo}, "done", sealed); code != 0 {
			t.Skip("done not implemented yet")
		}
		code, _, errb := run(t, ctx, "add", sealed, "--title", "c", "--visual", visual)
		if code != 1 || !strings.Contains(errb, "plate.sealed") {
			t.Fatalf("exit %d stderr %q", code, errb)
		}
	})

	t.Run("json error shape", func(t *testing.T) {
		code, out, _ := run(t, ctx, "add", plate, "--title", "c", "--visual", visual,
			"--ref", "src/nope.ts:1", "--json")
		if code != 1 {
			t.Fatal("exit != 1")
		}
		var obj struct {
			Error struct{ Code, Message string }
		}
		if err := json.Unmarshal([]byte(out), &obj); err != nil || obj.Error.Code != "ref.file.missing" {
			t.Fatalf("json error = %q (%v)", out, err)
		}
	})
}

func TestRunAddBudgets(t *testing.T) {
	repo := gitInit(t)
	visual := writeFile(t, t.TempDir(), "map.json", testMap)
	long := strings.Repeat("word ", 41)

	t.Run("over-long title needs --because", func(t *testing.T) {
		ctx, plate := newTestPlate(t, repo)
		code, _, errb := run(t, ctx, "add", plate, "--title", long, "--visual", visual)
		if code != 1 || !strings.Contains(errb, "cli.budget") ||
			!strings.Contains(errb, "40") || !strings.Contains(errb, "--because") {
			t.Fatalf("exit %d stderr %q", code, errb)
		}
		code, _, errb = run(t, ctx, "add", plate, "--title", long, "--visual", visual,
			"--because", "the race needs three actors")
		if code != 0 {
			t.Fatalf("with --because: exit %d stderr %q", code, errb)
		}
		p, _ := protocol.ParsePlate(plate)
		if p.Nibbles[0].Because != "the race needs three actors" {
			t.Fatalf("because not stored: %+v", p.Nibbles[0])
		}
	})

	t.Run("code plate allows 7 nibbles, rejects the 8th", func(t *testing.T) {
		ctx, plate := newTestPlate(t, repo)
		for i := 1; i <= 7; i++ {
			if code, _, errb := run(t, ctx, "add", plate, "--title", fmt.Sprintf("c%d", i), "--visual", visual); code != 0 {
				t.Fatalf("add %d: %s", i, errb)
			}
		}
		code, _, errb := run(t, ctx, "add", plate, "--title", "c8", "--visual", visual)
		if code != 1 || !strings.Contains(errb, "cli.budget") {
			t.Fatalf("8th add: exit %d stderr %q", code, errb)
		}
		if code, _, _ := run(t, ctx, "add", plate, "--title", "c8", "--visual", visual, "--because", "big"); code != 0 {
			t.Fatal("8th with --because should pass")
		}
	})

	t.Run("range plate allows 12", func(t *testing.T) {
		ctx, plate := newTestPlate(t, repo, "--about", "main..feat")
		for i := 1; i <= 12; i++ {
			if code, _, errb := run(t, ctx, "add", plate, "--title", fmt.Sprintf("c%d", i), "--visual", visual); code != 0 {
				t.Fatalf("add %d: %s", i, errb)
			}
		}
		code, _, errb := run(t, ctx, "add", plate, "--title", "c13", "--visual", visual)
		if code != 1 || !strings.Contains(errb, "cli.budget") {
			t.Fatalf("13th add: exit %d stderr %q", code, errb)
		}
	})
}
