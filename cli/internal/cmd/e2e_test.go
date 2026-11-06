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

// TestEndToEnd drives the full authoring loop the way an agent would:
// new → add ×3 (one per remaining visual kind, one over budget with a reason)
// → done → serve, with the review arriving mid-wait.
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

	p, err := protocol.ParsePlate(plate)
	if err != nil || len(p.Nibbles) != 3 || p.Open || p.Review == nil {
		t.Fatalf("final plate: %+v err %v", p, err)
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
	expected := []byte("{ \"valid\": true, \"nibbles\": 3, \"open\": false }\n")
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
