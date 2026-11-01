package cmd

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"syscall"

	"github.com/gianfrancodemarco/nibble/cli/internal/protocol"
)

// Authoring budgets. The protocol transports `because`; the CLI owns the
// numbers (see design.md: constants with tests, not architecture).
const (
	captionWordBudget = 40
	nibbleBudgetSmall = 7  // code and worktree plates
	nibbleBudgetLarge = 12 // range (PR chapter) plates
)

type stringSlice []string

func (s *stringSlice) String() string     { return fmt.Sprint(*s) }
func (s *stringSlice) Set(v string) error { *s = append(*s, v); return nil }

// popArg takes a leading positional argument off args, so commands can be
// called as `nibble <cmd> <positional> --flags…` (stdlib flag stops parsing
// at the first non-flag otherwise).
func popArg(args []string) (string, []string) {
	if len(args) > 0 && len(args[0]) > 0 && args[0][0] != '-' {
		return args[0], args[1:]
	}
	return "", args
}

// RunAdd validates and appends one nibble to a plate.
func RunAdd(ctx Ctx, args []string) int {
	plateDir, args := popArg(args)
	fs := flag.NewFlagSet("add", flag.ContinueOnError)
	fs.SetOutput(ctx.Stderr)
	caption := fs.String("caption", "", "the claim (markdown, ≤40 words)")
	visualPath := fs.String("visual", "", "visual JSON file (required)")
	because := fs.String("because", "", "reason for exceeding a budget")
	jsonOut := fs.Bool("json", false, "machine output")
	var refs stringSlice
	fs.Var(&refs, "ref", "code reference (repeatable)")
	if err := fs.Parse(args); err != nil {
		return 2
	}
	if plateDir == "" {
		plateDir = fs.Arg(0)
	}
	if plateDir == "" || *caption == "" || *visualPath == "" {
		fmt.Fprintln(ctx.Stderr, "nibble add: <plate>, --caption and --visual are required")
		return 2
	}

	plate, err := protocol.ParsePlate(plateDir)
	if err != nil {
		return fail(ctx, *jsonOut, err)
	}
	if !plate.Open {
		return fail(ctx, *jsonOut, errf("plate.sealed", "%s is sealed: a sealed plate takes no more nibbles", plateDir))
	}

	visualRaw, err := os.ReadFile(*visualPath)
	if err != nil {
		return fail(ctx, *jsonOut, err)
	}
	if err := protocol.ValidateVisual(visualRaw); err != nil {
		return fail(ctx, *jsonOut, err)
	}
	anchors := protocol.CollectAnchors(visualRaw)

	g, err := openGit(plate.Header.Repo)
	if err != nil {
		return fail(ctx, *jsonOut, err)
	}
	var stored []protocol.NibbleRef
	for _, raw := range refs {
		ref, err := protocol.ParseRef(raw)
		if err != nil {
			return fail(ctx, *jsonOut, err)
		}
		content, err := loadRefContent(plate.Header.Repo, g, ref)
		if err != nil {
			return fail(ctx, *jsonOut, err)
		}
		if err := protocol.CheckRef(ref, content); err != nil {
			return fail(ctx, *jsonOut, err)
		}
		if ref.Anchor != "" && !slices.Contains(anchors, ref.Anchor) {
			return fail(ctx, *jsonOut, errf("ref.anchor.dangling", "ref %q: no element %q in this nibble's visual", raw, ref.Anchor))
		}
		fp, err := protocol.NewFingerprint(content, ref.Start, ref.End)
		if err != nil {
			return fail(ctx, *jsonOut, err)
		}
		stored = append(stored, protocol.NibbleRef{
			Ref: raw, FP: fp.Sum, Lines: fp.Lines,
			CtxBefore: fp.CtxBefore, CtxAfter: fp.CtxAfter,
		})
	}

	// Budgets, override with a stated reason.
	budget := nibbleBudgetSmall
	if plate.Header.About.Kind == "range" || plate.Header.About.Kind == "pr" {
		budget = nibbleBudgetLarge
	}
	if *because == "" {
		if n := wordCount(*caption); n > captionWordBudget {
			return fail(ctx, *jsonOut, errf(CodeBudget,
				"caption is %d words (budget %d): tighten it, move detail into the visual, or state a reason with --because", n, captionWordBudget))
		}
		if len(plate.Nibbles)+1 > budget {
			return fail(ctx, *jsonOut, errf(CodeBudget,
				"this would be nibble %d (budget %d for a %s plate): split into chapters, or state a reason with --because", len(plate.Nibbles)+1, budget, plate.Header.About.Kind))
		}
	}

	// Serialize concurrent adds on the plate directory.
	unlock, err := lockDir(plateDir)
	if err != nil {
		return fail(ctx, *jsonOut, err)
	}
	defer unlock()

	// Re-derive N under the lock.
	fresh, err := protocol.ParsePlate(plateDir)
	if err != nil {
		return fail(ctx, *jsonOut, err)
	}
	n := len(fresh.Nibbles) + 1

	nib := map[string]any{
		"caption": *caption,
		"visual":  json.RawMessage(visualRaw),
		"refs":    stored,
	}
	if *because != "" {
		nib["because"] = *because
	}
	out, err := json.MarshalIndent(nib, "", "  ")
	if err != nil {
		return fail(ctx, *jsonOut, err)
	}
	if err := writeAtomic(filepath.Join(plateDir, fmt.Sprintf("n%d.json", n)), append(out, '\n')); err != nil {
		return fail(ctx, *jsonOut, err)
	}

	emit(ctx, *jsonOut, map[string]any{"nibble": n}, fmt.Sprintf("✓ n%d added", n))
	return 0
}

// loadRefContent resolves the content a ref must be validated against: the
// file on disk for plain and worktree refs, a git side for range refs.
// nil content (with nil error) means the file/side does not have the path.
func loadRefContent(repoRoot string, g gitRepo, ref protocol.Ref) (*protocol.FileContent, error) {
	if ref.Diff != nil && !ref.Diff.Worktree {
		rev := ref.Diff.Base
		if ref.Diff.Side == "head" {
			rev = ref.Diff.Head
		}
		raw, ok, err := g.Show(rev, ref.Path)
		if err != nil {
			return nil, err
		}
		if !ok {
			return nil, nil
		}
		return protocol.SplitLines(raw), nil
	}
	raw, err := os.ReadFile(filepath.Join(repoRoot, ref.Path))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	return protocol.SplitLines(raw), nil
}

// lockDir takes an exclusive flock on a directory.
func lockDir(dir string) (func(), error) {
	f, err := os.Open(dir)
	if err != nil {
		return nil, err
	}
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX); err != nil {
		f.Close()
		return nil, err
	}
	return func() {
		syscall.Flock(int(f.Fd()), syscall.LOCK_UN)
		f.Close()
	}, nil
}
