package cmd

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gianfrancodemarco/nibble/cli/internal/protocol"
)

// nibble reply: the agent answers one comment of the latest round on the
// same plate, validated like add.

const twoCommentReview = `{"comments":[{"target":"n1:cache","text":"is the ttl theirs too?"},{"target":"n1","text":"why not jitter?"}]}`

// reviewedPlate seals a one-nibble plate (visual: cache, db) and writes the
// given review.json.
func reviewedPlate(t *testing.T, repo, review string) (Ctx, string) {
	t.Helper()
	ctx, plate := sealedPlate(t, repo)
	writeFile(t, plate, "review.json", review)
	return ctx, plate
}

func TestRunReply(t *testing.T) {
	repo := gitInit(t)

	t.Run("first reply, then the round answered", func(t *testing.T) {
		ctx, plate := reviewedPlate(t, repo, twoCommentReview)
		code, out, errb := run(t, ctx, "reply", plate, "--to", "1", "--text", "Yes, the same lines.")
		if code != 0 {
			t.Fatalf("exit = %d, stderr = %s", code, errb)
		}
		if out != "" {
			t.Fatalf("stdout should stay clean, got %q", out)
		}
		if !strings.Contains(errb, "1 of 2") {
			t.Fatalf("stderr = %q, want the answered count", errb)
		}
		p, err := protocol.ParsePlate(plate)
		if err != nil {
			t.Fatal(err)
		}
		if r := p.Rounds[0].ReplyTo(1); r == nil || r.Text != "Yes, the same lines." {
			t.Fatalf("reply.json: %+v", p.Rounds[0].Replies)
		}
		if p.Turn() != protocol.TurnAgent {
			t.Fatalf("turn = %q, want agent", p.Turn())
		}

		code, out, errb = run(t, ctx, "reply", plate, "--to", "2", "--text", "Jitter is the fix.", "--json")
		if code != 0 {
			t.Fatalf("exit = %d, stderr = %s", code, errb)
		}
		var obj struct {
			Round, To, Answered, Of int
		}
		if err := json.Unmarshal([]byte(out), &obj); err != nil || obj != (struct{ Round, To, Answered, Of int }{1, 2, 2, 2}) {
			t.Fatalf("json = %q (%v)", out, err)
		}
		p, _ = protocol.ParsePlate(plate)
		if p.Turn() != protocol.TurnReader {
			t.Fatalf("turn = %q, want reader (round answered)", p.Turn())
		}
	})

	t.Run("round answered is said", func(t *testing.T) {
		ctx, plate := reviewedPlate(t, repo, `{"comments":[{"target":"n1","text":"?"}]}`)
		_, _, errb := run(t, ctx, "reply", plate, "--to", "1", "--text", "answer")
		if !strings.Contains(errb, "round 1 answered") {
			t.Fatalf("stderr = %q", errb)
		}
	})

	t.Run("refusals", func(t *testing.T) {
		for name, tc := range map[string]struct {
			review string
			args   []string
			want   string
			exit   int
		}{
			"no review":       {"", []string{"--to", "1", "--text", "x"}, "reply.target", 1},
			"done review":     {`{"comments":[]}`, []string{"--to", "1", "--text", "x"}, "reply.target", 1},
			"index beyond":    {twoCommentReview, []string{"--to", "3", "--text", "x"}, "reply.target", 1},
			"missing --to":    {twoCommentReview, []string{"--text", "x"}, "", 2},
			"missing --text":  {twoCommentReview, []string{"--to", "1"}, "", 2},
			"ref beyond eof":  {twoCommentReview, []string{"--to", "1", "--text", "x", "--ref", "src/prices.ts:1-80"}, "ref.range.beyond-eof", 1},
			"ref with anchor": {twoCommentReview, []string{"--to", "1", "--text", "x", "--ref", "src/prices.ts:3-4 @cache"}, "reply.anchor", 1},
			"dangling link":   {twoCommentReview, []string{"--to", "1", "--text", "[x](@nope)"}, "reply.anchor", 1},
			"link on ledger":  {`{"comments":[{"target":"ledger:src/a.ts","text":"?"}]}`, []string{"--to", "1", "--text", "[x](@cache)"}, "reply.anchor", 1},
			"over budget":     {twoCommentReview, []string{"--to", "1", "--text", strings.Repeat("word ", 151)}, "cli.budget", 1},
		} {
			t.Run(name, func(t *testing.T) {
				ctx, plate := sealedPlate(t, repo)
				if tc.review != "" {
					writeFile(t, plate, "review.json", tc.review)
				}
				code, _, errb := run(t, ctx, append([]string{"reply", plate}, tc.args...)...)
				if code != tc.exit {
					t.Fatalf("exit = %d, want %d (%s)", code, tc.exit, errb)
				}
				if tc.want != "" && !strings.Contains(errb, tc.want) {
					t.Fatalf("stderr = %q, want %s", errb, tc.want)
				}
				if _, err := os.Stat(filepath.Join(plate, "reply.json")); !os.IsNotExist(err) {
					t.Fatal("a refused reply must write nothing")
				}
			})
		}
		// index beyond names the comments
		ctx, plate := reviewedPlate(t, repo, twoCommentReview)
		_, _, errb := run(t, ctx, "reply", plate, "--to", "3", "--text", "x")
		if !strings.Contains(errb, "n1:cache") || !strings.Contains(errb, "why not jitter?") {
			t.Fatalf("reply.target should list the round's comments: %q", errb)
		}
	})

	t.Run("duplicate leaves the file unchanged", func(t *testing.T) {
		ctx, plate := reviewedPlate(t, repo, twoCommentReview)
		if code, _, errb := run(t, ctx, "reply", plate, "--to", "1", "--text", "first"); code != 0 {
			t.Fatal(errb)
		}
		before, _ := os.ReadFile(filepath.Join(plate, "reply.json"))
		code, _, errb := run(t, ctx, "reply", plate, "--to", "1", "--text", "again")
		if code != 1 || !strings.Contains(errb, "reply.duplicate") {
			t.Fatalf("exit = %d, stderr = %q", code, errb)
		}
		after, _ := os.ReadFile(filepath.Join(plate, "reply.json"))
		if string(before) != string(after) {
			t.Fatal("reply.json changed on a refused duplicate")
		}
	})

	t.Run("refs are verified and fingerprinted; prose links resolve", func(t *testing.T) {
		ctx, plate := reviewedPlate(t, repo, twoCommentReview)
		code, _, errb := run(t, ctx, "reply", plate, "--to", "1",
			"--text", "The [cache](@cache) keeps it on these lines.",
			"--ref", "src/prices.ts:3-4 the ttl lines")
		if code != 0 {
			t.Fatalf("exit = %d, stderr = %s", code, errb)
		}
		p, err := protocol.ParsePlate(plate)
		if err != nil {
			t.Fatal(err)
		}
		ref := p.Rounds[0].ReplyTo(1).Refs[0]
		if !strings.HasPrefix(ref.FP, "fp1:") || len(ref.Lines) != 2 || ref.Ref != "src/prices.ts:3-4 the ttl lines" {
			t.Fatalf("ref not fingerprinted: %+v", ref)
		}
	})

	t.Run("budget override stores the reason", func(t *testing.T) {
		ctx, plate := reviewedPlate(t, repo, twoCommentReview)
		code, _, errb := run(t, ctx, "reply", plate, "--to", "1",
			"--text", strings.Repeat("word ", 151), "--because", "the race needs the full trace")
		if code != 0 {
			t.Fatalf("exit = %d, stderr = %s", code, errb)
		}
		p, _ := protocol.ParsePlate(plate)
		if p.Rounds[0].ReplyTo(1).Because != "the race needs the full trace" {
			t.Fatalf("because not stored: %+v", p.Rounds[0].ReplyTo(1))
		}
	})

	t.Run("a later round's reply lands in reply.2.json; follow-up links resolve against the opener", func(t *testing.T) {
		ctx, plate := reviewedPlate(t, repo, twoCommentReview)
		writeFile(t, plate, "reply.json", `{"replies":[{"to":1,"text":"a"},{"to":2,"text":"b"}]}`)
		writeFile(t, plate, "review.2.json", `{"comments":[{"thread":"1.1","text":"and billing?"}]}`)
		code, _, errb := run(t, ctx, "reply", plate, "--to", "1", "--text", "The [cache](@cache) covers billing too.")
		if code != 0 {
			t.Fatalf("exit = %d, stderr = %s", code, errb)
		}
		if _, err := os.Stat(filepath.Join(plate, "reply.2.json")); err != nil {
			t.Fatal("reply.2.json not written")
		}
		p, err := protocol.ParsePlate(plate)
		if err != nil {
			t.Fatal(err)
		}
		if p.Turn() != protocol.TurnReader || len(p.Rounds) != 2 {
			t.Fatalf("turn = %q, rounds = %d", p.Turn(), len(p.Rounds))
		}
	})
}

