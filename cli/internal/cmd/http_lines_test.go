package cmd

import (
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gianfrancodemarco/nibble/cli/internal/protocol"
)

// Line comments over the API: every drawer says the address of its lines
// (`at`), a comment's ref is served with trust and opened by id, and the
// POST verifies and fingerprints the ref the reader built.

// storedRefFor fingerprints path's lines start-end as `nibble add` would,
// so a test can write a review carrying a verifiable comment ref.
func storedRefFor(t *testing.T, repo, path string, start, end int) string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(repo, path))
	if err != nil {
		t.Fatal(err)
	}
	fp, err := protocol.NewFingerprint(protocol.SplitLines(raw), start, end)
	if err != nil {
		t.Fatal(err)
	}
	nr := protocol.NibbleRef{Ref: fmt.Sprintf("%s:%d-%d", path, start, end), FP: fp.Sum, Lines: fp.Lines, CtxBefore: fp.CtxBefore, CtxAfter: fp.CtxAfter}
	b, _ := json.Marshal(nr)
	return string(b)
}

func TestRefAt(t *testing.T) {
	cases := map[string]string{
		"src/a.ts:1-3 note":                      "src/a.ts",
		"diff:src/a.ts@worktree:4":               "diff:src/a.ts@worktree",
		"diff:src/a.ts@abc..def#head:1-2":        "diff:src/a.ts@abc..def#head",
		"diff:src/a.ts@abc..def#base:10-12 gone": "diff:src/a.ts@abc..def#base",
	}
	for in, want := range cases {
		ref, err := protocol.ParseRef(in)
		if err != nil {
			t.Fatal(err)
		}
		if got := refAt(ref); got != want {
			t.Errorf("refAt(%q) = %q, want %q", in, got, want)
		}
	}
}

type apiAt struct {
	At    string `json:"at"`
	Lines []struct {
		No int  `json:"no"`
		In bool `json:"in"`
	} `json:"lines"`
	Trust apiTrust `json:"trust"`
}

func TestAPIAddresses(t *testing.T) {
	_, _, ts := apiFixture(t)
	var c apiAt
	getJSON(t, ts.URL+"/api/code?n=1&ref=0", &c)
	if c.At != "src/prices.ts" {
		t.Fatalf("plain ref at = %q", c.At)
	}
	getJSON(t, ts.URL+"/api/code?n=2&ref=0", &c)
	if c.At != "diff:src/pool.ts@main..feat#head" {
		t.Fatalf("range ref at = %q", c.At)
	}
	var p struct {
		Nibbles []struct {
			Refs []struct {
				At string `json:"at"`
			} `json:"refs"`
		} `json:"nibbles"`
	}
	getJSON(t, ts.URL+"/api/plate", &p)
	if p.Nibbles[0].Refs[0].At != "src/prices.ts" || p.Nibbles[1].Refs[0].At != "diff:src/pool.ts@main..feat#head" {
		t.Fatalf("plate refs at = %+v", p.Nibbles)
	}

	// The ledger drawer: a worktree plate's base side reads the recorded
	// head commit; its head side is the worktree.
	_, plate := ledgeredFixture(t)
	api, err := newAPIServer(plate)
	if err != nil {
		t.Fatal(err)
	}
	lts := httptest.NewServer(api.handler())
	defer lts.Close()
	var hdr struct {
		HeadSHA string `json:"head_sha"`
	}
	raw, _ := os.ReadFile(filepath.Join(plate, "plate.json"))
	json.Unmarshal(raw, &hdr)
	getJSON(t, lts.URL+"/api/ledger?file=src/prices.ts&side=base", &c)
	if want := "diff:src/prices.ts@" + hdr.HeadSHA + ".." + hdr.HeadSHA + "#base"; c.At != want {
		t.Fatalf("ledger base at = %q, want %q", c.At, want)
	}
	getJSON(t, lts.URL+"/api/ledger?file=note.txt", &c)
	if c.At != "note.txt" {
		t.Fatalf("ledger head at = %q", c.At)
	}
}

type apiCommentRef struct {
	Ref   string   `json:"ref"`
	Path  string   `json:"path"`
	Start int      `json:"start"`
	End   int      `json:"end"`
	At    string   `json:"at"`
	Trust apiTrust `json:"trust"`
}

