package protocol

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// plateExpected mirrors golden/plates/<name>/expected.json.
type plateExpected struct {
	Valid   bool   `json:"valid"`
	Error   string `json:"error,omitempty"`
	Nibbles int    `json:"nibbles,omitempty"`
	Open    *bool  `json:"open,omitempty"`
}

func init() {
	runners["plates"] = func(t *testing.T, path string) {
		// A plate fixture is a directory; only its expected.json drives a run.
		if filepath.Base(path) != "expected.json" {
			return
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		var want plateExpected
		if err := json.Unmarshal(raw, &want); err != nil {
			t.Fatalf("%s: %v", path, err)
		}
		plateDir := filepath.Join(filepath.Dir(path), "plate")
		p, err := ParsePlate(plateDir)
		if !want.Valid {
			if got := ErrCode(err); got != want.Error {
				t.Errorf("%s: error code = %q (%v), want %q", path, got, err, want.Error)
			}
			return
		}
		if err != nil {
			t.Errorf("%s: unexpected error: %v", path, err)
			return
		}
		if p == nil {
			t.Errorf("%s: valid plate parsed to nil", path)
			return
		}
		if len(p.Nibbles) != want.Nibbles {
			t.Errorf("%s: %d nibbles, want %d", path, len(p.Nibbles), want.Nibbles)
		}
		if want.Open != nil && p.Open != *want.Open {
			t.Errorf("%s: open = %v, want %v", path, p.Open, *want.Open)
		}
	}
}

// writePlate lays a plate on disk from a header and nibble JSON strings.
func writePlate(t *testing.T, header string, nibbles ...string) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "plate.json"), []byte(header), 0o644); err != nil {
		t.Fatal(err)
	}
	for i, nb := range nibbles {
		name := filepath.Join(dir, "n"+string(rune('1'+i))+".json")
		if err := os.WriteFile(name, []byte(nb), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

const testHeader = `{"version":1,"title":"t","repo":"/r","head_sha":"abc","about":"code","created_at":"2026-11-01T10:00:00Z"}`
const testVisual = `{"kind":"map","title":"m","nodes":[{"id":"a","label":"A"}]}`

// TestNibbleTitleAndDescriptions covers the caption → title rename and the
// levelled description object on nibbles.
func TestNibbleTitleAndDescriptions(t *testing.T) {
	cases := []struct {
		name   string
		nibble string
		want   string // error code, "" means valid
	}{
		{
			name:   "title parses",
			nibble: `{"title":"the claim","visual":` + testVisual + `,"refs":[]}`,
		},
		{
			name:   "old caption field refused, message names the rename",
			nibble: `{"caption":"the claim","visual":` + testVisual + `,"refs":[]}`,
			want:   "nibble.title.missing",
		},
		{
			name: "overview-only description",
			nibble: `{"title":"c","description":{"overview":"why this matters"},
				"visual":` + testVisual + `,"refs":[]}`,
		},
		{
			name: "both description variants",
			nibble: `{"title":"c","description":{"overview":"skim","standard":"the full story"},
				"visual":` + testVisual + `,"refs":[]}`,
		},
		{
			name: "standard without overview rejected",
			nibble: `{"title":"c","description":{"standard":"only the long form"},
				"visual":` + testVisual + `,"refs":[]}`,
			want: "nibble.description",
		},
		{
			name:   "description must be an object",
			nibble: `{"title":"c","description":"just a string","visual":` + testVisual + `,"refs":[]}`,
			want:   "nibble.description",
		},
		{
			name: "empty overview rejected",
			nibble: `{"title":"c","description":{"overview":""},
				"visual":` + testVisual + `,"refs":[]}`,
			want: "nibble.description",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			p, err := ParsePlate(writePlate(t, testHeader, tc.nibble))
			if got := ErrCode(err); got != tc.want {
				t.Fatalf("error code = %q (%v), want %q", got, err, tc.want)
			}
			if tc.want == "" && p.Nibbles[0].Title == "" {
				t.Fatalf("parsed nibble has empty title")
			}
		})
	}
	// the rename is taught in the message
	_, err := ParsePlate(writePlate(t, testHeader, `{"caption":"c","visual":`+testVisual+`,"refs":[]}`))
	if err == nil || !strings.Contains(err.Error(), "title") {
		t.Fatalf("rename message should name title: %v", err)
	}
}

// TestPlateHeaderDescriptionAndBecause covers the plate-level description and
// the over-budget reason on the header.
func TestPlateHeaderDescriptionAndBecause(t *testing.T) {
	nibble := `{"title":"c","visual":` + testVisual + `,"refs":[]}`
	base := `{"version":1,"title":"t","repo":"/r","head_sha":"abc","about":"code","created_at":"2026-11-01T10:00:00Z"`

	p, err := ParsePlate(writePlate(t, base+`,"description":{"overview":"the gist","standard":"the full story"},"because":"room needed"}`, nibble))
	if err != nil {
		t.Fatalf("ParsePlate: %v", err)
	}
	if p.Header.Description == nil || p.Header.Description.Overview != "the gist" || p.Header.Description.Standard != "the full story" {
		t.Fatalf("header description = %+v", p.Header.Description)
	}
	if p.Header.Because != "room needed" {
		t.Fatalf("header because = %q", p.Header.Because)
	}

	_, err = ParsePlate(writePlate(t, base+`,"description":"just a string"}`, nibble))
	if got := ErrCode(err); got != "plate.description" {
		t.Fatalf("string description: code = %q (%v), want plate.description", got, err)
	}
	_, err = ParsePlate(writePlate(t, base+`,"description":{"standard":"only long"}}`, nibble))
	if got := ErrCode(err); got != "plate.description" {
		t.Fatalf("standard-only: code = %q (%v), want plate.description", got, err)
	}
}

func TestPlateUnknownHeaderFieldsPreserved(t *testing.T) {
	dir := t.TempDir()
	header := `{"version":1,"title":"t","repo":"/r","head_sha":"abc","about":"code","created_at":"2026-11-01T10:00:00Z","x_custom":"keep me"}`
	if err := os.WriteFile(filepath.Join(dir, "plate.json"), []byte(header), 0o644); err != nil {
		t.Fatal(err)
	}
	nibble := `{"title":"c","visual":{"kind":"map","title":"m","nodes":[{"id":"a","label":"A"}]},"refs":[]}`
	if err := os.WriteFile(filepath.Join(dir, "n1.json"), []byte(nibble), 0o644); err != nil {
		t.Fatal(err)
	}
	p, err := ParsePlate(dir)
	if err != nil {
		t.Fatalf("ParsePlate: %v", err)
	}
	if !strings.Contains(string(p.Header.Raw), "x_custom") {
		t.Fatalf("unknown header field lost: raw = %s", p.Header.Raw)
	}
}

func TestPlateAboutForms(t *testing.T) {
	tests := []struct {
		in   string
		want About
	}{
		{`"code"`, About{Kind: "code"}},
		{`"worktree"`, About{Kind: "worktree"}},
		{`{"pr":1247}`, About{Kind: "pr", PR: 1247}},
		{`{"range":"main..feat"}`, About{Kind: "range", Range: "main..feat"}},
	}
	for _, tt := range tests {
		var a About
		if err := json.Unmarshal([]byte(tt.in), &a); err != nil {
			t.Fatalf("About(%s): %v", tt.in, err)
		}
		if a != tt.want {
			t.Fatalf("About(%s) = %+v, want %+v", tt.in, a, tt.want)
		}
	}
}

// TestPlateLedger covers ledger.json: shape validation, the about-kind rule,
// and exposure on the parsed plate.
func TestPlateLedger(t *testing.T) {
	const worktreeHeader = `{"version":1,"title":"t","repo":"/r","head_sha":"abc","about":"worktree","created_at":"2026-11-01T10:00:00Z"}`
	nibble := `{"title":"c","visual":` + testVisual + `,"refs":[]}`
	goodHunk := `{"path":"src/retry.ts","side":"head","start":10,"end":14,"added":5,"removed":2}`

	writeLedger := func(t *testing.T, header, ledger string) string {
		t.Helper()
		dir := writePlate(t, header, nibble)
		if err := os.WriteFile(filepath.Join(dir, "ledger.json"), []byte(ledger), 0o644); err != nil {
			t.Fatal(err)
		}
		return dir
	}

	cases := []struct {
		name   string
		header string
		ledger string
		want   string // error code, "" means valid
	}{
		{
			name:   "valid ledger with hunks",
			header: worktreeHeader,
			ledger: `{"shown":4,"total":6,"hunks":[` + goodHunk + `]}`,
		},
		{
			name:   "fully covered ledger",
			header: worktreeHeader,
			ledger: `{"shown":6,"total":6,"hunks":[]}`,
		},
		{
			name:   "binary hunk may count no lines",
			header: worktreeHeader,
			ledger: `{"shown":0,"total":1,"hunks":[{"path":"logo.png","side":"head","start":1,"end":1,"added":0,"removed":0,"binary":true}]}`,
		},
		{
			name:   "bad side",
			header: worktreeHeader,
			ledger: `{"shown":0,"total":1,"hunks":[{"path":"a.ts","side":"worktree","start":1,"end":2,"added":1,"removed":0}]}`,
			want:   "plate.ledger",
		},
		{
			name:   "end below start",
			header: worktreeHeader,
			ledger: `{"shown":0,"total":1,"hunks":[{"path":"a.ts","side":"head","start":5,"end":3,"added":1,"removed":0}]}`,
			want:   "plate.ledger",
		},
		{
			name:   "absolute path",
			header: worktreeHeader,
			ledger: `{"shown":0,"total":1,"hunks":[{"path":"/etc/passwd","side":"head","start":1,"end":1,"added":1,"removed":0}]}`,
			want:   "plate.ledger",
		},
		{
			name:   "escaping path",
			header: worktreeHeader,
			ledger: `{"shown":0,"total":1,"hunks":[{"path":"../a.ts","side":"head","start":1,"end":1,"added":1,"removed":0}]}`,
			want:   "plate.ledger",
		},
		{
			name:   "shown beyond total",
			header: worktreeHeader,
			ledger: `{"shown":7,"total":6,"hunks":[]}`,
			want:   "plate.ledger",
		},
		{
			name:   "non-binary hunk counting no lines",
			header: worktreeHeader,
			ledger: `{"shown":0,"total":1,"hunks":[{"path":"a.ts","side":"head","start":1,"end":1,"added":0,"removed":0}]}`,
			want:   "plate.ledger",
		},
		{
			name:   "not an object",
			header: worktreeHeader,
			ledger: `[1,2,3]`,
			want:   "plate.ledger",
		},
		{
			name:   "ledger on a code plate",
			header: testHeader,
			ledger: `{"shown":0,"total":0,"hunks":[]}`,
			want:   "plate.ledger",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			p, err := ParsePlate(writeLedger(t, tc.header, tc.ledger))
			if got := ErrCode(err); got != tc.want {
				t.Fatalf("error code = %q (%v), want %q", got, err, tc.want)
			}
			if tc.want == "" && p.Ledger == nil {
				t.Fatalf("valid ledger not exposed on the plate")
			}
		})
	}

	// Exposure: the parsed ledger carries what the file said.
	p, err := ParsePlate(writeLedger(t, worktreeHeader, `{"shown":4,"total":6,"hunks":[`+goodHunk+`]}`))
	if err != nil {
		t.Fatalf("ParsePlate: %v", err)
	}
	if p.Ledger.Shown != 4 || p.Ledger.Total != 6 || len(p.Ledger.Hunks) != 1 {
		t.Fatalf("ledger = %+v", p.Ledger)
	}
	h := p.Ledger.Hunks[0]
	if h.Path != "src/retry.ts" || h.Side != "head" || h.Start != 10 || h.End != 14 || h.Added != 5 || h.Removed != 2 {
		t.Fatalf("hunk = %+v", h)
	}

	// Range plates take ledgers too; a diff plate without one stays valid.
	rangeHeader := `{"version":1,"title":"t","repo":"/r","head_sha":"abc","about":{"range":"main..feat"},"created_at":"2026-11-01T10:00:00Z"}`
	if _, err := ParsePlate(writeLedger(t, rangeHeader, `{"shown":1,"total":1,"hunks":[]}`)); err != nil {
		t.Fatalf("ledger on a range plate: %v", err)
	}
	p, err = ParsePlate(writePlate(t, worktreeHeader, nibble))
	if err != nil || p.Ledger != nil {
		t.Fatalf("diff plate without ledger: p.Ledger=%v err=%v", p.Ledger, err)
	}
}
