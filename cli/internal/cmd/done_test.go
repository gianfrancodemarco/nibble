package cmd

import (
	"encoding/json"
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
			if code, _, errb := run(t, ctx, "add", plate, "--caption", "c", "--visual", visual); code != 0 {
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
