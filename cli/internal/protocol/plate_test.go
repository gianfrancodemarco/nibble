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

func TestPlateUnknownHeaderFieldsPreserved(t *testing.T) {
	dir := t.TempDir()
	header := `{"version":1,"title":"t","repo":"/r","head_sha":"abc","about":"code","created_at":"2026-11-01T10:00:00Z","x_custom":"keep me"}`
	if err := os.WriteFile(filepath.Join(dir, "plate.json"), []byte(header), 0o644); err != nil {
		t.Fatal(err)
	}
	nibble := `{"caption":"c","visual":{"kind":"map","title":"m","nodes":[{"id":"a","label":"A"}]},"refs":[]}`
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
