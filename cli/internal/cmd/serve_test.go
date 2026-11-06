package cmd

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func sealedPlate(t *testing.T, repo string) (Ctx, string) {
	t.Helper()
	visual := writeFile(t, t.TempDir(), "map.json", testMap)
	ctx, plate := newTestPlate(t, repo)
	if code, _, errb := run(t, ctx, "add", plate, "--title", "c", "--visual", visual); code != 0 {
		t.Fatal(errb)
	}
	if code, _, errb := run(t, ctx, "done", plate); code != 0 {
		t.Fatal(errb)
	}
	return ctx, plate
}

func review(verdict string) string {
	return `{"verdict":"` + verdict + `","comments":[{"target":"n2:cache","text":"callers in billing/ also read this"}]}`
}

func TestRunServe(t *testing.T) {
	repo := gitInit(t)

	t.Run("pre-existing review prints and exits headless", func(t *testing.T) {
		ctx, plate := sealedPlate(t, repo)
		writeFile(t, plate, "review.json", review("approve"))
		start := time.Now()
		code, out, _ := run(t, ctx, "serve", plate, "--no-ui")
		if code != 0 {
			t.Fatalf("exit = %d, want 0 (approve)", code)
		}
		if time.Since(start) > time.Second {
			t.Fatal("should exit immediately")
		}
		if !strings.Contains(out, "verdict: approve") {
			t.Fatalf("stdout = %q", out)
		}
	})

	t.Run("review arriving mid-wait is detected", func(t *testing.T) {
		ctx, plate := sealedPlate(t, repo)
		go func() {
			time.Sleep(300 * time.Millisecond)
			os.WriteFile(filepath.Join(plate, "review.json"), []byte(review("changes")), 0o644)
		}()
		start := time.Now()
		code, out, _ := run(t, ctx, "serve", plate)
		if code != 2 {
			t.Fatalf("exit = %d, want 2 (changes)", code)
		}
		if d := time.Since(start); d > 2*time.Second {
			t.Fatalf("detected after %v, want < 2s", d)
		}
		if !strings.Contains(out, "n2:cache") || !strings.Contains(out, "billing/") {
			t.Fatalf("stdout = %q", out)
		}
	})

	t.Run("verdict exit codes", func(t *testing.T) {
		for verdict, want := range map[string]int{"question": 3, "closed": 4} {
			ctx, plate := sealedPlate(t, repo)
			writeFile(t, plate, "review.json", review(verdict))
			if code, _, _ := run(t, ctx, "serve", plate, "--no-ui"); code != want {
				t.Fatalf("%s: exit = %d, want %d", verdict, code, want)
			}
		}
	})

	t.Run("timeout exits 5 and leaves the plate alone", func(t *testing.T) {
		ctx, plate := sealedPlate(t, repo)
		code, _, _ := run(t, ctx, "serve", plate, "--timeout", "100ms")
		if code != 5 {
			t.Fatalf("exit = %d, want 5", code)
		}
		if _, err := os.Stat(filepath.Join(plate, "review.json")); !os.IsNotExist(err) {
			t.Fatal("review.json should not exist")
		}
	})

	t.Run("json output", func(t *testing.T) {
		ctx, plate := sealedPlate(t, repo)
		writeFile(t, plate, "review.json", review("changes"))
		code, out, _ := run(t, ctx, "serve", plate, "--json", "--no-ui")
		if code != 2 {
			t.Fatalf("exit = %d", code)
		}
		var obj struct {
			Verdict string `json:"verdict"`
		}
		if err := json.Unmarshal([]byte(out), &obj); err != nil || obj.Verdict != "changes" {
			t.Fatalf("json = %q (%v)", out, err)
		}
	})

	t.Run("invalid plate fails before blocking", func(t *testing.T) {
		ctx := Ctx{Dir: repo, Home: t.TempDir()}
		code, _, _ := run(t, ctx, "serve", filepath.Join(t.TempDir(), "nope"))
		if code != 1 {
			t.Fatalf("exit = %d, want 1", code)
		}
	})
}
