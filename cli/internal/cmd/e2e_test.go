package cmd

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gianfrancodemarco/nibble/cli/internal/protocol"
)

const testTimeline = `{"kind":"timeline","title":"expiries on the hour","lanes":[{"id":"cache","label":"cache"},{"id":"db","label":"db"}],"states":[{"name":"jitter-off","default":true,"events":[{"id":"spike","lane":"db","at":"12:00:00","label":"41 misses","weight":847}]},{"name":"jitter-on","events":[{"lane":"db","at":"12:00:00","label":"75 qps","weight":75}]}]}`

const testCompare = `{"kind":"compare","title":"ttl today vs jitter","before":{"label":"today","content":{"ref":"src/prices.ts:3"}},"after":{"label":"jitter","content":{"ref":"diff:src/prices.ts@main..feat#head:3"}}}`

// TestEndToEnd drives the full loop the way an agent would: new → add ×3
// (one per remaining visual kind, one over budget with a reason) → done →
// serve, with the review arriving mid-wait — then the conversation: reply,
// serve again, a follow-up round, reply, and done.
func TestEndToEnd(t *testing.T) {
	repo := gitInit(t)
	tmp := t.TempDir()
	mapV := writeFile(t, tmp, "map.json", testMap)
	tlV := writeFile(t, tmp, "timeline.json", testTimeline)
	cmpV := writeFile(t, tmp, "compare.json", testCompare)

	ctx, plate := newTestPlate(t, repo)

	steps := [][]string{
		{"add", plate, "--title", "One `getPrice` call touches the **cache** first.",
			"--visual", mapV, "--ref", "src/prices.ts:3-4 @cache the ttl lines"},
		{"add", plate, "--title", "Every key expires **on the hour**.",
			"--visual", tlV, "--ref", "src/pool.ts:1 @db pool size"},
		{"add", plate, "--title", strings.Repeat("why ", 41),
			"--visual", cmpV, "--ref", "diff:src/prices.ts@worktree:3",
			"--because", "the before/after needs the full story"},
		{"done", plate},
	}
	for _, s := range steps {
		if code, _, errb := run(t, ctx, s...); code != 0 {
			t.Fatalf("%v: %s", s[:2], errb)
		}
	}

	// The review arrives the way it will in real life: through the reader.
	url, stdout, codeCh := startServe(t, ctx, plate)
	resp, err := http.Post(url+"/api/review", "application/json",
		strings.NewReader(reviewComments))
	if err != nil || resp.StatusCode != 200 {
		t.Fatalf("POST review: %v %v", err, resp)
	}
	resp.Body.Close()
	var code int
	select {
	case code = <-codeCh:
	case <-time.After(2 * time.Second):
		t.Fatal("serve did not exit after the posted review")
	}
	if code != 2 || !strings.Contains(stdout.String(), "n2:cache") {
		t.Fatalf("serve: exit %d out %q", code, stdout.String())
	}

	// The agent answers on the plate, serves again, and the reader follows
	// up in the same thread; the agent answers that too, and the reader is
	// done.
	if code, _, errb := run(t, ctx, "reply", plate, "--to", "1",
		"--text", "Billing reads through the same [db](@db) pool, so the lines below are the ones it sees.",
		"--ref", "src/pool.ts:1-2 the pool and its idle timeout"); code != 0 {
		t.Fatalf("reply: %s", errb)
	}
	url, stdout, codeCh = startServe(t, ctx, plate)
	// Round 2: a follow-up in the thread, and a comment on one line the
	// reader selected in the drawer (the API fingerprints its ref).
	resp, err = http.Post(url+"/api/review", "application/json",
		strings.NewReader(`{"comments":[{"thread":"1.1","text":"then is the pool size enough for billing too?"},`+
			`{"target":"n2:cache","ref":{"ref":"src/pool.ts:2"},"text":"is a 30s idle timeout right for billing's bursts?"}]}`))
	if err != nil || resp.StatusCode != 200 {
		t.Fatalf("POST round 2: %v %v", err, resp)
	}
	resp.Body.Close()
	select {
	case code = <-codeCh:
	case <-time.After(2 * time.Second):
		t.Fatal("serve did not exit after round 2")
	}
	if code != 2 || !strings.Contains(stdout.String(), "continues 1.1") || !strings.Contains(stdout.String(), "agent · round 1") {
		t.Fatalf("serve round 2: exit %d out %q", code, stdout.String())
	}
	if out := stdout.String(); !strings.Contains(out, "n2:cache · src/pool.ts:2 · 2.2") || !strings.Contains(out, "2  idle = 30") {
		t.Fatalf("serve round 2 should print the line comment's location and quote its line: %q", out)
	}
	if code, _, errb := run(t, ctx, "reply", plate, "--to", "1",
		"--text", "It is sized for both: billing's reads are hits once the cache is warm."); code != 0 {
		t.Fatalf("reply 2: %s", errb)
	}
	if code, _, errb := run(t, ctx, "reply", plate, "--to", "2",
		"--text", "Yes: billing's longest burst is under ten seconds, so an idle connection outlives it.",
		"--ref", "src/pool.ts:2 the idle timeout"); code != 0 {
		t.Fatalf("reply to the line comment: %s", errb)
	}
	url, _, codeCh = startServe(t, ctx, plate)
	if resp, err = http.Post(url+"/api/review", "application/json", strings.NewReader(`{"comments":[]}`)); err != nil || resp.StatusCode != 200 {
		t.Fatalf("POST done: %v %v", err, resp)
	}
	resp.Body.Close()
	select {
	case code = <-codeCh:
	case <-time.After(2 * time.Second):
		t.Fatal("serve did not exit after done")
	}
	if code != 0 {
		t.Fatalf("done should exit 0, got %d", code)
	}

	p, err := protocol.ParsePlate(plate)
	if err != nil || len(p.Nibbles) != 3 || p.Open || len(p.Rounds) != 3 || p.Turn() != protocol.TurnReader {
		t.Fatalf("final plate: %+v err %v", p, err)
	}
	if ths := p.Threads(); len(ths) != 2 || len(ths[0].Messages) != 4 || len(ths[1].Messages) != 2 {
		t.Fatalf("threads = %+v", p.Threads())
	}
	if r := p.Rounds[1].Ref(2); r == nil || !strings.HasPrefix(r.FP, "fp1:") {
		t.Fatalf("the posted line comment should carry a fingerprint, got %+v", r)
	}
	if p.Nibbles[2].Because == "" {
		t.Fatal("because missing on the over-budget nibble")
	}

	// Export a sanitized copy as the golden fixture when asked
	// (go test -run TestEndToEnd with NIBBLE_EXPORT_GOLDEN=<dir>).
	if dest := os.Getenv("NIBBLE_EXPORT_GOLDEN"); dest != "" {
		exportGolden(t, plate, dest)
	}
}

