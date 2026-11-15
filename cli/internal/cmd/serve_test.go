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
		writeFile(t, plate, "review.json", reviewComments)
		start := time.Now()
		code, out, _ := run(t, ctx, "serve", plate, "--no-ui")
		if code != 2 {
			t.Fatalf("exit = %d, want 2 (owed)", code)
		}
		if time.Since(start) > time.Second {
			t.Fatal("should exit immediately")
		}
		if !strings.Contains(out, "comments: 1") {
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
		// a done round landing exits 0; one already on disk is nothing to
		// address, so serve waits past it (5 on timeout); comments are owed
		for name, tc := range map[string]struct {
			review string
			want   int
		}{
			"done, empty comments": {reviewDone, 5},
			"done, bare object":    {`{}`, 5},
			"comments to handle":   {reviewComments, 2},
		} {
			ctx, plate := sealedPlate(t, repo)
			writeFile(t, plate, "review.json", tc.review)
			if code, _, _ := run(t, ctx, "serve", plate, "--no-ui", "--timeout", "100ms"); code != tc.want {
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

// The loop: serve waits for the next round the agent has not answered,
// prints it with thread history, and exits with what the agent owes.
func TestRunServeLoop(t *testing.T) {
	repo := gitInit(t)
	const answered = `{"replies":[{"to":1,"text":"billing reads the same lines"}]}`

	t.Run("headless on an unanswered round prints and exits 2 at once", func(t *testing.T) {
		ctx, plate := sealedPlate(t, repo)
		writeFile(t, plate, "review.json", reviewComments)
		start := time.Now()
		code, out, _ := run(t, ctx, "serve", plate, "--no-ui", "--timeout", "5s")
		if code != 2 || time.Since(start) > time.Second {
			t.Fatalf("exit = %d after %v, want 2 at once", code, time.Since(start))
		}
		if !strings.Contains(out, "comments: 1 · round 1") || !strings.Contains(out, "n2:cache") {
			t.Fatalf("stdout = %q", out)
		}
	})

	t.Run("a done round is nothing to address: serve waits past it", func(t *testing.T) {
		ctx, plate := sealedPlate(t, repo)
		writeFile(t, plate, "review.json", reviewComments)
		writeFile(t, plate, "reply.json", answered)
		writeFile(t, plate, "review.2.json", reviewDone)
		code, out, _ := run(t, ctx, "serve", plate, "--no-ui", "--timeout", "100ms")
		if code != 5 || out != "" {
			t.Fatalf("exit = %d, stdout = %q; want 5 and nothing printed", code, out)
		}
	})
	t.Run("a done round landing prints and exits 0", func(t *testing.T) {
		ctx, plate := sealedPlate(t, repo)
		writeFile(t, plate, "review.json", reviewComments)
		writeFile(t, plate, "reply.json", answered)
		go func() {
			time.Sleep(200 * time.Millisecond)
			os.WriteFile(filepath.Join(plate, "review.2.json"), []byte(reviewDone), 0o644)
		}()
		code, out, _ := run(t, ctx, "serve", plate, "--no-ui", "--timeout", "5s")
		if code != 0 || !strings.Contains(out, "done — no comments · round 2") {
			t.Fatalf("exit = %d, stdout = %q", code, out)
		}
	})

	t.Run("an answered round waits for the next and prints it with history", func(t *testing.T) {
		ctx, plate := sealedPlate(t, repo)
		writeFile(t, plate, "review.json", reviewComments)
		writeFile(t, plate, "reply.json", answered)
		go func() {
			time.Sleep(300 * time.Millisecond)
			os.WriteFile(filepath.Join(plate, "review.2.json"),
				[]byte(`{"comments":[{"thread":"1.1","text":"then jitter billing too?"}]}`), 0o644)
		}()
		start := time.Now()
		code, out, _ := run(t, ctx, "serve", plate, "--no-ui", "--timeout", "5s")
		if code != 2 || time.Since(start) > 2*time.Second {
			t.Fatalf("exit = %d after %v, want 2 within 2s", code, time.Since(start))
		}
		for _, want := range []string{"comments: 1 · round 2", "2.1", "n2:cache", "continues 1.1",
			"reader · round 1", "callers in billing/", "agent · round 1", "billing reads the same lines", "then jitter billing too?"} {
			if !strings.Contains(out, want) {
				t.Errorf("stdout lacks %q:\n%s", want, out)
			}
		}
		// the history precedes the follow-up's own text
		if strings.Index(out, "billing reads the same lines") > strings.Index(out, "then jitter billing too?") {
			t.Errorf("history should print before the follow-up:\n%s", out)
		}
	})

	t.Run("json of a later round carries round, ids and history", func(t *testing.T) {
		ctx, plate := sealedPlate(t, repo)
		writeFile(t, plate, "review.json", reviewComments)
		writeFile(t, plate, "reply.json", answered)
		writeFile(t, plate, "review.2.json", `{"comments":[{"thread":"1.1","text":"more?"}]}`)
		// round 2 is unanswered and pre-existing: headless prints it
		code, out, _ := run(t, ctx, "serve", plate, "--no-ui", "--json")
		if code != 2 {
			t.Fatalf("exit = %d", code)
		}
		var obj struct {
			Round    int `json:"round"`
			Comments []struct {
				ID      string `json:"id"`
				Thread  string `json:"thread"`
				Target  string `json:"target"`
				History []struct {
					From string `json:"from"`
					Text string `json:"text"`
				} `json:"history"`
			} `json:"comments"`
		}
		if err := json.Unmarshal([]byte(out), &obj); err != nil {
			t.Fatalf("json = %q (%v)", out, err)
		}
		if obj.Round != 2 || len(obj.Comments) != 1 || obj.Comments[0].ID != "2.1" || obj.Comments[0].Thread != "1.1" || obj.Comments[0].Target != "n2:cache" {
			t.Fatalf("json = %+v", obj)
		}
		if h := obj.Comments[0].History; len(h) != 2 || h[0].From != "reader" || h[1].From != "agent" {
			t.Fatalf("history = %+v", h)
		}
	})

	t.Run("a bad round fails instead of hanging", func(t *testing.T) {
		ctx, plate := sealedPlate(t, repo)
		writeFile(t, plate, "review.json", reviewComments)
		writeFile(t, plate, "reply.json", answered)
		go func() {
			time.Sleep(200 * time.Millisecond)
			os.WriteFile(filepath.Join(plate, "review.2.json"), []byte(`{"comments":[{"thread":"1.9","text":"?"}]}`), 0o644)
		}()
		code, _, errb := run(t, ctx, "serve", plate, "--no-ui", "--timeout", "5s")
		if code != 1 || !strings.Contains(errb, "review.thread") {
			t.Fatalf("exit = %d, stderr = %q", code, errb)
		}
	})

	t.Run("timeout with nothing owed exits 5 and prints nothing", func(t *testing.T) {
		ctx, plate := sealedPlate(t, repo)
		writeFile(t, plate, "review.json", reviewComments)
		writeFile(t, plate, "reply.json", answered)
		code, out, _ := run(t, ctx, "serve", plate, "--no-ui", "--timeout", "100ms")
		if code != 5 || out != "" {
			t.Fatalf("exit = %d, stdout = %q", code, out)
		}
	})
}
