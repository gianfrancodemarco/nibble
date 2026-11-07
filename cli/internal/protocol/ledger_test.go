package protocol

import (
	"os"
	"path/filepath"
	"testing"
)

func readDiff(t *testing.T, name string) []byte {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", "diffs", name))
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

// TestParseUnifiedDiff pins the parser against real `git diff -U0` outputs
// captured as fixtures.
func TestParseUnifiedDiff(t *testing.T) {
	cases := []struct {
		fixture string
		want    []DiffHunk
	}{
		{
			fixture: "modify.diff",
			want: []DiffHunk{
				{Path: "modify.txt", BasePath: "modify.txt", BaseStart: 3, BaseLines: 1, HeadStart: 3, HeadLines: 1},
				{Path: "modify.txt", BasePath: "modify.txt", BaseStart: 7, BaseLines: 0, HeadStart: 8, HeadLines: 1},
			},
		},
		{
			fixture: "pure-deletion.diff",
			want: []DiffHunk{
				{Path: "delete-lines.txt", BasePath: "delete-lines.txt", BaseStart: 2, BaseLines: 2, HeadStart: 1, HeadLines: 0},
			},
		},
		{
			fixture: "new-file.diff",
			want: []DiffHunk{
				{Path: "brand-new.txt", BasePath: "", BaseStart: 0, BaseLines: 0, HeadStart: 1, HeadLines: 2},
			},
		},
		{
			fixture: "deleted-file.diff",
			want: []DiffHunk{
				{Path: "", BasePath: "goner.txt", BaseStart: 1, BaseLines: 3, HeadStart: 0, HeadLines: 0},
			},
		},
		{
			fixture: "rename-edit.diff",
			want: []DiffHunk{
				{Path: "newbig.txt", BasePath: "oldbig.txt", BaseStart: 20, BaseLines: 1, HeadStart: 20, HeadLines: 1},
			},
		},
		{
			fixture: "binary.diff",
			want: []DiffHunk{
				{Path: "bin.dat", BasePath: "bin.dat", Binary: true},
			},
		},
		{
			fixture: "crlf.diff",
			want: []DiffHunk{
				{Path: "crlf.txt", BasePath: "crlf.txt", BaseStart: 2, BaseLines: 1, HeadStart: 2, HeadLines: 1},
			},
		},
		{
			fixture: "multi-hunk.diff",
			want: []DiffHunk{
				{Path: "multi.txt", BasePath: "multi.txt", BaseStart: 1, BaseLines: 1, HeadStart: 1, HeadLines: 1},
				{Path: "multi.txt", BasePath: "multi.txt", BaseStart: 12, BaseLines: 1, HeadStart: 12, HeadLines: 1},
			},
		},
	}
	for _, tc := range cases {
		t.Run(tc.fixture, func(t *testing.T) {
			got, err := ParseUnifiedDiff(readDiff(t, tc.fixture))
			if err != nil {
				t.Fatalf("ParseUnifiedDiff: %v", err)
			}
			if len(got) != len(tc.want) {
				t.Fatalf("got %d hunks %+v, want %d", len(got), got, len(tc.want))
			}
			for i := range got {
				if got[i] != tc.want[i] {
					t.Errorf("hunk %d = %+v, want %+v", i, got[i], tc.want[i])
				}
			}
		})
	}

	// A multi-file diff parses every section (10 files, 12 hunks).
	got, err := ParseUnifiedDiff(readDiff(t, "all.diff"))
	if err != nil {
		t.Fatalf("ParseUnifiedDiff(all): %v", err)
	}
	if len(got) != 12 {
		t.Fatalf("all.diff: %d hunks, want 12: %+v", len(got), got)
	}

	// An empty diff is a complete, empty answer.
	got, err = ParseUnifiedDiff(nil)
	if err != nil || len(got) != 0 {
		t.Fatalf("empty diff: %v, %v", got, err)
	}
}

func mustRefs(t *testing.T, raws ...string) []Ref {
	t.Helper()
	refs := make([]Ref, 0, len(raws))
	for _, r := range raws {
		ref, err := ParseRef(r)
		if err != nil {
			t.Fatalf("ParseRef(%q): %v", r, err)
		}
		refs = append(refs, ref)
	}
	return refs
}

// TestCoverage pins the matching rule: path + side shape + line overlap,
// any ref of any nibble; deletions covered at their head-side seam.
func TestCoverage(t *testing.T) {
	headHunk := DiffHunk{Path: "src/a.ts", BasePath: "src/a.ts", BaseStart: 10, BaseLines: 2, HeadStart: 10, HeadLines: 5}
	cases := []struct {
		name    string
		hunks   []DiffHunk
		refs    []string
		covered bool
	}{
		{"plain ref overlaps head hunk", []DiffHunk{headHunk}, []string{"src/a.ts:12-30"}, true},
		{"worktree ref overlaps head hunk", []DiffHunk{headHunk}, []string{"diff:src/a.ts@worktree:14"}, true},
		{"head-side range ref overlaps head hunk", []DiffHunk{headHunk}, []string{"diff:src/a.ts@main..feat#head:1-10"}, true},
		{"base-side ref does not cover a head hunk", []DiffHunk{headHunk}, []string{"diff:src/a.ts@main..feat#base:10-14"}, false},
		{"non-overlapping ref does not cover", []DiffHunk{headHunk}, []string{"src/a.ts:15-30"}, false},
		{"wrong path does not cover", []DiffHunk{headHunk}, []string{"src/b.ts:10-14"}, false},
		{
			"base ref covers a pure deletion",
			[]DiffHunk{{Path: "src/a.ts", BasePath: "src/a.ts", BaseStart: 20, BaseLines: 3, HeadStart: 19, HeadLines: 0}},
			[]string{"diff:src/a.ts@main..feat#base:21-22"}, true,
		},
		{
			"head ref at the seam covers a pure deletion",
			[]DiffHunk{{Path: "src/a.ts", BasePath: "src/a.ts", BaseStart: 20, BaseLines: 3, HeadStart: 19, HeadLines: 0}},
			[]string{"src/a.ts:19"}, true, // the line the code vanished after
		},
		{
			"head ref just past the seam covers it too",
			[]DiffHunk{{Path: "src/a.ts", BasePath: "src/a.ts", BaseStart: 20, BaseLines: 3, HeadStart: 19, HeadLines: 0}},
			[]string{"diff:src/a.ts@worktree:20-25"}, true,
		},
		{
			"head ref away from the seam does not cover a deletion",
			[]DiffHunk{{Path: "src/a.ts", BasePath: "src/a.ts", BaseStart: 20, BaseLines: 3, HeadStart: 19, HeadLines: 0}},
			[]string{"src/a.ts:1-18"}, false,
		},
		{
			"deletion at file start: seam clamps to line 1",
			[]DiffHunk{{Path: "src/a.ts", BasePath: "src/a.ts", BaseStart: 1, BaseLines: 2, HeadStart: 0, HeadLines: 0}},
			[]string{"src/a.ts:1"}, true,
		},
		{
			"deleted file covered only by a base ref",
			[]DiffHunk{{Path: "", BasePath: "src/gone.ts", BaseStart: 1, BaseLines: 8, HeadStart: 0, HeadLines: 0}},
			[]string{"diff:src/gone.ts@main..feat#base:3-5"}, true,
		},
		{
			"deleted file not covered by a plain ref",
			[]DiffHunk{{Path: "", BasePath: "src/gone.ts", BaseStart: 1, BaseLines: 8, HeadStart: 0, HeadLines: 0}},
			[]string{"src/gone.ts:1-8"}, false,
		},
		{
			"binary hunk covered by any same-path head-shaped ref",
			[]DiffHunk{{Path: "logo.png", BasePath: "logo.png", Binary: true}},
			[]string{"logo.png:1"}, true,
		},
		{
			"binary hunk uncovered without a ref",
			[]DiffHunk{{Path: "logo.png", BasePath: "logo.png", Binary: true}},
			nil, false,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			l := Coverage(tc.hunks, mustRefs(t, tc.refs...))
			if l.Total != len(tc.hunks) {
				t.Fatalf("total = %d, want %d", l.Total, len(tc.hunks))
			}
			covered := len(l.Hunks) == 0
			if covered != tc.covered {
				t.Fatalf("covered = %v (ledger %+v), want %v", covered, l, tc.covered)
			}
			if l.Shown != l.Total-len(l.Hunks) {
				t.Fatalf("shown = %d with %d of %d uncovered", l.Shown, len(l.Hunks), l.Total)
			}
		})
	}
}

