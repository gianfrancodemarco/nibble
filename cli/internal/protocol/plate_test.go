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
