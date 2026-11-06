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

const reviewDone = `{"comments":[]}`
const reviewComments = `{"comments":[{"target":"n2:cache","text":"callers in billing/ also read this"}]}`

func TestRunServe(t *testing.T) {
	repo := gitInit(t)

	t.Run("pre-existing review prints and exits headless", func(t *testing.T) {
		ctx, plate := sealedPlate(t, repo)
		writeFile(t, plate, "review.json", reviewDone)
		start := time.Now()
		code, out, _ := run(t, ctx, "serve", plate, "--no-ui")
		if code != 0 {
			t.Fatalf("exit = %d, want 0 (done)", code)
		}
		if time.Since(start) > time.Second {
			t.Fatal("should exit immediately")
		}
		if !strings.Contains(out, "done — no comments") {
			t.Fatalf("stdout = %q", out)
		}
	})

	t.Run("review arriving mid-wait is detected", func(t *testing.T) {
		ctx, plate := sealedPlate(t, repo)
		go func() {
			time.Sleep(300 * time.Millisecond)
			os.WriteFile(filepath.Join(plate, "review.json"), []byte(reviewComments), 0o644)
		}()
		start := time.Now()
		code, out, _ := run(t, ctx, "serve", plate)
		if code != 2 {
			t.Fatalf("exit = %d, want 2 (comments)", code)
		}
		if d := time.Since(start); d > 2*time.Second {
			t.Fatalf("detected after %v, want < 2s", d)
		}
		if !strings.Contains(out, "n2:cache") || !strings.Contains(out, "billing/") {
			t.Fatalf("stdout = %q", out)
		}
	})

	t.Run("review exit codes", func(t *testing.T) {
		for name, tc := range map[string]struct {
			review string
			want   int
		}{
			"done, empty comments": {reviewDone, 0},
			"done, bare object":    {`{}`, 0},
			"comments to handle":   {reviewComments, 2},
		} {
			ctx, plate := sealedPlate(t, repo)
			writeFile(t, plate, "review.json", tc.review)
			if code, _, _ := run(t, ctx, "serve", plate, "--no-ui"); code != tc.want {
				t.Fatalf("%s: exit = %d, want %d", name, code, tc.want)
			}
		}
	})

	t.Run("complete but invalid review fails instead of hanging", func(t *testing.T) {
		ctx, plate := sealedPlate(t, repo)
		writeFile(t, plate, "review.json", `{"comments":[{"target":"n1"}]}`)
		code, _, errb := run(t, ctx, "serve", plate, "--no-ui", "--timeout", "5s")
		if code != 1 {
			t.Fatalf("exit = %d, want 1", code)
		}
		if !strings.Contains(errb, "review.malformed") {
			t.Fatalf("stderr = %q", errb)
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
		writeFile(t, plate, "review.json", reviewComments)
		code, out, _ := run(t, ctx, "serve", plate, "--json", "--no-ui")
		if code != 2 {
			t.Fatalf("exit = %d", code)
		}
		var obj struct {
			Comments []struct {
				Target string `json:"target"`
			} `json:"comments"`
		}
		if err := json.Unmarshal([]byte(out), &obj); err != nil || len(obj.Comments) != 1 || obj.Comments[0].Target != "n2:cache" {
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
