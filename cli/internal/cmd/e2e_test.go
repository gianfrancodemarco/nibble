package cmd

import (
	"encoding/json"
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
		{"add", plate, "--caption", "One `getPrice` call touches the **cache** first.",
			"--visual", mapV, "--ref", "src/prices.ts:3-4 @cache the ttl lines"},
		{"add", plate, "--caption", "Every key expires **on the hour**.",
			"--visual", tlV, "--ref", "src/pool.ts:1 @db pool size"},
		{"add", plate, "--caption", strings.Repeat("why ", 41),
			"--visual", cmpV, "--ref", "diff:src/prices.ts@worktree:3",
			"--because", "the before/after needs the full story"},
		{"done", plate},
	}
	for _, s := range steps {
		if code, _, errb := run(t, ctx, s...); code != 0 {
			t.Fatalf("%v: %s", s[:2], errb)
		}
	}

	go func() {
		time.Sleep(300 * time.Millisecond)
		os.WriteFile(filepath.Join(plate, "review.json"),
			[]byte(review("changes")), 0o644)
	}()
	code, out, _ := run(t, ctx, "serve", plate)
	if code != 2 || !strings.Contains(out, "verdict: changes") {
		t.Fatalf("serve: exit %d out %q", code, out)
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
			h["repo"] = "/work/shop"
			h["head_sha"] = "4f2a91c"
			h["created_at"] = "2026-11-01T12:00:00Z"
			raw, _ = json.MarshalIndent(h, "", "  ")
			raw = append(raw, '\n')
		}
		if err := os.WriteFile(filepath.Join(dest, "plate", e.Name()), raw, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	expected := []byte("{ \"valid\": true, \"nibbles\": 3, \"open\": false }\n")
	if err := os.WriteFile(filepath.Join(dest, "expected.json"), expected, 0o644); err != nil {
		t.Fatal(err)
	}
}
