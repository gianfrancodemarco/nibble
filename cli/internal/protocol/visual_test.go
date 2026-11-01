package protocol

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestSchemasCompile is task 4.1's verification: every embedded schema
// compiles under the validator.
func TestSchemasCompile(t *testing.T) {
	s, err := loadSchemas()
	if err != nil {
		t.Fatal(err)
	}
	for _, kind := range Kinds {
		if s[kind] == nil {
			t.Fatalf("no compiled schema for kind %q", kind)
		}
	}
}

// TestSchemasInSync keeps the embedded copies byte-identical to the canonical
// schemas at protocol/schemas/.
func TestSchemasInSync(t *testing.T) {
	for _, kind := range Kinds {
		name := kind + ".schema.json"
		embedded, err := schemaFS.ReadFile("schemas/" + name)
		if err != nil {
			t.Fatal(err)
		}
		canonical, err := os.ReadFile(filepath.Join("..", "..", "..", "protocol", "schemas", name))
		if err != nil {
			t.Fatal(err)
		}
		if string(embedded) != string(canonical) {
			t.Errorf("%s: embedded copy differs from protocol/schemas/%s — run: cp protocol/schemas/%s cli/internal/protocol/schemas/", name, name, name)
		}
	}
}

func TestValidateVisualUnknownKind(t *testing.T) {
	err := ValidateVisual([]byte(`{"kind":"gantt","title":"x"}`))
	if ErrCode(err) != "visual.kind.unknown" {
		t.Fatalf("err = %v, want visual.kind.unknown", err)
	}
	if !strings.Contains(err.Error(), "map") {
		t.Fatalf("error %q should list the v1 kinds", err)
	}
}

// invalidFixture wraps an invalid golden visual with its expected error code.
type invalidFixture struct {
	Expect string          `json:"expect"`
	Visual json.RawMessage `json:"visual"`
}

func init() {
	runners["visuals"] = func(t *testing.T, path string) {
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(path, string(filepath.Separator)+"invalid"+string(filepath.Separator)) {
			var f invalidFixture
			if err := json.Unmarshal(raw, &f); err != nil {
				t.Fatalf("%s: %v", path, err)
			}
			if f.Expect == "" || f.Visual == nil {
				t.Fatalf("%s: invalid fixture needs {expect, visual}", path)
			}
			if got := ErrCode(ValidateVisual(f.Visual)); got != f.Expect {
				t.Errorf("%s: error code = %q, want %q", path, got, f.Expect)
			}
			return
		}
		if err := ValidateVisual(raw); err != nil {
			t.Errorf("%s: unexpected error: %v", path, err)
		}
	}
}