// TestCoverageLedgerShape pins the uncovered hunks' stored form.
func TestCoverageLedgerShape(t *testing.T) {
	hunks := []DiffHunk{
		{Path: "src/a.ts", BasePath: "src/a.ts", BaseStart: 10, BaseLines: 2, HeadStart: 10, HeadLines: 5}, // covered
		{Path: "src/b.ts", BasePath: "src/b.ts", BaseStart: 3, BaseLines: 1, HeadStart: 3, HeadLines: 2},   // uncovered head
		{Path: "src/c.ts", BasePath: "src/c.ts", BaseStart: 20, BaseLines: 3, HeadStart: 19, HeadLines: 0}, // uncovered deletion
		{Path: "", BasePath: "src/gone.ts", BaseStart: 1, BaseLines: 8, HeadStart: 0, HeadLines: 0},        // deleted file
		{Path: "logo.png", BasePath: "logo.png", Binary: true},                                             // binary
	}
	l := Coverage(hunks, mustRefs(t, "src/a.ts:12"))
	if l.Shown != 1 || l.Total != 5 || len(l.Hunks) != 4 {
		t.Fatalf("ledger = %+v", l)
	}
	want := []LedgerHunk{
		{Path: "src/b.ts", Side: "head", Start: 3, End: 4, Added: 2, Removed: 1},
		{Path: "src/c.ts", Side: "base", Start: 20, End: 22, Added: 0, Removed: 3},
		{Path: "src/gone.ts", Side: "base", Start: 1, End: 8, Added: 0, Removed: 8},
		{Path: "logo.png", Side: "head", Start: 1, End: 1, Added: 0, Removed: 0, Binary: true},
	}
	for i, w := range want {
		if l.Hunks[i] != w {
			t.Errorf("hunk %d = %+v, want %+v", i, l.Hunks[i], w)
		}
	}
	// The result must round-trip the protocol's own validation.
	for i, h := range l.Hunks {
		if err := checkLedgerHunk(h); err != nil {
			t.Errorf("hunk %d does not validate: %v", i, err)
		}
	}
}
