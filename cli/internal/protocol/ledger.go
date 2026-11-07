package protocol

import (
	"encoding/json"
	"regexp"
	"strconv"
	"strings"
)

// LedgerHunk is one uncovered diff hunk in the not-shown ledger: the lines a
// plate's walkthrough never referenced. Head-side hunks address the new code
// (worktree or the range's head); base-side hunks address removed code, which
// only exists on the base side.
type LedgerHunk struct {
	Path    string `json:"path"`
	Side    string `json:"side"` // "head" or "base"
	Start   int    `json:"start"`
	End     int    `json:"end"`
	Added   int    `json:"added"`
	Removed int    `json:"removed"`
	Binary  bool   `json:"binary,omitempty"`
}

// Ledger is ledger.json: the not-shown ledger a diff plate is sealed with.
// Shown and Total are stored, not derived, so "everything was shown" is a
// statement the file itself makes.
type Ledger struct {
	Shown int          `json:"shown"`
	Total int          `json:"total"`
	Hunks []LedgerHunk `json:"hunks"`
}

// DiffHunk is one hunk of a parsed unified diff, in both coordinate systems.
// Path is the head-side path ("" when the file is gone there); BasePath the
// base-side path ("" for a new file). A Binary hunk carries no line ranges.
type DiffHunk struct {
	Path      string
	BasePath  string
	BaseStart int
	BaseLines int
	HeadStart int
	HeadLines int
	Binary    bool
}

var hunkHeaderRe = regexp.MustCompile(`^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@`)
var binaryRe = regexp.MustCompile(`^Binary files (?:a/(.+)|/dev/null) and (?:b/(.+)|/dev/null) differ$`)

// ParseUnifiedDiff parses `git diff -U0` output into hunks. It reads the
// per-file headers (`diff --git`, `---`/`+++`, renames, `Binary files`) and
// every `@@ -a,b +c,d @@` header; content lines are not interpreted, so CRLF
// payloads pass through untouched.
func ParseUnifiedDiff(raw []byte) ([]DiffHunk, error) {
	hunks := []DiffHunk{}
	var basePath, headPath string
	inFile := false
	for _, line := range strings.Split(string(raw), "\n") {
		switch {
		case strings.HasPrefix(line, "diff --git "):
			inFile, basePath, headPath = true, "", ""
		case inFile && strings.HasPrefix(line, "--- "):
			basePath = stripDiffPath(strings.TrimPrefix(line, "--- "), "a/")
		case inFile && strings.HasPrefix(line, "+++ "):
			headPath = stripDiffPath(strings.TrimPrefix(line, "+++ "), "b/")
		case inFile && strings.HasPrefix(line, "Binary files "):
			m := binaryRe.FindStringSubmatch(line)
			if m == nil {
				return nil, errf(CodePlateLedger, "unparseable binary marker %q", line)
			}
			hunks = append(hunks, DiffHunk{Path: m[2], BasePath: m[1], Binary: true})
			inFile = false
		case inFile && strings.HasPrefix(line, "@@ "):
			m := hunkHeaderRe.FindStringSubmatch(line)
			if m == nil {
				return nil, errf(CodePlateLedger, "unparseable hunk header %q", line)
			}
			h := DiffHunk{Path: headPath, BasePath: basePath}
			h.BaseStart, h.BaseLines = atoiPair(m[1], m[2])
			h.HeadStart, h.HeadLines = atoiPair(m[3], m[4])
			hunks = append(hunks, h)
		}
	}
	return hunks, nil
}

// stripDiffPath turns a `---`/`+++` path into a repo-relative one: the a/ or
// b/ prefix dropped, /dev/null (a side without the file) becoming "".
func stripDiffPath(p, prefix string) string {
	p = strings.TrimSuffix(p, "\t") // git appends a tab before timestamps in some modes
	if p == "/dev/null" {
		return ""
	}
	return strings.TrimPrefix(p, prefix)
}

// atoiPair reads a hunk range "start[,count]"; an omitted count means 1.
func atoiPair(start, count string) (int, int) {
	s, _ := strconv.Atoi(start)
	c := 1
	if count != "" {
		c, _ = strconv.Atoi(count)
	}
	return s, c
}

// Coverage matches every diff hunk against every ref and returns the ledger:
// the hunks no ref covered, plus the shown/total counts. The rule is path +
// side shape + line overlap — any overlap counts as shown; judging whether a
// hunk was shown *well* is the reviewer's job.
func Coverage(hunks []DiffHunk, refs []Ref) Ledger {
	l := Ledger{Total: len(hunks), Hunks: []LedgerHunk{}}
	for _, h := range hunks {
		if hunkCovered(h, refs) {
			l.Shown++
		} else {
			l.Hunks = append(l.Hunks, toLedgerHunk(h))
		}
	}
	return l
}

// headShaped: does a ref address head-side content? Plain refs and @worktree
// refs read the file as it is (the head of the diff the plate is about);
// #head range refs name it explicitly. Only #base refs are base-shaped.
func headShaped(r Ref) bool { return r.Diff == nil || r.Diff.Worktree || r.Diff.Side == "head" }

