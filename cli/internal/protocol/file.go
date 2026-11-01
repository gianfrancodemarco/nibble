package protocol

import "strings"

// FileContent is a file's text held in memory, split into lines. The protocol
// core never touches the filesystem; callers load content and hand it in.
type FileContent struct {
	Lines []string
}

// SplitLines normalizes raw file bytes into protocol lines: CRLF becomes LF,
// and a trailing final newline does not produce an empty last line.
func SplitLines(raw []byte) *FileContent {
	s := strings.ReplaceAll(string(raw), "\r\n", "\n")
	s = strings.TrimSuffix(s, "\n")
	if s == "" {
		return &FileContent{Lines: []string{}}
	}
	return &FileContent{Lines: strings.Split(s, "\n")}
}

// CheckRef validates a parsed ref against the file it names, at write time.
// A nil file means the file (or, for diff refs, the named side) is missing.
func CheckRef(r Ref, f *FileContent) error {
	if f == nil {
		if r.Diff != nil {
			return errf(CodeRefDiffSideMissing, "%s: the named diff side does not contain this path", r.Path)
		}
		return errf(CodeRefFileMissing, "%s does not exist", r.Path)
	}
	if n := len(f.Lines); r.End > n {
		return errf(CodeRefBeyondEOF, "%s has %d lines, ref ends at %d", r.Path, n, r.End)
	}
	return nil
}
