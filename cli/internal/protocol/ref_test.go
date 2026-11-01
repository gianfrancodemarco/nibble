package protocol

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"
)

func TestParseRef(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want Ref
		err  string // expected error code, "" means success
	}{
		{
			name: "plain ref with range, anchor and note",
			in:   "src/cache/prices.ts:43-45 @cache the TTL lines",
			want: Ref{Path: "src/cache/prices.ts", Start: 43, End: 45, Anchor: "cache", Note: "the TTL lines"},
		},
		{
			name: "single line, no end",
			in:   "src/a.ts:7",
			want: Ref{Path: "src/a.ts", Start: 7, End: 7},
		},
		{
			name: "note without anchor",
			in:   "src/a.ts:1-2 decremented twice",
			want: Ref{Path: "src/a.ts", Start: 1, End: 2, Note: "decremented twice"},
		},
		{
			name: "worktree diff ref",
			in:   "diff:src/db/pool.ts@worktree:12-18",
			want: Ref{Path: "src/db/pool.ts", Start: 12, End: 18, Diff: &DiffSpec{Worktree: true}},
		},
		{
			name: "range diff ref with side",
			in:   "diff:src/pay.ts@main..feat#head:5-9",
			want: Ref{Path: "src/pay.ts", Start: 5, End: 9, Diff: &DiffSpec{Base: "main", Head: "feat", Side: "head"}},
		},
		{name: "reversed range", in: "src/a.ts:45-43", err: CodeRefRange},
		{name: "zero start", in: "src/a.ts:0-3", err: CodeRefRange},
		{name: "escaping path", in: "../secrets.env:1", err: CodeRefPath},
		{name: "absolute path", in: "/etc/passwd:1", err: CodeRefPath},
		{name: "inner dotdot", in: "src/../../x.ts:1", err: CodeRefPath},
		{name: "no line part", in: "src/a.ts", err: CodeRefSyntax},
		{name: "empty", in: "", err: CodeRefSyntax},
		{name: "diff ref without side", in: "diff:src/pay.ts@main..feat:5-9", err: CodeRefSyntax},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ParseRef(tt.in)
			if tt.err != "" {
				if ErrCode(err) != tt.err {
					t.Fatalf("ParseRef(%q) err = %v, want code %s", tt.in, err, tt.err)
				}
				return
			}
			if err != nil {
				t.Fatalf("ParseRef(%q) unexpected error: %v", tt.in, err)
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("ParseRef(%q) = %+v, want %+v", tt.in, got, tt.want)
			}
		})
	}
}

// grammarVector mirrors protocol/golden/refs/grammar.json entries.
type grammarVector struct {
	In   string `json:"in"`
	Want *Ref   `json:"want,omitempty"`
	Err  string `json:"err,omitempty"`
}

func init() {
	runners["refs"] = func(t *testing.T, path string) {
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		var doc struct {
			Cases []grammarVector `json:"cases"`
		}
		if err := json.Unmarshal(raw, &doc); err != nil {
			t.Fatalf("%s: %v", path, err)
		}
		if len(doc.Cases) == 0 {
			t.Fatalf("%s: no cases", path)
		}
		for _, c := range doc.Cases {
			got, err := ParseRef(c.In)
			if c.Err != "" {
				if ErrCode(err) != c.Err {
					t.Errorf("%s: ParseRef(%q) err = %v, want code %s", path, c.In, err, c.Err)
				}
				continue
			}
			if err != nil {
				t.Errorf("%s: ParseRef(%q) unexpected error: %v", path, c.In, err)
				continue
			}
			if c.Want != nil && !reflect.DeepEqual(got, *c.Want) {
				t.Errorf("%s: ParseRef(%q) = %+v, want %+v", path, c.In, got, *c.Want)
			}
		}
	}
}