func overlaps(aStart, aEnd, bStart, bEnd int) bool { return aStart <= bEnd && bStart <= aEnd }

func hunkCovered(h DiffHunk, refs []Ref) bool {
	for _, r := range refs {
		switch {
		case h.Binary:
			// No lines to overlap: any ref naming the path on the side
			// where the file exists counts.
			if headShaped(r) && h.Path != "" && r.Path == h.Path {
				return true
			}
			if !headShaped(r) && h.BasePath != "" && r.Path == h.BasePath {
				return true
			}
		case h.HeadLines > 0:
			// Added or changed lines: head-side content.
			if headShaped(r) && r.Path == h.Path &&
				overlaps(r.Start, r.End, h.HeadStart, h.HeadStart+h.HeadLines-1) {
				return true
			}
		default:
			// Pure deletion: the removed lines exist on the base side; a
			// head-shaped ref covering the seam they vanished from counts
			// too (worktree plates have no base-side ref form).
			if !headShaped(r) && r.Path == h.BasePath &&
				overlaps(r.Start, r.End, h.BaseStart, h.BaseStart+h.BaseLines-1) {
				return true
			}
			if headShaped(r) && h.Path != "" && r.Path == h.Path &&
				overlaps(r.Start, r.End, max(1, h.HeadStart), h.HeadStart+1) {
				return true
			}
		}
	}
	return false
}

// toLedgerHunk converts an uncovered diff hunk into its stored form, placed
// on the side where its lines can be looked at.
func toLedgerHunk(h DiffHunk) LedgerHunk {
	switch {
	case h.Binary:
		path, side := h.Path, "head"
		if path == "" {
			path, side = h.BasePath, "base"
		}
		return LedgerHunk{Path: path, Side: side, Start: 1, End: 1, Binary: true}
	case h.HeadLines > 0:
		return LedgerHunk{
			Path: h.Path, Side: "head",
			Start: h.HeadStart, End: h.HeadStart + h.HeadLines - 1,
			Added: h.HeadLines, Removed: h.BaseLines,
		}
	default:
		return LedgerHunk{
			Path: h.BasePath, Side: "base",
			Start: h.BaseStart, End: h.BaseStart + h.BaseLines - 1,
			Added: 0, Removed: h.BaseLines,
		}
	}
}

// parseLedger validates ledger.json per protocol v1. aboutKind is the plate's
// about form: only plates about a diff may carry a ledger.
func parseLedger(raw []byte, aboutKind string) (*Ledger, error) {
	if aboutKind != "worktree" && aboutKind != "range" && aboutKind != "pr" {
		return nil, errf(CodePlateLedger,
			"ledger.json on an about: %s plate: only a plate about a diff (worktree, range, pr) has hunks for a ledger to cover", aboutKind)
	}
	var l Ledger
	if err := json.Unmarshal(raw, &l); err != nil {
		return nil, errf(CodePlateLedger, "ledger.json: want {\"shown\": N, \"total\": N, \"hunks\": […]}: %v", err)
	}
	if l.Shown < 0 || l.Total < 0 || l.Shown > l.Total {
		return nil, errf(CodePlateLedger, "ledger.json: want 0 ≤ shown ≤ total, got shown %d of total %d", l.Shown, l.Total)
	}
	if l.Hunks == nil {
		return nil, errf(CodePlateLedger, "ledger.json: hunks is required (use [] when every hunk was shown)")
	}
	for i, h := range l.Hunks {
		if err := checkLedgerHunk(h); err != nil {
			return nil, errf(CodePlateLedger, "ledger.json hunk %d (%s): %s", i, h.Path, err.(*Error).Msg)
		}
	}
	return &l, nil
}

func checkLedgerHunk(h LedgerHunk) error {
	if h.Path == "" {
		return errf(CodePlateLedger, "path must not be empty")
	}
	if strings.HasPrefix(h.Path, "/") || strings.HasPrefix(h.Path, `\`) {
		return errf(CodePlateLedger, "path must be relative to the plate's repo")
	}
	for _, seg := range strings.FieldsFunc(h.Path, func(r rune) bool { return r == '/' || r == '\\' }) {
		if seg == ".." {
			return errf(CodePlateLedger, "path must not escape the repo")
		}
	}
	if h.Side != "head" && h.Side != "base" {
		return errf(CodePlateLedger, "side %q: want \"head\" (new code) or \"base\" (removed code)", h.Side)
	}
	if h.Start < 1 || h.End < h.Start {
		return errf(CodePlateLedger, "invalid range %d-%d: want 1 ≤ start ≤ end", h.Start, h.End)
	}
	if h.Added < 0 || h.Removed < 0 {
		return errf(CodePlateLedger, "added/removed must not be negative")
	}
	if h.Added == 0 && h.Removed == 0 && !h.Binary {
		return errf(CodePlateLedger, "a hunk must add or remove lines (or declare \"binary\": true)")
	}
	return nil
}
