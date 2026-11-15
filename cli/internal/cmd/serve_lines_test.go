package cmd

import (
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
)

// A line comment prints with its location on the heading and the lines it
// names quoted, so the agent reads the code the human pointed at.
func TestServePrintsLines(t *testing.T) {
	repo := gitInit(t)

	t.Run("bare ref quotes the lines at their range", func(t *testing.T) {
		ctx, plate := sealedPlate(t, repo)
		writeFile(t, plate, "review.json", `{"comments":[{"target":"n2:cache","ref":{"ref":"src/prices.ts:3-4"},"text":"hard-coded"}]}`)
		code, out, _ := run(t, ctx, "serve", plate, "--no-ui", "--timeout", "5s")
		if code != 2 {
			t.Fatalf("exit = %d", code)
		}
		for _, want := range []string{"## n2:cache · src/prices.ts:3-4 · 1.1", "3  ttl: 3600", "4  cache.set()", "> hard-coded"} {
			if !strings.Contains(out, want) {
				t.Errorf("stdout lacks %q:\n%s", want, out)
			}
		}
		if strings.Index(out, "ttl: 3600") > strings.Index(out, "> hard-coded") {
			t.Errorf("the lines print before the comment:\n%s", out)
		}
	})

	t.Run("moved lines are quoted where they are now", func(t *testing.T) {
		repo := gitInit(t)
		ctx, plate := sealedPlate(t, repo)
		writeFile(t, plate, "review.json", `{"comments":[{"target":"n2:cache","ref":`+storedRefFor(t, repo, "src/prices.ts", 3, 4)+`,"text":"hard-coded"}]}`)
		writeFile(t, repo, "src/prices.ts", "x\ny\na\nb\nttl: 3600\ncache.set()\ne\n")
		_, out, _ := run(t, ctx, "serve", plate, "--no-ui", "--timeout", "5s")
		for _, want := range []string{"## n2:cache · src/prices.ts:3-4 · 1.1", "moved", "now 5-6", "5  ttl: 3600", "6  cache.set()"} {
			if !strings.Contains(out, want) {
				t.Errorf("stdout lacks %q:\n%s", want, out)
			}
		}
	})

	t.Run("unreadable code keeps the location", func(t *testing.T) {
		ctx, plate := sealedPlate(t, repo)
		writeFile(t, plate, "review.json", `{"comments":[{"target":"n2:cache","ref":{"ref":"src/prices.ts:3-4"},"text":"hard-coded"}]}`)
		setPlateRepo(t, plate, filepath.Join(t.TempDir(), "gone"))
		_, out, _ := run(t, ctx, "serve", plate, "--no-ui", "--timeout", "5s")
		if !strings.Contains(out, "src/prices.ts:3-4 · 1.1") || !strings.Contains(out, "could not be read") || strings.Contains(out, "ttl: 3600") {
			t.Fatalf("stdout = %q", out)
		}
	})

	t.Run("json carries the ref with trust and lines", func(t *testing.T) {
		ctx, plate := sealedPlate(t, repo)
		writeFile(t, plate, "review.json", `{"comments":[{"target":"n2:cache","ref":`+storedRefFor(t, repo, "src/prices.ts", 3, 4)+`,"text":"hard-coded"},{"target":"n1","text":"plain"}]}`)
		_, out, _ := run(t, ctx, "serve", plate, "--no-ui", "--timeout", "5s", "--json")
		var got struct {
			Comments []struct {
				Ref *struct {
					Path  string   `json:"path"`
					Start int      `json:"start"`
					End   int      `json:"end"`
					Trust apiTrust `json:"trust"`
					Lines []struct {
						No   int    `json:"no"`
						Text string `json:"text"`
					} `json:"lines"`
				} `json:"ref"`
			} `json:"comments"`
		}
		if err := json.Unmarshal([]byte(out), &got); err != nil {
			t.Fatalf("%v: %s", err, out)
		}
		r := got.Comments[0].Ref
		if r == nil || r.Path != "src/prices.ts" || r.Start != 3 || r.End != 4 || r.Trust.Level != "exact" || len(r.Lines) != 2 || r.Lines[0].No != 3 || r.Lines[0].Text != "ttl: 3600" {
			t.Fatalf("ref = %+v", r)
		}
		if got.Comments[1].Ref != nil {
			t.Fatalf("plain comment must carry no ref")
		}
	})
}

// reply.target's listing names a line comment's location.
func TestReplyListsLines(t *testing.T) {
	repo := gitInit(t)
	ctx, plate := reviewedPlate(t, repo, `{"comments":[{"target":"n1:cache","ref":{"ref":"src/prices.ts:3-4"},"text":"hard-coded"}]}`)
	_, _, errb := run(t, ctx, "reply", plate, "--to", "3", "--text", "x")
	if !strings.Contains(errb, "n1:cache · src/prices.ts:3-4") {
		t.Fatalf("reply.target should name the lines: %q", errb)
	}
}
