package protocol

import (
	"regexp"
	"strconv"
	"strings"
)

// DiffSpec names which code a diff ref points at: the uncommitted working
// tree, or one side of a base..head range.
type DiffSpec struct {
	Worktree bool   `json:"worktree,omitempty"`
	Base     string `json:"base,omitempty"`
	Head     string `json:"head,omitempty"`
	Side     string `json:"side,omitempty"` // "base" or "head"
}

// Ref is one parsed code reference.
type Ref struct {
	Path   string    `json:"path"`
	Start  int       `json:"start"`
	End    int       `json:"end"`
	Anchor string    `json:"anchor,omitempty"`
	Note   string    `json:"note,omitempty"`
	Diff   *DiffSpec `json:"diff,omitempty"`
}

var (
	// <path>:<start>[-<end>][ @anchor][ note]
	plainRe = regexp.MustCompile(`^(?P<path>\S+?):(?P<start>\d+)(?:-(?P<end>\d+))?(?P<rest>\s.*)?$`)
	// diff:<path>@worktree:... | diff:<path>@<base>..<head>#<side>:...
	diffRe = regexp.MustCompile(`^diff:(?P<path>[^@\s]+)@(?:(?P<wt>worktree)|(?P<base>[^.#\s]+)\.\.(?P<head>[^#\s]+)#(?P<side>base|head)):(?P<start>\d+)(?:-(?P<end>\d+))?(?P<rest>\s.*)?$`)
	// [@anchor] [note]
	restRe = regexp.MustCompile(`^(?:@(?P<anchor>[A-Za-z0-9_-]+))?(?:\s+(?P<note>\S.*))?$|^(?P<noteonly>\S.*)$`)
)

// ParseRef parses a ref string per protocol v1:
//
//	<path>:<start>[-<end>] [@<anchor>] [note]
//	diff:<path>@worktree:<start>[-<end>] [@<anchor>] [note]
//	diff:<path>@<base>..<head>#<base|head>:<start>[-<end>] [@<anchor>] [note]
func ParseRef(s string) (Ref, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return Ref{}, errf(CodeRefSyntax, "empty ref")
	}

	var r Ref
	var m []string
	var names []string

	if strings.HasPrefix(s, "diff:") {
		m = diffRe.FindStringSubmatch(s)
		if m == nil {
			return Ref{}, errf(CodeRefSyntax, "malformed diff ref %q: want diff:<path>@worktree:<start>[-<end>] or diff:<path>@<base>..<head>#<base|head>:<start>[-<end>]", s)
		}
		names = diffRe.SubexpNames()
		g := group(names, m)
		if g["wt"] != "" {
			r.Diff = &DiffSpec{Worktree: true}
		} else {
			r.Diff = &DiffSpec{Base: g["base"], Head: g["head"], Side: g["side"]}
		}
		r.Path = g["path"]
		var err error
		if r.Start, r.End, err = parseRange(g["start"], g["end"]); err != nil {
			return Ref{}, err
		}
		if err := parseRest(g["rest"], &r); err != nil {
			return Ref{}, err
		}
	} else {
		m = plainRe.FindStringSubmatch(s)
		if m == nil {
			return Ref{}, errf(CodeRefSyntax, "malformed ref %q: want <path>:<start>[-<end>] [@anchor] [note]", s)
		}
		names = plainRe.SubexpNames()
		g := group(names, m)
		r.Path = g["path"]
		var err error
		if r.Start, r.End, err = parseRange(g["start"], g["end"]); err != nil {
			return Ref{}, err
		}
		if err := parseRest(g["rest"], &r); err != nil {
			return Ref{}, err
		}
	}

	if err := checkPath(r.Path); err != nil {
		return Ref{}, err
	}
	return r, nil
}

func group(names, m []string) map[string]string {
	g := make(map[string]string, len(names))
	for i, n := range names {
		if n != "" {
			g[n] = m[i]
		}
	}
	return g
}

func parseRange(start, end string) (int, int, error) {
	s, err := strconv.Atoi(start)
	if err != nil {
		return 0, 0, errf(CodeRefSyntax, "bad start line %q", start)
	}
	e := s
	if end != "" {
		if e, err = strconv.Atoi(end); err != nil {
			return 0, 0, errf(CodeRefSyntax, "bad end line %q", end)
		}
	}
	if s < 1 || e < s {
		return 0, 0, errf(CodeRefRange, "invalid range %d-%d: want 1 <= start <= end", s, e)
	}
	return s, e, nil
}

func parseRest(rest string, r *Ref) error {
	rest = strings.TrimSpace(rest)
	if rest == "" {
		return nil
	}
	if strings.HasPrefix(rest, "@") {
		m := restRe.FindStringSubmatch(rest)
		g := group(restRe.SubexpNames(), m)
		if g["anchor"] == "" {
			return errf(CodeRefSyntax, "malformed anchor in %q", rest)
		}
		r.Anchor = g["anchor"]
		r.Note = g["note"]
		return nil
	}
	r.Note = rest
	return nil
}

func checkPath(p string) error {
	if strings.HasPrefix(p, "/") || strings.HasPrefix(p, `\`) {
		return errf(CodeRefPath, "path %q must be relative to the plate's repo", p)
	}
	for _, seg := range strings.FieldsFunc(p, func(r rune) bool { return r == '/' || r == '\\' }) {
		if seg == ".." {
			return errf(CodeRefPath, "path %q must not escape the repo", p)
		}
	}
	return nil
}