type apiLineThread struct {
	Rounds []struct {
		Comments []json.RawMessage `json:"comments"`
	} `json:"rounds"`
}

func TestAPICommentRefs(t *testing.T) {
	repo, plate, ts := apiFixture(t)
	ctx := Ctx{Dir: repo, Home: filepath.Dir(filepath.Dir(plate))}
	fpRef := storedRefFor(t, repo, "src/prices.ts", 3, 4)
	writeFile(t, plate, "review.json", `{"comments":[`+
		`{"target":"n1:cache","ref":`+fpRef+`,"text":"hard-coded"},`+
		`{"target":"n1","ref":{"ref":"src/prices.ts:5"},"text":"reachable?"},`+
		`{"target":"n2","text":"why?"}]}`)
	// the fingerprinted lines move down by two
	writeFile(t, repo, "src/prices.ts", "x\ny\na\nb\nttl: 3600\ncache.set()\ne\n")

	var p struct {
		Thread apiLineThread `json:"thread"`
	}
	getJSON(t, ts.URL+"/api/plate", &p)
	cs := p.Thread.Rounds[0].Comments
	var c struct {
		Ref *apiCommentRef `json:"ref"`
	}
	json.Unmarshal(cs[0], &c)
	if c.Ref == nil || c.Ref.Path != "src/prices.ts" || c.Ref.Start != 3 || c.Ref.End != 4 || c.Ref.At != "src/prices.ts" {
		t.Fatalf("comment 1 ref = %+v", c.Ref)
	}
	if c.Ref.Trust.Level != "shifted" || c.Ref.Trust.Line != 5 {
		t.Fatalf("comment 1 trust = %+v, want shifted to line 5", c.Ref.Trust)
	}
	json.Unmarshal(cs[1], &c)
	if c.Ref == nil || c.Ref.Trust.Level != "unverified" || c.Ref.Start != 5 {
		t.Fatalf("bare comment ref = %+v, want unverified", c.Ref)
	}
	var raw map[string]any
	json.Unmarshal(cs[2], &raw)
	if _, has := raw["ref"]; has {
		t.Fatalf("a comment without lines must carry no ref: %v", raw)
	}

	// /api/code?comment=<id>
	var code apiAt
	if status := getJSON(t, ts.URL+"/api/code?comment=1.1", &code); status != 200 {
		t.Fatalf("comment code: %d", status)
	}
	if code.Trust.Level != "shifted" || code.At != "src/prices.ts" {
		t.Fatalf("comment code = %+v", code)
	}
	var lit []int
	for _, l := range code.Lines {
		if l.In {
			lit = append(lit, l.No)
		}
	}
	if len(lit) != 2 || lit[0] != 5 || lit[1] != 6 {
		t.Fatalf("comment 1.1 in-range lines = %v, want 5-6 (shifted)", lit)
	}
	if status := getJSON(t, ts.URL+"/api/code?comment=1.2", &code); status != 200 || code.Trust.Level != "unverified" || len(code.Lines) == 0 {
		t.Fatalf("bare comment code: %d %+v", status, code)
	}
	var e map[string]any
	if status := getJSON(t, ts.URL+"/api/code?comment=1.3", &e); status != 404 {
		t.Fatalf("comment without lines: %d, want 404", status)
	}
	if status := getJSON(t, ts.URL+"/api/code?comment=9.1", &e); status != 404 {
		t.Fatalf("unknown comment: %d, want 404", status)
	}

	// a follow-up serves and shows its opener's lines
	for i := 1; i <= 3; i++ {
		if code, _, errb := run(t, ctx, "reply", plate, "--to", string(rune('0'+i)), "--text", "ok"); code != 0 {
			t.Fatal(errb)
		}
	}
	writeFile(t, plate, "review.2.json", `{"comments":[{"thread":"1.1","text":"still?"}]}`)
	getJSON(t, ts.URL+"/api/plate", &p)
	json.Unmarshal(p.Thread.Rounds[1].Comments[0], &c)
	if c.Ref == nil || c.Ref.Start != 3 || c.Ref.Trust.Level != "shifted" {
		t.Fatalf("follow-up ref = %+v, want the opener's", c.Ref)
	}
	if status := getJSON(t, ts.URL+"/api/code?comment=2.1", &code); status != 200 || len(code.Lines) == 0 {
		t.Fatalf("follow-up code: %d", status)
	}
}

