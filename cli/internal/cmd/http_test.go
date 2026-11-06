package cmd

import (
	"bufio"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// apiPlate builds a plate with three refs — a worktree-trusted plain ref, a
// committed diff-side ref, and a plain ref we will invalidate — and returns
// a test server over it.
func apiFixture(t *testing.T) (repo, plate string, ts *httptest.Server) {
	t.Helper()
	repo = gitInit(t)
	visual := writeFile(t, t.TempDir(), "map.json", testMap)
	ctx := Ctx{Dir: repo, Home: t.TempDir()}
	code, out, errb := run(t, ctx, "new", "--title", "t",
		"--description", "the gist", "--description-standard", "the full story")
	if code != 0 {
		t.Fatalf("new failed: %s", errb)
	}
	plate = strings.TrimSpace(out)

	adds := [][]string{
		{"add", plate, "--title", "The **cache** sets the TTL.",
			"--description", "skim text", "--description-standard", "standard text",
			"--visual", visual, "--ref", "src/prices.ts:3-4 @cache the ttl lines"},
		{"add", plate, "--title", "The pool was doubled on `main`.",
			"--visual", visual,
			"--ref", "diff:src/pool.ts@main..feat#head:1",
			"--ref", "src/pool.ts:2 @db idle timeout"},
	}
	for _, a := range adds {
		if code, _, errb := run(t, ctx, a...); code != 0 {
			t.Fatalf("%v: %s", a[:2], errb)
		}
	}

	api, err := newAPIServer(plate)
	if err != nil {
		t.Fatalf("newAPIServer: %v", err)
	}
	ts = httptest.NewServer(api.handler())
	t.Cleanup(ts.Close)
	return repo, plate, ts
}

func getJSON(t *testing.T, url string, into any) int {
	t.Helper()
	resp, err := http.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if err := json.NewDecoder(resp.Body).Decode(into); err != nil {
		t.Fatalf("decode %s: %v", url, err)
	}
	return resp.StatusCode
}

type apiDescription struct {
	Overview string `json:"overview"`
	Standard string `json:"standard"`
}

type apiPlate struct {
	Title       string          `json:"title"`
	Description *apiDescription `json:"description"`
	Open        bool            `json:"open"`
	Total       int             `json:"total"`
	Review      *map[string]any `json:"review"`
	Nibbles     []struct {
		N           int             `json:"n"`
		Title       string          `json:"title"`
		Description *apiDescription `json:"description"`
		Visual      json.RawMessage `json:"visual"`
		Refs    []struct {
			Ref    string   `json:"ref"`
			Path   string   `json:"path"`
			Start  int      `json:"start"`
			End    int      `json:"end"`
			Anchor string   `json:"anchor"`
			Trust  apiTrust `json:"trust"`
		} `json:"refs"`
	} `json:"nibbles"`
}

func TestAPIPlate(t *testing.T) {
	repo, _, ts := apiFixture(t)

	var p apiPlate
	if code := getJSON(t, ts.URL+"/api/plate", &p); code != 200 {
		t.Fatalf("status = %d", code)
	}
	if p.Title != "t" || !p.Open || len(p.Nibbles) != 2 {
		t.Fatalf("plate = %+v", p)
	}
	if p.Description == nil || p.Description.Overview != "the gist" || p.Description.Standard != "the full story" {
		t.Fatalf("plate description = %+v", p.Description)
	}
	n1, n2 := p.Nibbles[0], p.Nibbles[1]
	if n1.Description == nil || n1.Description.Overview != "skim text" || n1.Description.Standard != "standard text" {
		t.Fatalf("n1 description = %+v", n1.Description)
	}
	if n2.Description != nil {
		t.Fatalf("n2 should carry no description: %+v", n2.Description)
	}
	if n1.N != 1 || n1.Refs[0].Path != "src/prices.ts" || n1.Refs[0].Start != 3 ||
		n1.Refs[0].End != 4 || n1.Refs[0].Anchor != "cache" {
		t.Fatalf("n1 ref = %+v", n1.Refs[0])
	}
	for _, r := range append(n1.Refs, n2.Refs...) {
		if r.Trust.Level != "exact" {
			t.Fatalf("ref %q trust = %+v, want exact", r.Ref, r.Trust)
		}
	}
	if len(n1.Visual) == 0 || !strings.Contains(string(n1.Visual), `"map"`) {
		t.Fatalf("visual missing: %s", n1.Visual)
	}

	// Rewrite the TTL lines: n1's ref goes stale, n2's refs stay exact.
	path := filepath.Join(repo, "src/prices.ts")
	if err := os.WriteFile(path, []byte("a\nb\nrewritten\nentirely\ne\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if getJSON(t, ts.URL+"/api/plate", &p); p.Nibbles[0].Refs[0].Trust.Level != "stale" {
		t.Fatalf("after rewrite: %+v", p.Nibbles[0].Refs[0].Trust)
	}
	if p.Nibbles[1].Refs[0].Trust.Level != "exact" || p.Nibbles[1].Refs[1].Trust.Level != "exact" {
		t.Fatalf("n2 refs should stay exact: %+v", p.Nibbles[1].Refs)
	}

	// Shift: two lines inserted above the pool's idle line.
	pool := filepath.Join(repo, "src/pool.ts")
	if err := os.WriteFile(pool, []byte("// hdr\n// hdr2\npool = 40\nidle = 30\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	getJSON(t, ts.URL+"/api/plate", &p)
	tr := p.Nibbles[1].Refs[1].Trust
	if tr.Level != "shifted" || tr.Shift != 2 || tr.Line != 4 {
		t.Fatalf("idle ref trust = %+v, want shifted +2 line 4", tr)
	}
}

type apiCode struct {
	Ref     string   `json:"ref"`
	Path    string   `json:"path"`
	Missing bool     `json:"missing"`
	Trust   apiTrust `json:"trust"`
	Lines   []struct {
		No   int    `json:"no"`
		Text string `json:"text"`
		In   bool   `json:"in"`
	} `json:"lines"`
}

func TestAPICode(t *testing.T) {
	_, _, ts := apiFixture(t)

	var c apiCode
	if code := getJSON(t, ts.URL+"/api/code?n=1&ref=0", &c); code != 200 {
		t.Fatalf("status = %d", code)
	}
	// prices.ts has 5 lines; range 3-4 with 3 context each side clamps to 1-5.
	if c.Path != "src/prices.ts" || len(c.Lines) != 5 || c.Lines[0].No != 1 {
		t.Fatalf("code = %+v", c)
	}
	for _, l := range c.Lines {
		want := l.No == 3 || l.No == 4
		if l.In != want {
			t.Fatalf("line %d in=%v want %v", l.No, l.In, want)
		}
	}
	if !strings.Contains(c.Lines[2].Text, "ttl") {
		t.Fatalf("line 3 = %q", c.Lines[2].Text)
	}

	// Diff-side ref: content comes from git, not the worktree.
	getJSON(t, ts.URL+"/api/code?n=2&ref=0", &c)
	if len(c.Lines) == 0 || !strings.Contains(c.Lines[0].Text, "pool = 20") {
		t.Fatalf("diff side = %+v", c)
	}

	var e struct {
		Error struct{ Code string } `json:"error"`
	}
	if code := getJSON(t, ts.URL+"/api/code?n=9&ref=0", &e); code != 404 {
		t.Fatalf("unknown nibble: status %d", code)
	}
	if code := getJSON(t, ts.URL+"/api/code?n=1&ref=5", &e); code != 404 {
		t.Fatalf("unknown ref: status %d", code)
	}
}

func postJSON(t *testing.T, url, body string) (int, string) {
	t.Helper()
	resp, err := http.Post(url, "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var b strings.Builder
	sc := bufio.NewScanner(resp.Body)
	for sc.Scan() {
		b.WriteString(sc.Text())
	}
	return resp.StatusCode, b.String()
}

func TestAPIReview(t *testing.T) {
	_, plate, ts := apiFixture(t)

	code, body := postJSON(t, ts.URL+"/api/review",
		`{"comments":[{"target":"n1"}]}`)
	if code != 400 || !strings.Contains(body, "review.malformed") {
		t.Fatalf("bad review: %d %s", code, body)
	}
	if _, err := os.Stat(filepath.Join(plate, "review.json")); !os.IsNotExist(err) {
		t.Fatal("rejected review must not be written")
	}

	first := `{"comments":[{"target":"n1","text":"what about billing?"}]}`
	if code, body = postJSON(t, ts.URL+"/api/review", first); code != 200 {
		t.Fatalf("review: %d %s", code, body)
	}
	raw, err := os.ReadFile(filepath.Join(plate, "review.json"))
	if err != nil || !strings.Contains(string(raw), "billing") {
		t.Fatalf("review.json = %q err %v", raw, err)
	}

	code, body = postJSON(t, ts.URL+"/api/review", `{"comments":[]}`)
	if code != 409 || !strings.Contains(body, "review.exists") {
		t.Fatalf("second review: %d %s", code, body)
	}
	raw2, _ := os.ReadFile(filepath.Join(plate, "review.json"))
	if string(raw2) != string(raw) {
		t.Fatal("second review must not overwrite the first")
	}
}

// sseEvents connects to /api/events and forwards parsed events on a channel.
func sseEvents(t *testing.T, url string) <-chan string {
	t.Helper()
	resp, err := http.Get(url + "/api/events")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { resp.Body.Close() })
	if ct := resp.Header.Get("Content-Type"); !strings.HasPrefix(ct, "text/event-stream") {
		t.Fatalf("content-type = %q", ct)
	}
	ch := make(chan string, 16)
	go func() {
		sc := bufio.NewScanner(resp.Body)
		var ev string
		for sc.Scan() {
			line := sc.Text()
			if strings.HasPrefix(line, "event: ") {
				ev = strings.TrimPrefix(line, "event: ")
			}
			if strings.HasPrefix(line, "data: ") && ev != "" {
				ch <- ev + " " + strings.TrimPrefix(line, "data: ")
				ev = ""
			}
		}
	}()
	return ch
}

func waitEvent(t *testing.T, ch <-chan string, want string) {
	t.Helper()
	deadline := time.After(2 * time.Second)
	for {
		select {
		case got := <-ch:
			if strings.Contains(got, want) {
				return
			}
		case <-deadline:
			t.Fatalf("no %q event within 2s", want)
		}
	}
}

func TestAPIEvents(t *testing.T) {
	repo, plate, ts := apiFixture(t)
	ch := sseEvents(t, ts.URL)

	// A third nibble lands while a client is connected.
	visual := writeFile(t, t.TempDir(), "map.json", testMap)
	ctx := Ctx{Dir: repo, Home: filepath.Dir(filepath.Dir(plate))}
	if code, _, errb := run(t, ctx, "add", plate, "--title", "c3", "--visual", visual); code != 0 {
		t.Fatal(errb)
	}
	waitEvent(t, ch, `nibble {"n":3}`)

	if code, _, errb := run(t, ctx, "done", plate); code != 0 {
		t.Fatal(errb)
	}
	waitEvent(t, ch, `sealed {"total":3}`)

	writeFile(t, plate, "review.json", reviewDone)
	waitEvent(t, ch, `review {"comments":0}`)
}

func TestAPIStaticUI(t *testing.T) {
	_, _, ts := apiFixture(t)
	for path, want := range map[string]string{
		"/":          "id=\"canvas\"",
		"/app.js":    "api/plate",
		"/style.css": "--",
	} {
		resp, err := http.Get(ts.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		raw := make([]byte, 1<<20)
		n, _ := resp.Body.Read(raw)
		for n < len(raw) {
			m, err := resp.Body.Read(raw[n:])
			n += m
			if err != nil {
				break
			}
		}
		resp.Body.Close()
		if resp.StatusCode != 200 || !strings.Contains(string(raw[:n]), want) {
			t.Fatalf("%s: status %d, want body containing %q", path, resp.StatusCode, want)
		}
	}
}

// setPlateRepo rewrites the plate header's repo field.
func setPlateRepo(t *testing.T, plate, repo string) {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(plate, "plate.json"))
	if err != nil {
		t.Fatal(err)
	}
	var h map[string]any
	if err := json.Unmarshal(raw, &h); err != nil {
		t.Fatal(err)
	}
	h["repo"] = repo
	out, _ := json.Marshal(h)
	if err := os.WriteFile(filepath.Join(plate, "plate.json"), out, 0o644); err != nil {
		t.Fatal(err)
	}
}

// copyTree copies src into dst, skipping .git.
func copyTree(t *testing.T, src, dst string) {
	t.Helper()
	err := filepath.WalkDir(src, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(src, p)
		if rel == ".git" || strings.HasPrefix(rel, ".git"+string(filepath.Separator)) {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if d.IsDir() {
			return os.MkdirAll(filepath.Join(dst, rel), 0o755)
		}
		raw, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		return os.WriteFile(filepath.Join(dst, rel), raw, 0o644)
	})
	if err != nil {
		t.Fatal(err)
	}
}

// degradedFixture authors a plate in a real repo, then detaches it: the
// files are copied to a plain directory and the plate re-pointed there.
func degradedFixture(t *testing.T) (plate, root string) {
	repo := gitInit(t)
	visual := writeFile(t, t.TempDir(), "map.json", testMap)
	ctx, plate := newTestPlate(t, repo)
	adds := [][]string{
		{"add", plate, "--title", "plain", "--visual", visual,
			"--ref", "src/prices.ts:3-4 @cache"},
		{"add", plate, "--title", "needs git", "--visual", visual,
			"--ref", "diff:src/pool.ts@main..feat#head:1",
			"--ref", "diff:src/prices.ts@worktree:3 @db"},
	}
	for _, a := range adds {
		if code, _, errb := run(t, ctx, a...); code != 0 {
			t.Fatalf("%v: %s", a[:2], errb)
		}
	}
	root = t.TempDir()
	copyTree(t, repo, root)
	setPlateRepo(t, plate, root)
	return plate, root
}

func TestAPIDegraded(t *testing.T) {
	t.Run("files without git", func(t *testing.T) {
		plate, _ := degradedFixture(t)
		api, err := newAPIServer(plate)
		if err != nil {
			t.Fatal(err)
		}
		ts := httptest.NewServer(api.handler())
		defer ts.Close()

		var p apiPlate
		getJSON(t, ts.URL+"/api/plate", &p)
		if got := p.Nibbles[0].Refs[0].Trust.Level; got != "exact" {
			t.Fatalf("plain ref = %q, want exact", got)
		}
		if got := p.Nibbles[1].Refs[0].Trust.Level; got != "unverified" {
			t.Fatalf("base..head ref = %q, want unverified", got)
		}
		if got := p.Nibbles[1].Refs[1].Trust.Level; got != "exact" {
			t.Fatalf("worktree ref = %q, want exact", got)
		}

		// Drawer: plain ref has code; base..head ref has a reason instead.
		var c apiCode
		getJSON(t, ts.URL+"/api/code?n=1&ref=0", &c)
		if len(c.Lines) == 0 || !strings.Contains(c.Lines[2].Text, "ttl") {
			t.Fatalf("plain drawer = %+v", c)
		}
		var cw struct {
			Why   string `json:"why"`
			Lines []any  `json:"lines"`
		}
		getJSON(t, ts.URL+"/api/code?n=2&ref=0", &cw)
		if cw.Why == "" || len(cw.Lines) != 0 {
			t.Fatalf("unverifiable drawer = %+v, want a why and no lines", cw)
		}
	})

	t.Run("root missing", func(t *testing.T) {
		plate, _ := degradedFixture(t)
		setPlateRepo(t, plate, filepath.Join(t.TempDir(), "gone"))
		api, err := newAPIServer(plate)
		if err != nil {
			t.Fatal(err)
		}
		ts := httptest.NewServer(api.handler())
		defer ts.Close()

		var p apiPlate
		getJSON(t, ts.URL+"/api/plate", &p)
		for _, nb := range p.Nibbles {
			for _, r := range nb.Refs {
				if r.Trust.Level != "unverified" {
					t.Fatalf("ref %q = %q, want unverified", r.Ref, r.Trust.Level)
				}
			}
		}
		// The review loop does not need the root at all.
		if code, _ := postJSON(t, ts.URL+"/api/review", `{"comments":[]}`); code != 200 {
			t.Fatalf("review on rootless plate: %d", code)
		}
	})

	t.Run("relative root", func(t *testing.T) {
		plate, root := degradedFixture(t)
		// Move the snapshot to a sibling of the plate dir and point at it
		// relatively: <parent>/{<plate>, repo}.
		sib := filepath.Join(filepath.Dir(plate), "repo")
		copyTree(t, root, sib)
		setPlateRepo(t, plate, filepath.Join("..", "repo"))
		api, err := newAPIServer(plate)
		if err != nil {
			t.Fatal(err)
		}
		ts := httptest.NewServer(api.handler())
		defer ts.Close()
		var p apiPlate
		getJSON(t, ts.URL+"/api/plate", &p)
		if got := p.Nibbles[0].Refs[0].Trust.Level; got != "exact" {
			t.Fatalf("plain ref via relative root = %q, want exact", got)
		}
	})
}

// TestGoldenPlateServes pins the committed fixture: the cli-authored plate
// must serve straight from the checkout, trust computed from its bundled
// file snapshot.
func TestGoldenPlateServes(t *testing.T) {
	plate := filepath.Join("..", "..", "..", "protocol", "golden", "plates", "cli-authored", "plate")
	if _, err := os.Stat(plate); err != nil {
		t.Fatal(err)
	}
	api, err := newAPIServer(plate)
	if err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer(api.handler())
	defer ts.Close()
	var p apiPlate
	getJSON(t, ts.URL+"/api/plate", &p)
	if len(p.Nibbles) != 3 {
		t.Fatalf("nibbles = %d", len(p.Nibbles))
	}
	for _, nb := range p.Nibbles {
		for _, r := range nb.Refs {
			if r.Trust.Level != "exact" {
				t.Errorf("golden ref %q trust = %q, want exact", r.Ref, r.Trust.Level)
			}
		}
	}
}

// ledgeredFixture builds a sealed worktree plate whose ledger holds two
// uncovered hunks: a pure deletion in src/prices.ts (base side) and an
// untracked note.txt (head side); the src/pool.ts edit is covered.
func ledgeredFixture(t *testing.T) (repo, plate string) {
	t.Helper()
	repo = gitInit(t) // uncommitted edit on src/pool.ts line 1
	writeFile(t, repo, "src/prices.ts", "a\nb\nttl: 3600\ncache.set()\n") // line 5 ("e") deleted
	writeFile(t, repo, "note.txt", "todo\nnote two\n")
	visual := writeFile(t, t.TempDir(), "map.json", testMap)
	ctx := Ctx{Dir: repo, Home: t.TempDir()}
	code, out, errb := run(t, ctx, "new", "--title", "t", "--about", "worktree")
	if code != 0 {
		t.Fatalf("new: %s", errb)
	}
	plate = strings.TrimSpace(out)
	if code, _, errb := run(t, ctx, "add", plate, "--title", "c", "--visual", visual,
		"--ref", "src/pool.ts:1 @cache the pool"); code != 0 {
		t.Fatalf("add: %s", errb)
	}
	if code, _, errb := run(t, ctx, "done", plate); code != 0 {
		t.Fatalf("done: %s", errb)
	}
	return repo, plate
}

type apiLedger struct {
	Shown int `json:"shown"`
	Total int `json:"total"`
	Hunks []struct {
		Path    string `json:"path"`
		Side    string `json:"side"`
		Start   int    `json:"start"`
		End     int    `json:"end"`
		Added   int    `json:"added"`
		Removed int    `json:"removed"`
		Covered bool   `json:"covered"`
	} `json:"hunks"`
}

func TestAPILedger(t *testing.T) {
	_, plate := ledgeredFixture(t)
	api, err := newAPIServer(plate)
	if err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer(api.handler())
	defer ts.Close()

	// /api/plate carries the ledger.
	var p struct {
		Ledger *apiLedger `json:"ledger"`
	}
	getJSON(t, ts.URL+"/api/plate", &p)
	if p.Ledger == nil || p.Ledger.Shown != 1 || p.Ledger.Total != 3 || len(p.Ledger.Hunks) != 3 {
		t.Fatalf("plate ledger = %+v", p.Ledger)
	}
	if h := p.Ledger.Hunks[0]; h.Path != "src/pool.ts" || !h.Covered {
		t.Fatalf("hunk 0 = %+v", h)
	}
	if h := p.Ledger.Hunks[1]; h.Path != "src/prices.ts" || h.Side != "base" || h.Start != 5 || h.End != 5 || h.Covered {
		t.Fatalf("hunk 1 = %+v", h)
	}
	if h := p.Ledger.Hunks[2]; h.Path != "note.txt" || h.Side != "head" || h.Start != 1 || h.End != 2 || h.Covered {
		t.Fatalf("hunk 2 = %+v", h)
	}

	// A base-side file serves the removed line from the recorded base rev.
	var c apiCode
	if status := getJSON(t, ts.URL+"/api/ledger?file=src/prices.ts&side=base", &c); status != 200 {
		t.Fatalf("ledger prices.ts base: %d", status)
	}
	if c.Path != "src/prices.ts" || len(c.Lines) == 0 {
		t.Fatalf("prices.ts drawer = %+v", c)
	}
	var inText []string
	for _, l := range c.Lines {
		if l.In {
			inText = append(inText, l.Text)
		}
	}
	if len(inText) != 1 || inText[0] != "e" {
		t.Fatalf("prices.ts in-range lines = %v, want the deleted \"e\"", inText)
	}

	// A head-side file serves from the worktree; side defaults to head.
	if status := getJSON(t, ts.URL+"/api/ledger?file=note.txt", &c); status != 200 {
		t.Fatalf("ledger note.txt: %d", status)
	}
	if c.Path != "note.txt" || len(c.Lines) != 2 || !c.Lines[0].In || c.Lines[0].Text != "todo" {
		t.Fatalf("note.txt drawer = %+v", c)
	}

	// A fully covered file still serves, with nothing marked in-range.
	if status := getJSON(t, ts.URL+"/api/ledger?file=src/pool.ts", &c); status != 200 {
		t.Fatalf("covered file: %d, want 200", status)
	}
	if len(c.Lines) == 0 {
		t.Fatalf("covered file served no lines: %+v", c)
	}
	for _, l := range c.Lines {
		if l.In {
			t.Fatalf("covered file has an in-range line: %+v", c.Lines)
		}
	}

	// A file the ledger has no hunks for, or a side it has none on → 404.
	var e map[string]any
	if status := getJSON(t, ts.URL+"/api/ledger?file=unrelated.ts", &e); status != 404 {
		t.Fatalf("unknown file: %d, want 404", status)
	}
	if status := getJSON(t, ts.URL+"/api/ledger?file=note.txt&side=base", &e); status != 404 {
		t.Fatalf("wrong side: %d, want 404", status)
	}
	if status := getJSON(t, ts.URL+"/api/ledger?file=note.txt&side=up", &e); status != 404 {
		t.Fatalf("unknown side: %d, want 404", status)
	}
}

// TestAPILedgerFileSegments: a file with two distant uncovered hunks is one
// ledger entry whose code view holds both hunks' segments, hunk lines marked,
// with the stretch between them left out.
func TestAPILedgerFileSegments(t *testing.T) {
	repo := gitInit(t)
	git := func(args ...string) {
		t.Helper()
		cmd := exec.Command("git", append([]string{"-C", repo}, args...)...)
		cmd.Env = append(os.Environ(),
			"GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@t",
			"GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@t")
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	long := make([]string, 25)
	for i := range long {
		long[i] = fmt.Sprintf("line %d", i+1)
	}
	writeFile(t, repo, "src/long.ts", strings.Join(long, "\n")+"\n")
	git("add", "src/long.ts")
	git("commit", "-q", "-m", "long")
	long[1] = "line 2 changed"
	long[19] = "line 20 changed"
	writeFile(t, repo, "src/long.ts", strings.Join(long, "\n")+"\n")

	visual := writeFile(t, t.TempDir(), "map.json", testMap)
	ctx := Ctx{Dir: repo, Home: t.TempDir()}
	code, out, errb := run(t, ctx, "new", "--title", "t", "--about", "worktree")
	if code != 0 {
		t.Fatalf("new: %s", errb)
	}
	plate := strings.TrimSpace(out)
	if code, _, errb := run(t, ctx, "add", plate, "--title", "c", "--visual", visual,
		"--ref", "src/pool.ts:1 @cache the pool"); code != 0 {
		t.Fatalf("add: %s", errb)
	}
	if code, _, errb := run(t, ctx, "done", plate); code != 0 {
		t.Fatalf("done: %s", errb)
	}

	api, err := newAPIServer(plate)
	if err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer(api.handler())
	defer ts.Close()

	var c apiCode
	if status := getJSON(t, ts.URL+"/api/ledger?file=src/long.ts", &c); status != 200 {
		t.Fatalf("ledger long.ts: %d", status)
	}
	var nos []int
	var inNos []int
	for _, l := range c.Lines {
		nos = append(nos, l.No)
		if l.In {
			inNos = append(inNos, l.No)
		}
	}
	want := []int{1, 2, 3, 4, 5, 17, 18, 19, 20, 21, 22, 23}
	if fmt.Sprint(nos) != fmt.Sprint(want) {
		t.Fatalf("segment lines = %v, want %v", nos, want)
	}
	if fmt.Sprint(inNos) != fmt.Sprint([]int{2, 20}) {
		t.Fatalf("in-range lines = %v, want [2 20]", inNos)
	}
}

func TestAPILedgerAbsent(t *testing.T) {
	_, _, ts := apiFixture(t) // a code plate: no ledger at all
	var p struct {
		Ledger *apiLedger `json:"ledger"`
	}
	getJSON(t, ts.URL+"/api/plate", &p)
	if p.Ledger != nil {
		t.Fatalf("code plate serves a ledger: %+v", p.Ledger)
	}
	var e map[string]any
	if status := getJSON(t, ts.URL+"/api/ledger?file=note.txt", &e); status != 404 {
		t.Fatalf("ledger endpoint without a ledger: %d, want 404", status)
	}
}

func TestAPILedgerDegraded(t *testing.T) {
	// Detach the plate from git: a plain directory serves head-side hunks
	// from the files and answers base-side hunks with a reason.
	repo, plate := ledgeredFixture(t)
	snap := filepath.Join(filepath.Dir(plate), "snapshot")
	copyTree(t, repo, snap)
	if err := os.RemoveAll(filepath.Join(snap, ".git")); err != nil {
		t.Fatal(err)
	}
	setPlateRepo(t, plate, snap)
	api, err := newAPIServer(plate)
	if err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer(api.handler())
	defer ts.Close()

	var cw struct {
		Why   string `json:"why"`
		Lines []any  `json:"lines"`
	}
	if status := getJSON(t, ts.URL+"/api/ledger?file=src/prices.ts&side=base", &cw); status != 200 {
		t.Fatalf("base file without git: %d", status)
	}
	if cw.Why == "" || len(cw.Lines) != 0 {
		t.Fatalf("base file without git = %+v, want a why and no lines", cw)
	}
	var c apiCode
	getJSON(t, ts.URL+"/api/ledger?file=note.txt", &c)
	if len(c.Lines) != 2 || c.Lines[0].Text != "todo" {
		t.Fatalf("head file from plain files = %+v", c)
	}
}
