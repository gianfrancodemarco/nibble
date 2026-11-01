package protocol

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const sampleFile = "func getPrice(sku) {\n  const hit = cache.get(sku)\n  if (hit) return hit\n  const price = db.price(sku)\n  cache.set(sku, price, { ttl: 3600 })\n  return price\n}\n"

func fpOf(t *testing.T, raw string, start, end int) *Fingerprint {
	t.Helper()
	fp, err := NewFingerprint(SplitLines([]byte(raw)), start, end)
	if err != nil {
		t.Fatalf("NewFingerprint: %v", err)
	}
	return fp
}

func TestFingerprintDeterminism(t *testing.T) {
	lf := fpOf(t, sampleFile, 4, 5)
	crlf := fpOf(t, strings.ReplaceAll(sampleFile, "\n", "\r\n"), 4, 5)
	trailing := fpOf(t, strings.ReplaceAll(sampleFile, ")\n", ")  \n"), 4, 5)
	if lf.Sum != crlf.Sum {
		t.Fatalf("CRLF changed fingerprint: %s vs %s", lf.Sum, crlf.Sum)
	}
	if lf.Sum != trailing.Sum {
		t.Fatalf("trailing whitespace changed fingerprint: %s vs %s", lf.Sum, trailing.Sum)
	}
}

func TestFingerprintFormat(t *testing.T) {
	fp := fpOf(t, sampleFile, 4, 5)
	if !strings.HasPrefix(fp.Sum, "fp1:") || len(fp.Sum) != len("fp1:")+64 {
		t.Fatalf("Sum = %q, want fp1:<64 hex>", fp.Sum)
	}
	if len(fp.Lines) != 2 {
		t.Fatalf("Lines = %d hashes, want 2", len(fp.Lines))
	}
}

func TestFingerprintContextAtEdges(t *testing.T) {
	top := fpOf(t, sampleFile, 1, 2)
	if len(top.CtxBefore) != 0 {
		t.Fatalf("CtxBefore at top of file = %d, want 0", len(top.CtxBefore))
	}
	if len(top.CtxAfter) != 2 {
		t.Fatalf("CtxAfter = %d, want 2", len(top.CtxAfter))
	}
	bottom := fpOf(t, sampleFile, 6, 7)
	if len(bottom.CtxAfter) != 0 {
		t.Fatalf("CtxAfter at bottom of file = %d, want 0", len(bottom.CtxAfter))
	}
	if len(bottom.CtxBefore) != 2 {
		t.Fatalf("CtxBefore = %d, want 2", len(bottom.CtxBefore))
	}
}

func TestFingerprintRangeChecked(t *testing.T) {
	_, err := NewFingerprint(SplitLines([]byte("one\n")), 1, 9)
	if ErrCode(err) != CodeRefBeyondEOF {
		t.Fatalf("err = %v, want %s", err, CodeRefBeyondEOF)
	}
}

func TestTrust(t *testing.T) {
	insert := func(raw string, afterLine int, lines ...string) string {
		all := strings.Split(strings.TrimSuffix(raw, "\n"), "\n")
		out := append([]string{}, all[:afterLine]...)
		out = append(out, lines...)
		out = append(out, all[afterLine:]...)
		return strings.Join(out, "\n") + "\n"
	}

	fp := fpOf(t, sampleFile, 4, 5)

	tests := []struct {
		name    string
		current string // "" means file gone
		level   TrustLevel
		offset  int
	}{
		{name: "untouched", current: sampleFile, level: TrustExact},
		{name: "moved down by 3", current: insert(sampleFile, 0, "// a", "// b", "// c"), level: TrustShifted, offset: 3},
		{name: "moved up", current: strings.Replace(sampleFile, "func getPrice(sku) {\n", "", 1), level: TrustShifted, offset: -1},
		{name: "rewritten", current: strings.Replace(sampleFile, "ttl: 3600", "ttl: jitter(3600)", 1), level: TrustStale},
		{name: "file gone", current: "", level: TrustStale},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var cur *FileContent
			if tt.current != "" {
				cur = SplitLines([]byte(tt.current))
			}
			level, offset := fp.Trust(4, cur)
			if level != tt.level || offset != tt.offset {
				t.Fatalf("Trust = %s/%+d, want %s/%+d", level, offset, tt.level, tt.offset)
			}
		})
	}
}

func TestTrustAmbiguousIsStale(t *testing.T) {
	// The referenced content appears twice in the current file and the
	// original location no longer matches: never guess between the copies.
	raw := "aaa\nmarker\nbbb\nccc\n"
	fp := fpOf(t, raw, 2, 2)
	current := SplitLines([]byte("xxx\nyyy\nmarker\nzzz\nmarker\nwww\n"))
	level, _ := fp.Trust(2, current)
	if level != TrustStale {
		t.Fatalf("ambiguous match: Trust = %s, want stale", level)
	}
}

// trustVector mirrors protocol/golden/trust fixtures.
type trustVector struct {
	Name     string `json:"name"`
	Original string `json:"original_file"`
	Start    int    `json:"start"`
	End      int    `json:"end"`
	Current  *string `json:"current_file"` // null = file gone
	Want     struct {
		Level  string `json:"level"`
		Offset int    `json:"offset"`
	} `json:"want"`
}

func init() {
	runners["trust"] = func(t *testing.T, path string) {
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		switch filepath.Base(path) {
		case "fingerprint.json":
			var doc struct {
				Cases []struct {
					Name  string `json:"name"`
					FileA string `json:"file_a"`
					FileB string `json:"file_b"`
					Start int    `json:"start"`
					End   int    `json:"end"`
					Equal bool   `json:"equal"`
				} `json:"cases"`
			}
			if err := json.Unmarshal(raw, &doc); err != nil {
				t.Fatalf("%s: %v", path, err)
			}
			for _, c := range doc.Cases {
				a := fpOf(t, c.FileA, c.Start, c.End)
				b := fpOf(t, c.FileB, c.Start, c.End)
				if got := a.Sum == b.Sum; got != c.Equal {
					t.Errorf("%s/%s: equal = %v, want %v", path, c.Name, got, c.Equal)
				}
			}
		default:
			var doc struct {
				Cases []trustVector `json:"cases"`
			}
			if err := json.Unmarshal(raw, &doc); err != nil {
				t.Fatalf("%s: %v", path, err)
			}
			for _, c := range doc.Cases {
				fp := fpOf(t, c.Original, c.Start, c.End)
				var cur *FileContent
				if c.Current != nil {
					cur = SplitLines([]byte(*c.Current))
				}
				level, offset := fp.Trust(c.Start, cur)
				if string(level) != c.Want.Level || offset != c.Want.Offset {
					t.Errorf("%s/%s: Trust = %s/%+d, want %s/%+d", path, c.Name, level, offset, c.Want.Level, c.Want.Offset)
				}
			}
		}
	}
}
