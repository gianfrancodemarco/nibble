package cmd

import (
	"flag"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/gianfrancodemarco/nibble/cli/skill"
)

// RunSetup installs the embedded agent skill into the current repository at
// .claude/skills/nibble/. The result is an exact mirror of the embedded
// skill: differing files are rewritten, files the skill no longer ships are
// removed, nothing outside that directory is touched. Re-running is a no-op.
func RunSetup(ctx Ctx, args []string) int {
	fs_ := flag.NewFlagSet("setup", flag.ContinueOnError)
	fs_.SetOutput(ctx.Stderr)
	agent := fs_.String("agent", "claude-code", "agent to install the skill for")
	jsonOut := fs_.Bool("json", false, "machine output")
	if err := fs_.Parse(args); err != nil {
		return 2
	}
	if *agent != "claude-code" {
		fmt.Fprintf(ctx.Stderr, "nibble setup: unknown agent %q; supported: claude-code\n", *agent)
		return 2
	}

	git, err := openGit(ctx.Dir)
	if err != nil {
		return fail(ctx, *jsonOut, err)
	}
	root, err := git.Root()
	if err != nil {
		return fail(ctx, *jsonOut, err)
	}
	dest := filepath.Join(root, ".claude", "skills", "nibble")

	if err := syncSkill(dest); err != nil {
		return fail(ctx, *jsonOut, err)
	}
	if *jsonOut {
		emit(ctx, true, map[string]any{"installed": dest}, "")
	} else {
		fmt.Fprintln(ctx.Stdout, dest)
	}
	return 0
}

// syncSkill makes dest an exact mirror of the embedded claude-code skill.
func syncSkill(dest string) error {
	want := map[string][]byte{}
	err := fs.WalkDir(skill.FS, "claude-code", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		raw, err := fs.ReadFile(skill.FS, p)
		if err != nil {
			return err
		}
		want[strings.TrimPrefix(p, "claude-code/")] = raw
		return nil
	})
	if err != nil {
		return err
	}

	for rel, raw := range want {
		full := filepath.Join(dest, filepath.FromSlash(rel))
		if cur, err := os.ReadFile(full); err == nil && string(cur) == string(raw) {
			continue
		}
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			return err
		}
		if err := writeAtomic(full, raw); err != nil {
			return err
		}
	}

	// Remove files the embedded skill no longer ships — inside dest only.
	err = filepath.WalkDir(dest, func(p string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		rel, err := filepath.Rel(dest, p)
		if err != nil {
			return err
		}
		if _, ok := want[filepath.ToSlash(rel)]; !ok {
			return os.Remove(p)
		}
		return nil
	})
	if err != nil {
		return err
	}
	return nil
}
