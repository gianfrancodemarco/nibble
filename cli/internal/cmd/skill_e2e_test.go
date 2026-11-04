package cmd

import (
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gianfrancodemarco/nibble/cli/internal/cmd/skillfs"
	"github.com/gianfrancodemarco/nibble/cli/internal/protocol"
)

// TestSkillTranscript executes the command sequence SKILL.md shows under
// "## A worked review" against a repo shaped like the one the transcript
// describes. The transcript is parsed out of the embedded skill, so prose
// and reality cannot drift apart: every command must exit 0 and the plate
// must end sealed at 4 nibbles.
func TestSkillTranscript(t *testing.T) {
	raw, err := fs.ReadFile(skillfs.FS, "claude-code/SKILL.md")
	if err != nil {
		t.Fatalf("embedded SKILL.md: %v", err)
	}
	_, section, ok := strings.Cut(string(raw), "## A worked review")
	if !ok {
		t.Fatal(`SKILL.md lost its "## A worked review" section`)
	}
	if next := strings.Index(section, "\n## "); next >= 0 {
		section = section[:next]
	}
	cmds := transcriptCommands(t, section)
	if len(cmds) < 6 {
		t.Fatalf("transcript has %d commands, want new + 4 adds + done (+ serve)", len(cmds))
	}

	repo := skillRepo(t)
	ctx := Ctx{Dir: repo, Home: t.TempDir()}

	// The transcript says to write each visual to a file first.
	visuals := t.TempDir()
	err = fs.WalkDir(skillfs.FS, "claude-code/examples", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		raw, err := fs.ReadFile(skillfs.FS, p)
		if err != nil {
			return err
		}
		return os.WriteFile(filepath.Join(visuals, filepath.Base(p)), raw, 0o644)
	})
	if err != nil {
		t.Fatalf("extracting example visuals: %v", err)
	}

	var plate string
	for _, args := range cmds {
		if args[0] == "serve" {
			continue // the review loop is TestEndToEnd's job
		}
		for i, a := range args {
			switch {
			case a == "<plate>":
				args[i] = plate
			case strings.HasSuffix(a, ".json") && !strings.Contains(a, string(os.PathSeparator)):
				args[i] = filepath.Join(visuals, a)
			}
		}
		code, out, errb := run(t, ctx, args...)
		if code != 0 {
			t.Fatalf("nibble %v: exit %d\n%s", args, code, errb)
		}
		if args[0] == "new" {
			plate = strings.TrimSpace(out)
		}
	}

	p, err := protocol.ParsePlate(plate)
	if err != nil {
		t.Fatalf("final plate: %v", err)
	}
	if len(p.Nibbles) != 4 || p.Open {
		t.Fatalf("plate has %d nibbles, open=%v; want 4 sealed", len(p.Nibbles), p.Open)
	}
}

// transcriptCommands pulls every `$ nibble ...` command (with backslash
// continuations) out of SKILL.md's fenced transcript blocks.
func transcriptCommands(t *testing.T, md string) [][]string {
	t.Helper()
	var cmds [][]string
	var cur strings.Builder
	flush := func() {
		if cur.Len() == 0 {
			return
		}
		words := shellWords(t, cur.String())
		if len(words) > 1 && words[0] == "nibble" {
			cmds = append(cmds, words[1:])
		}
		cur.Reset()
	}
	continued := false
	for _, line := range strings.Split(md, "\n") {
		trimmed := strings.TrimSpace(line)
		switch {
		case strings.HasPrefix(trimmed, "$ "):
			flush()
			trimmed = strings.TrimPrefix(trimmed, "$ ")
			fallthrough
		case continued:
			if strings.HasSuffix(trimmed, "\\") {
				continued = true
				cur.WriteString(strings.TrimSuffix(trimmed, "\\"))
				cur.WriteString(" ")
			} else {
				continued = false
				cur.WriteString(trimmed)
				flush()
			}
		}
	}
	flush()
	return cmds
}

// shellWords splits a transcript line the way a shell would, far enough for
// the transcript's own grammar: bare words and double-quoted strings.
func shellWords(t *testing.T, s string) []string {
	t.Helper()
	var words []string
	var cur strings.Builder
	inQuote, inWord := false, false
	for _, r := range s {
		switch {
		case r == '"':
			inQuote = !inQuote
			inWord = true
		case r == ' ' && !inQuote:
			if inWord {
				words = append(words, cur.String())
				cur.Reset()
				inWord = false
			}
		default:
			cur.WriteRune(r)
			inWord = true
		}
	}
	if inQuote {
		t.Fatalf("unbalanced quote in transcript line: %s", s)
	}
	if inWord {
		words = append(words, cur.String())
	}
	return words
}

// skillRepo builds the repo the transcript reviews: an upload handler with
// an uncommitted edit (the worktree diff) and the new resize worker.
func skillRepo(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	git := func(args ...string) {
		t.Helper()
		cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
		cmd.Env = append(os.Environ(),
			"GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@t",
			"GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@t")
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	write := func(path string, lines int, header string) {
		t.Helper()
		var b strings.Builder
		b.WriteString(header + "\n")
		for i := 2; i <= lines; i++ {
			fmt.Fprintf(&b, "// line %d\n", i)
		}
		full := filepath.Join(dir, path)
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte(b.String()), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	git("init", "-q", "-b", "main")
	write("src/upload/handler.ts", 24, "// upload handler, resizing inline")
	write("src/worker/resize.ts", 18, "// resize worker")
	git("add", ".")
	git("commit", "-q", "-m", "before")
	// The PR under review: the handler now stores, enqueues and returns.
	write("src/upload/handler.ts", 24, "// upload handler: store, enqueue, return")
	return dir
}
