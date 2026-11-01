package cmd

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// run drives Main in-process with buffers and a controlled Ctx.
func run(t *testing.T, ctx Ctx, args ...string) (int, string, string) {
	t.Helper()
	var out, errb bytes.Buffer
	c := ctx
	c.Stdout, c.Stderr = &out, &errb
	if c.Dir == "" {
		c.Dir = t.TempDir()
	}
	var code int
	if len(args) == 0 {
		code = Main(nil, &out, &errb)
	} else {
		switch args[0] {
		case "new":
			code = RunNew(c, args[1:])
		case "add":
			code = RunAdd(c, args[1:])
		case "done":
			code = RunDone(c, args[1:])
		case "lint":
			code = RunLint(c, args[1:])
		case "serve":
			code = RunServe(c, args[1:])
		default:
			code = Main(args, &out, &errb)
		}
	}
	return code, out.String(), errb.String()
}

func TestDispatcherUnknownCommand(t *testing.T) {
	var out, errb bytes.Buffer
	code := Main([]string{"frobnicate"}, &out, &errb)
	if code != 2 {
		t.Fatalf("exit = %d, want 2", code)
	}
	if out.Len() != 0 {
		t.Fatalf("stdout should be empty, got %q", out.String())
	}
	if !strings.Contains(errb.String(), "usage:") {
		t.Fatalf("stderr should carry usage, got %q", errb.String())
	}
}

func TestDispatcherNoArgs(t *testing.T) {
	var out, errb bytes.Buffer
	if code := Main(nil, &out, &errb); code != 2 {
		t.Fatalf("exit = %d, want 2", code)
	}
}

// gitInit builds a real repo: main with two files, a feat branch that edits
// one and adds one, plus an uncommitted worktree edit.
func gitInit(t *testing.T) string {
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
	write := func(path, content string) {
		t.Helper()
		p := filepath.Join(dir, path)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	git("init", "-q", "-b", "main")
	write("src/prices.ts", "a\nb\nttl: 3600\ncache.set()\ne\n")
	write("src/pool.ts", "pool = 20\nidle = 30\n")
	git("add", ".")
	git("commit", "-q", "-m", "init")
	git("checkout", "-q", "-b", "feat")
	write("src/prices.ts", "a\nb\nttl: jitter(3600)\ncache.set()\ne\n")
	write("src/retry.ts", "retry once\nthen fail\n")
	git("add", ".")
	git("commit", "-q", "-m", "jitter")
	git("checkout", "-q", "main")
	write("src/pool.ts", "pool = 40\nidle = 30\n") // uncommitted worktree edit
	return dir
}

func TestGitRepo(t *testing.T) {
	dir := gitInit(t)
	g, err := openGit(filepath.Join(dir, "src"))
	if err != nil {
		t.Fatalf("openGit: %v", err)
	}
	root, err := g.Root()
	if err != nil || !strings.HasSuffix(root, filepath.Base(dir)) {
		t.Fatalf("Root = %q, %v", root, err)
	}
	head, err := g.Head()
	if err != nil || len(head) < 7 {
		t.Fatalf("Head = %q, %v", head, err)
	}
	// Committed side of a range.
	content, ok, err := g.Show("feat", "src/retry.ts")
	if err != nil || !ok || !strings.Contains(string(content), "retry once") {
		t.Fatalf("Show(feat, retry.ts) = %q ok=%v err=%v", content, ok, err)
	}
	// Path absent on a side.
	_, ok, err = g.Show("main", "src/retry.ts")
	if err != nil || ok {
		t.Fatalf("Show(main, retry.ts) ok=%v err=%v, want ok=false", ok, err)
	}
	// HEAD side differs from worktree edit.
	content, ok, err = g.Show("HEAD", "src/pool.ts")
	if err != nil || !ok || !strings.Contains(string(content), "pool = 20") {
		t.Fatalf("Show(HEAD, pool.ts) = %q ok=%v err=%v", content, ok, err)
	}
	if _, err := openGit(t.TempDir()); err == nil {
		t.Fatal("openGit outside a repo should fail")
	}
}
