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

// TestVisualLevelField covers the per-element `level` hint: where it is
// accepted, and how bad values and misplaced fields are rejected.
func TestVisualLevelField(t *testing.T) {
	cases := []struct {
		name string
		doc  string
		want string // expected error code, "" means valid
	}{
		{
			name: "map node standard-only",
			doc: `{"kind":"map","title":"t","nodes":[
				{"id":"a","label":"A"},
				{"id":"b","label":"B","level":"standard"}]}`,
		},
		{
			name: "map edge standard-only between overview nodes",
			doc: `{"kind":"map","title":"t","nodes":[
				{"id":"a","label":"A"},{"id":"b","label":"B"}],
				"edges":[{"from":"a","to":"b","level":"standard"}]}`,
		},
		{
			name: "sequence step standard-only",
			doc: `{"kind":"sequence","title":"t",
				"actors":[{"id":"a","label":"A"},{"id":"b","label":"B"}],
				"steps":[
					{"from":"a","to":"b","label":"call"},
					{"from":"b","to":"a","label":"detail","level":"standard"}]}`,
		},
		{
			name: "timeline lane and events standard-only",
			doc: `{"kind":"timeline","title":"t",
				"lanes":[{"id":"main","label":"Main"},{"id":"gc","label":"GC","level":"standard"}],
				"events":[
					{"lane":"main","at":0,"label":"start"},
					{"lane":"gc","at":1,"label":"pause","level":"standard"}]}`,
		},
		{
			name: "timeline state event standard-only",
			doc: `{"kind":"timeline","title":"t",
				"lanes":[{"id":"main","label":"Main"}],
				"events":[{"lane":"main","at":0,"label":"start"}],
				"states":[{"name":"jitter","events":[
					{"lane":"main","at":0,"label":"start"},
					{"lane":"main","at":2,"label":"smeared","level":"standard"}]}]}`,
		},
		{
			name: "compare nested map content is free-form",
			doc: `{"kind":"compare","title":"t",
				"before":{"label":"b","content":{"map":{"nodes":[{"id":"a","label":"A","level":"standard"}]}}},
				"after":{"label":"a","content":{"map":{"nodes":[{"id":"a","label":"A"}]}}}}`,
		},
		{
			name: "deep is reserved",
			doc: `{"kind":"map","title":"t","nodes":[
				{"id":"a","label":"A"},
				{"id":"b","label":"B","level":"deep"}]}`,
			want: "visual.level.unknown",
		},
		{
			name: "overview is not a value, it is the default",
			doc: `{"kind":"timeline","title":"t",
				"lanes":[{"id":"main","label":"Main"}],
				"events":[{"lane":"main","at":0,"label":"start","level":"overview"}]}`,
			want: "visual.level.unknown",
		},
		{
			name: "level on a compare side is unknown",
			doc: `{"kind":"compare","title":"t",
				"before":{"label":"b","level":"standard","content":{"ref":"x"}},
				"after":{"label":"a","content":{"ref":"y"}}}`,
			want: "visual.field.unknown",
		},
		{
			name: "level on a sequence actor is unknown",
			doc: `{"kind":"sequence","title":"t",
				"actors":[{"id":"a","label":"A","level":"standard"},{"id":"b","label":"B"}],
				"steps":[{"from":"a","to":"b","label":"call"}]}`,
			want: "visual.field.unknown",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidateVisual([]byte(tc.doc))
			if got := ErrCode(err); got != tc.want {
				t.Fatalf("error code = %q (%v), want %q", got, err, tc.want)
			}
		})
	}
}

// TestVisualLevelCoherence covers the cross-element level rules: nothing
// drawn at overview may depend on something that is not, and the overview may
// never be empty.
func TestVisualLevelCoherence(t *testing.T) {
	cases := []struct {
		name string
		doc  string
		want string // expected error code, "" means valid
	}{
		{
			name: "overview edge to standard-only node",
			doc: `{"kind":"map","title":"t","nodes":[
				{"id":"a","label":"A"},
				{"id":"cache","label":"Cache","level":"standard"}],
				"edges":[{"from":"a","to":"cache"}]}`,
			want: "map.edge.level",
		},
		{
			name: "overview edge from standard-only node",
			doc: `{"kind":"map","title":"t","nodes":[
				{"id":"a","label":"A"},
				{"id":"cache","label":"Cache","level":"standard"}],
				"edges":[{"from":"cache","to":"a"}]}`,
			want: "map.edge.level",
		},
		{
			name: "standard-only edge may touch a standard-only node",
			doc: `{"kind":"map","title":"t","nodes":[
				{"id":"a","label":"A"},
				{"id":"cache","label":"Cache","level":"standard"}],
				"edges":[{"from":"a","to":"cache","level":"standard"}]}`,
		},
		{
			name: "overview event in standard-only lane",
			doc: `{"kind":"timeline","title":"t",
				"lanes":[{"id":"main","label":"Main"},{"id":"gc","label":"GC","level":"standard"}],
				"events":[{"lane":"gc","at":0,"label":"pause"}]}`,
			want: "timeline.event.level",
		},
		{
			name: "overview state event in standard-only lane",
			doc: `{"kind":"timeline","title":"t",
				"lanes":[{"id":"main","label":"Main"},{"id":"gc","label":"GC","level":"standard"}],
				"events":[{"lane":"main","at":0,"label":"start"}],
				"states":[{"name":"jitter","events":[{"lane":"gc","at":1,"label":"pause"}]}]}`,
			want: "timeline.event.level",
		},
		{
			name: "standard-only event may sit in a standard-only lane",
			doc: `{"kind":"timeline","title":"t",
				"lanes":[{"id":"main","label":"Main"},{"id":"gc","label":"GC","level":"standard"}],
				"events":[
					{"lane":"main","at":0,"label":"start"},
					{"lane":"gc","at":1,"label":"pause","level":"standard"}]}`,
		},
		{
			name: "all-standard map leaves overview empty",
			doc: `{"kind":"map","title":"t","nodes":[
				{"id":"a","label":"A","level":"standard"},
				{"id":"b","label":"B","level":"standard"}],
				"edges":[{"from":"a","to":"b","level":"standard"}]}`,
			want: "visual.overview.empty",
		},
		{
			name: "all-standard sequence steps leave overview empty",
			doc: `{"kind":"sequence","title":"t",
				"actors":[{"id":"a","label":"A"},{"id":"b","label":"B"}],
				"steps":[
					{"from":"a","to":"b","label":"call","level":"standard"},
					{"from":"b","to":"a","label":"return","level":"standard"}]}`,
			want: "visual.overview.empty",
		},
		{
			name: "all-standard timeline leaves overview empty",
			doc: `{"kind":"timeline","title":"t",
				"lanes":[{"id":"gc","label":"GC","level":"standard"}],
				"events":[{"lane":"gc","at":0,"label":"pause","level":"standard"}]}`,
			want: "visual.overview.empty",
		},
		{
			name: "fully unlevelled document stays valid",
			doc: `{"kind":"map","title":"t","nodes":[
				{"id":"a","label":"A"},{"id":"b","label":"B"}],
				"edges":[{"from":"a","to":"b"}]}`,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidateVisual([]byte(tc.doc))
			if got := ErrCode(err); got != tc.want {
				t.Fatalf("error code = %q (%v), want %q", got, err, tc.want)
			}
		})
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
