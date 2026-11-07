package cmd

import (
	"bytes"
	"fmt"
	"os/exec"
	"strings"
)

// gitRepo is the slice of git the CLI needs; an interface so tests can fake
// it where a real repo is overkill.
type gitRepo interface {
	Root() (string, error)
	Head() (string, error)
	// Show returns the content of path at rev. ok is false when the path
	// does not exist at that rev (which is an answer, not an error).
	Show(rev, path string) (content []byte, ok bool, err error)
	// DiffWorktree is the uncommitted diff (staged + unstaged, HEAD → disk)
	// as -U0 unified diff text; untracked files are not in it.
	DiffWorktree() ([]byte, error)
	// DiffRange is the -U0 unified diff between two revs, renames detected.
	DiffRange(base, head string) ([]byte, error)
	// Untracked lists files git does not know, .gitignore respected,
	// repo-relative.
	Untracked() ([]string, error)
}

// realGit shells out to git, anchored at a directory.
type realGit struct{ dir string }

// openGit finds the repository containing dir.
func openGit(dir string) (gitRepo, error) {
	g := realGit{dir: dir}
	if _, err := g.Root(); err != nil {
		return nil, errf(CodeRepoMissing, "%s is not inside a git repository", dir)
	}
	return g, nil
}

func (g realGit) run(args ...string) ([]byte, []byte, error) {
	cmd := exec.Command("git", append([]string{"-C", g.dir}, args...)...)
	var out, errb bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &errb
	err := cmd.Run()
	return out.Bytes(), errb.Bytes(), err
}

func (g realGit) Root() (string, error) {
	out, errb, err := g.run("rev-parse", "--show-toplevel")
	if err != nil {
		return "", fmt.Errorf("git rev-parse: %v: %s", err, errb)
	}
	return strings.TrimSpace(string(out)), nil
}

func (g realGit) Head() (string, error) {
	out, errb, err := g.run("rev-parse", "HEAD")
	if err != nil {
		return "", fmt.Errorf("git rev-parse HEAD: %v: %s", err, errb)
	}
	return strings.TrimSpace(string(out)), nil
}

func (g realGit) DiffWorktree() ([]byte, error) {
	out, errb, err := g.run("diff", "-U0", "--no-color", "-M", "HEAD")
	if err != nil {
		return nil, errf(CodeLedger, "git diff HEAD failed: %v: %s", err, strings.TrimSpace(string(errb)))
	}
	return out, nil
}

func (g realGit) DiffRange(base, head string) ([]byte, error) {
	out, errb, err := g.run("diff", "-U0", "--no-color", "-M", base, head)
	if err != nil {
		return nil, errf(CodeLedger, "git diff %s %s failed: %v: %s", base, head, err, strings.TrimSpace(string(errb)))
	}
	return out, nil
}

func (g realGit) Untracked() ([]string, error) {
	out, errb, err := g.run("ls-files", "--others", "--exclude-standard")
	if err != nil {
		return nil, errf(CodeLedger, "git ls-files failed: %v: %s", err, strings.TrimSpace(string(errb)))
	}
	fields := strings.Split(strings.TrimRight(string(out), "\n"), "\n")
	var files []string
	for _, f := range fields {
		if f != "" {
			files = append(files, f)
		}
	}
	return files, nil
}

func (g realGit) Show(rev, path string) ([]byte, bool, error) {
	out, errb, err := g.run("show", rev+":"+path)
	if err != nil {
		msg := string(errb)
		if strings.Contains(msg, "does not exist") || strings.Contains(msg, "exists on disk, but not in") {
			return nil, false, nil
		}
		return nil, false, fmt.Errorf("git show %s:%s: %v: %s", rev, path, err, msg)
	}
	return out, true, nil
}