func TestAPIReviewRef(t *testing.T) {
	_, plate, ts := apiFixture(t)
	var p struct {
		Thread apiLineThread `json:"thread"`
	}
	var c struct {
		Ref *apiCommentRef `json:"ref"`
	}

	// refused before anything is written
	for _, tc := range []struct{ body, code string }{
		{`{"comments":[{"target":"n1","ref":{"ref":"src/prices.ts:40-41"},"text":"x"}]}`, "ref.range.beyond-eof"},
		{`{"comments":[{"target":"n1","ref":{"ref":"src/prices.ts:3-4 @cache"},"text":"x"}]}`, "review.ref"},
		{`{"comments":[{"target":"n1","ref":{"ref":"src/prices.ts"},"text":"x"}]}`, "ref.syntax"},
	} {
		status, body := postJSON(t, ts.URL+"/api/review", tc.body)
		if status != 400 || !strings.Contains(body, tc.code) {
			t.Fatalf("%s: %d %s, want 400 %s", tc.body, status, body, tc.code)
		}
		if _, err := os.Stat(filepath.Join(plate, "review.json")); !os.IsNotExist(err) {
			t.Fatal("a refused review must not be written")
		}
	}

	// fingerprinted on the way in
	status, body := postJSON(t, ts.URL+"/api/review", `{"comments":[{"target":"n1:cache","ref":{"ref":"src/prices.ts:3-4"},"text":"hard-coded"}]}`)
	if status != 200 {
		t.Fatalf("line comment: %d %s", status, body)
	}
	raw, _ := os.ReadFile(filepath.Join(plate, "review.json"))
	var rev struct {
		Comments []struct {
			Ref protocol.NibbleRef `json:"ref"`
		} `json:"comments"`
	}
	json.Unmarshal(raw, &rev)
	if !strings.HasPrefix(rev.Comments[0].Ref.FP, "fp1:") || len(rev.Comments[0].Ref.Lines) != 2 {
		t.Fatalf("stored comment ref = %+v, want a fingerprint and two line hashes", rev.Comments[0].Ref)
	}
	getJSON(t, ts.URL+"/api/plate", &p)
	json.Unmarshal(p.Thread.Rounds[0].Comments[0], &c)
	if c.Ref == nil || c.Ref.Trust.Level != "exact" {
		t.Fatalf("posted ref trust = %+v, want exact", c.Ref)
	}

	// a follow-up may not carry lines of its own
	writeFile(t, plate, "reply.json", `{"replies":[{"to":1,"text":"one TTL for all"}]}`)
	status, body = postJSON(t, ts.URL+"/api/review", `{"comments":[{"thread":"1.1","ref":{"ref":"src/prices.ts:5"},"text":"and here?"}]}`)
	if status != 400 || !strings.Contains(body, "review.thread") {
		t.Fatalf("follow-up with ref: %d %s", status, body)
	}
	if _, err := os.Stat(filepath.Join(plate, "review.2.json")); !os.IsNotExist(err) {
		t.Fatal("a refused round must not be written")
	}

	// no root: the ref lands bare and reads unverified
	t.Run("root missing", func(t *testing.T) {
		plate, _ := degradedFixture(t)
		setPlateRepo(t, plate, filepath.Join(t.TempDir(), "gone"))
		api, err := newAPIServer(plate)
		if err != nil {
			t.Fatal(err)
		}
		ts := httptest.NewServer(api.handler())
		defer ts.Close()
		status, body := postJSON(t, ts.URL+"/api/review", `{"comments":[{"target":"n1","ref":{"ref":"src/prices.ts:3-4"},"text":"x"}]}`)
		if status != 200 {
			t.Fatalf("rootless line comment: %d %s", status, body)
		}
		raw, _ := os.ReadFile(filepath.Join(plate, "review.json"))
		if strings.Contains(string(raw), "fp1:") {
			t.Fatalf("rootless comment ref must be stored bare: %s", raw)
		}
		getJSON(t, ts.URL+"/api/plate", &p)
		json.Unmarshal(p.Thread.Rounds[0].Comments[0], &c)
		if c.Ref == nil || c.Ref.Trust.Level != "unverified" {
			t.Fatalf("rootless ref = %+v, want unverified", c.Ref)
		}
	})
}
