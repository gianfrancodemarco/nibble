package cmd

import (
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gianfrancodemarco/nibble/cli/skill"
	"github.com/gianfrancodemarco/nibble/cli/internal/protocol"
)

// TestSkillTranscript executes the command sequence SKILL.md shows under
// "## A worked review" against a repo shaped like the one the transcript
// describes. The transcript is parsed out of the embedded skill, so prose
// and reality cannot drift apart: every command must exit 0 and the plate
// must end sealed at 4 nibbles.
func TestSkillTranscript(t *testing.T) {
	raw, err := fs.ReadFile(skill.FS, "claude-code/SKILL.md")
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
	err = fs.WalkDir(skill.FS, "claude-code/examples", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		raw, err := fs.ReadFile(skill.FS, p)
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

// TestSkillConversationTranscript executes "## A worked conversation": the
// review rounds the transcript shows (fenced ```json review.json blocks,
// written at the point they appear) and the `nibble reply` commands that
// answer them, on the plate the authoring transcript built. Every command
// must exit 0 and the plate must end with two answered rounds.
func TestSkillConversationTranscript(t *testing.T) {
	raw, err := fs.ReadFile(skill.FS, "claude-code/SKILL.md")
	if err != nil {
		t.Fatalf("embedded SKILL.md: %v", err)
	}
	section := sectionBody(t, string(raw), "## A worked conversation")
	actions := transcriptActions(t, section)
	files, replies := 0, 0
	for _, a := range actions {
		if a.file != "" {
			files++
		} else if a.args[0] == "reply" {
			replies++
		}
	}
	if files < 2 || replies < 3 {
		t.Fatalf("transcript has %d review files and %d replies; want two rounds answered", files, replies)
	}

	// The plate the authoring transcript built, sealed at 4 nibbles.
	repo := skillRepo(t)
	ctx := Ctx{Dir: repo, Home: t.TempDir()}
	plate := buildSkillPlate(t, ctx, string(raw))

	for _, a := range actions {
		if a.file != "" {
			if err := os.WriteFile(filepath.Join(plate, a.file), []byte(a.body), 0o644); err != nil {
				t.Fatal(err)
			}
			continue
		}
		args := a.args
		if args[0] == "serve" {
			continue // the wait is TestEndToEnd's job; the files above stand in for it
		}
		for i, v := range args {
			if v == "<plate>" {
				args[i] = plate
			}
		}
		code, _, errb := run(t, ctx, args...)
		if code != 0 {
			t.Fatalf("nibble %v: exit %d\n%s", args, code, errb)
		}
	}
	p, err := protocol.ParsePlate(plate)
	if err != nil {
		t.Fatalf("final plate: %v", err)
	}
	if len(p.Rounds) != 2 || p.Turn() != protocol.TurnReader {
		t.Fatalf("plate has %d rounds, turn %q; want 2 answered rounds", len(p.Rounds), p.Turn())
	}
	if h := p.History(2, 1); len(h) != 2 {
		t.Fatalf("round 2's comment should continue a thread with two messages of history, got %d", len(h))
	}
}

// sectionBody returns the body of a "## heading" section: up to the next
// heading outside fenced code blocks (a transcript's printed review carries
// "## n2:s4" lines of its own).
func sectionBody(t *testing.T, md, heading string) string {
	t.Helper()
	_, section, ok := strings.Cut(md, heading)
	if !ok {
		t.Fatalf("SKILL.md lost its %q section", heading)
	}
	var out []string
	fenced := false
	for _, line := range strings.Split(section, "\n") {
		if strings.HasPrefix(strings.TrimSpace(line), "```") {
			fenced = !fenced
		}
		if !fenced && strings.HasPrefix(line, "## ") {
			break
		}
		out = append(out, line)
	}
	return strings.Join(out, "\n")
}

// transcriptAction is one step of a transcript: a `$ nibble …` command, or
// a fenced ```json <file> block to write into the plate.
type transcriptAction struct {
	args []string
	file string
	body string
}

// transcriptActions parses a transcript section into its steps, in order.
func transcriptActions(t *testing.T, md string) []transcriptAction {
	t.Helper()
	var out []transcriptAction
	lines := strings.Split(md, "\n")
	for i := 0; i < len(lines); i++ {
		trimmed := strings.TrimSpace(lines[i])
		if strings.HasPrefix(trimmed, "```json ") {
			file := strings.TrimSpace(strings.TrimPrefix(trimmed, "```json "))
			var body []string
			for i++; i < len(lines) && strings.TrimSpace(lines[i]) != "```"; i++ {
				body = append(body, lines[i])
			}
			out = append(out, transcriptAction{file: file, body: strings.Join(body, "\n") + "\n"})
			continue
		}
		if strings.HasPrefix(trimmed, "$ ") {
			cmd := strings.TrimPrefix(trimmed, "$ ")
			for strings.HasSuffix(cmd, "\\") && i+1 < len(lines) {
				i++
				cmd = strings.TrimSuffix(cmd, "\\") + " " + strings.TrimSpace(lines[i])
			}
			// drop a trailing shell comment
			if k := strings.Index(cmd, " #"); k >= 0 {
				cmd = cmd[:k]
			}
			words := shellWords(t, cmd)
			if len(words) > 1 && words[0] == "nibble" {
				out = append(out, transcriptAction{args: words[1:]})
			}
		}
	}
	return out
}

// buildSkillPlate runs the authoring transcript ("## A worked review") and
// returns the sealed plate it produced.
func buildSkillPlate(t *testing.T, ctx Ctx, skillMD string) string {
	t.Helper()
	section := sectionBody(t, skillMD, "## A worked review")
	visuals := t.TempDir()
	err := fs.WalkDir(skill.FS, "claude-code/examples", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		raw, err := fs.ReadFile(skill.FS, p)
		if err != nil {
			return err
		}
		return os.WriteFile(filepath.Join(visuals, filepath.Base(p)), raw, 0o644)
	})
	if err != nil {
		t.Fatalf("extracting example visuals: %v", err)
	}
	var plate string
	for _, args := range transcriptCommands(t, section) {
		if args[0] == "serve" {
			continue
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
	return plate
}