func exportGolden(t *testing.T, plate, dest string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Join(dest, "plate"), 0o755); err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(plate)
	if err != nil {
		t.Fatal(err)
	}
	var realRepo string
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), ".") {
			continue // .serve.json and friends: the protocol ignores them, the fixture must not carry them
		}
		raw, err := os.ReadFile(filepath.Join(plate, e.Name()))
		if err != nil {
			t.Fatal(err)
		}
		if e.Name() == "plate.json" { // strip machine-specific fields
			var h map[string]any
			if err := json.Unmarshal(raw, &h); err != nil {
				t.Fatal(err)
			}
			realRepo, _ = h["repo"].(string)
			// Relative root: the fixture bundles a snapshot of its files,
			// so it serves (and computes trust) straight from the checkout.
			h["repo"] = "../repo"
			h["head_sha"] = "4f2a91c"
			h["created_at"] = "2026-11-01T12:00:00Z"
			raw, _ = json.MarshalIndent(h, "", "  ")
			raw = append(raw, '\n')
		}
		if err := os.WriteFile(filepath.Join(dest, "plate", e.Name()), raw, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if realRepo == "" {
		t.Fatal("plate.json had no repo to snapshot")
	}
	copyTree(t, realRepo, filepath.Join(dest, "repo"))
	expected := []byte("{ \"valid\": true, \"nibbles\": 3, \"open\": false, \"turn\": \"reader\", \"rounds\": 3, \"threads\": 2 }\n")
	if err := os.WriteFile(filepath.Join(dest, "expected.json"), expected, 0o644); err != nil {
		t.Fatal(err)
	}
}

// TestEndToEndLedgerLoop drives the review-coverage loop the skill teaches:
// build a worktree plate, `done --check` reports what was missed, cover it,
// seal — the ledger discloses only what stayed unshown.
func TestEndToEndLedgerLoop(t *testing.T) {
	repo := gitInit(t) // uncommitted edit on src/pool.ts line 1
	writeFile(t, repo, "CHANGES.md", "intro\nthe pool doubled\n")
	tmp := t.TempDir()
	mapV := writeFile(t, tmp, "map.json", testMap)

	ctx, plate := newTestPlate(t, repo, "--about", "worktree")
	if code, _, errb := run(t, ctx, "add", plate, "--title", "The pool doubles.",
		"--visual", mapV, "--ref", "diff:src/pool.ts@worktree:1 @db the pool size"); code != 0 {
		t.Fatal(errb)
	}

	// The check names the uncovered hunk (the untracked changelog)…
	code, out, _ := run(t, ctx, "done", plate, "--check", "--json")
	if code != 0 {
		t.Fatalf("check: exit %d", code)
	}
	var checked struct {
		Ledger protocol.Ledger `json:"ledger"`
	}
	if err := json.Unmarshal([]byte(out), &checked); err != nil {
		t.Fatal(err)
	}
	var unshown []protocol.LedgerHunk
	for _, h := range checked.Ledger.Hunks {
		if !h.Covered {
			unshown = append(unshown, h)
		}
	}
	if len(unshown) != 1 || unshown[0].Path != "CHANGES.md" {
		t.Fatalf("check ledger = %+v", checked.Ledger)
	}

	// …the agent covers it and seals: the hunk is gone from the ledger.
	if code, _, errb := run(t, ctx, "add", plate, "--title", "And the changelog says so.",
		"--visual", mapV, "--ref", "CHANGES.md:2 @cache the changelog line"); code != 0 {
		t.Fatal(errb)
	}
	if code, _, errb := run(t, ctx, "done", plate); code != 0 {
		t.Fatal(errb)
	}
	p, err := protocol.ParsePlate(plate)
	if err != nil || p.Open || p.Ledger == nil {
		t.Fatalf("sealed plate: %+v err %v", p, err)
	}
	if p.Ledger.Shown != p.Ledger.Total || p.Ledger.Total != 2 || len(p.Ledger.Hunks) != 2 {
		t.Fatalf("sealed ledger = %+v", p.Ledger)
	}
}
