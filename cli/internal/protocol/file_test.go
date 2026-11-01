package protocol

import (
	"strings"
	"testing"
)

func nLines(n int) *FileContent {
	lines := make([]string, n)
	for i := range lines {
		lines[i] = "line"
	}
	return &FileContent{Lines: lines}
}

func TestSplitLines(t *testing.T) {
	f := SplitLines([]byte("a\r\nb\nc\n"))
	want := []string{"a", "b", "c"}
	if len(f.Lines) != len(want) {
		t.Fatalf("got %d lines %q, want %d", len(f.Lines), f.Lines, len(want))
	}
	for i := range want {
		if f.Lines[i] != want[i] {
			t.Fatalf("line %d = %q, want %q", i, f.Lines[i], want[i])
		}
	}
}

func TestCheckRef(t *testing.T) {
	mustRef := func(s string) Ref {
		r, err := ParseRef(s)
		if err != nil {
			t.Fatalf("ParseRef(%q): %v", s, err)
		}
		return r
	}

	tests := []struct {
		name string
		ref  Ref
		file *FileContent
		err  string
	}{
		{name: "in range", ref: mustRef("src/a.ts:3-5"), file: nLines(10)},
		{name: "exactly at eof", ref: mustRef("src/a.ts:10"), file: nLines(10)},
		{name: "missing file", ref: mustRef("src/a.ts:1"), file: nil, err: CodeRefFileMissing},
		{name: "beyond eof", ref: mustRef("src/db/pool.ts:12-90"), file: nLines(61), err: CodeRefBeyondEOF},
		{name: "diff side missing", ref: mustRef("diff:src/pay.ts@main..feat#head:5-9"), file: nil, err: CodeRefDiffSideMissing},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := CheckRef(tt.ref, tt.file)
			if ErrCode(err) != tt.err {
				t.Fatalf("CheckRef = %v, want code %q", err, tt.err)
			}
		})
	}
}

func TestCheckRefBeyondEOFReportsLineCount(t *testing.T) {
	r, _ := ParseRef("src/db/pool.ts:12-90")
	err := CheckRef(r, nLines(61))
	if ErrCode(err) != CodeRefBeyondEOF {
		t.Fatalf("err = %v, want %s", err, CodeRefBeyondEOF)
	}
	if !strings.Contains(err.Error(), "61") {
		t.Fatalf("error %q should name the actual line count 61", err)
	}
}