// A portable plate's repo is relative to the plate directory and may be a
// plain snapshot without git: plain refs still verify there.
func TestRunReplyRelativeSnapshotRoot(t *testing.T) {
	home := t.TempDir()
	plate := filepath.Join(home, "plate")
	if err := os.MkdirAll(filepath.Join(home, "repo", "src"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(plate, 0o755); err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(home, "repo", "src"), "prices.ts", "a\nb\nttl: 3600\ncache.set()\ne\n")
	writeFile(t, plate, "plate.json", `{"version":1,"title":"t","repo":"../repo","head_sha":"abc","about":"code","created_at":"2026-11-01T10:00:00Z"}`)
	writeFile(t, plate, "n1.json", `{"title":"c","visual":`+testMap+`,"refs":[]}`)
	writeFile(t, plate, "done", `{"total":1}`)
	writeFile(t, plate, "review.json", `{"comments":[{"target":"n1","text":"?"},{"target":"n1","text":"and?"}]}`)
	ctx := Ctx{Dir: t.TempDir(), Home: home} // cwd is elsewhere: the root must resolve from the plate
	code, _, errb := run(t, ctx, "reply", plate, "--to", "1", "--text", "these lines", "--ref", "src/prices.ts:3-4")
	if code != 0 {
		t.Fatalf("exit = %d, stderr = %s", code, errb)
	}
	code, _, errb = run(t, ctx, "reply", plate, "--to", "2", "--text", "x", "--ref", "diff:src/prices.ts@main..feat#head:3")
	if code != 1 || !strings.Contains(errb, "cli.repo.missing") {
		t.Fatalf("a diff ref without git: exit = %d, stderr = %s", code, errb)
	}
}
