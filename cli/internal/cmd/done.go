package cmd

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/gianfrancodemarco/nibble/cli/internal/protocol"
)

// RunDone seals a plate: no more nibbles after this.
func RunDone(ctx Ctx, args []string) int {
	plateDir, args := popArg(args)
	fs := flag.NewFlagSet("done", flag.ContinueOnError)
	fs.SetOutput(ctx.Stderr)
	jsonOut := fs.Bool("json", false, "machine output")
	check := fs.Bool("check", false, "print the would-be ledger without sealing")
	if err := fs.Parse(args); err != nil {
		return 2
	}
	if plateDir == "" {
		plateDir = fs.Arg(0)
	}
	if plateDir == "" {
		fmt.Fprintln(ctx.Stderr, "nibble done: <plate> is required")
		return 2
	}

	unlock, err := lockDir(plateDir)
	if err != nil {
		return fail(ctx, *jsonOut, err)
	}
	defer unlock()

	plate, err := protocol.ParsePlate(plateDir)
	if err != nil {
		return fail(ctx, *jsonOut, err)
	}

	if *check { // preview the coverage check: print, write nothing
		if plate.Header.About.Kind != "worktree" && plate.Header.About.Kind != "range" {
			emit(ctx, *jsonOut, map[string]any{"sealed": !plate.Open},
				fmt.Sprintf("nothing to check: an about: %s plate has no diff for a ledger to cover", plate.Header.About.Kind))
			return 0
		}
		ledger := plate.Ledger // a sealed plate's ledger is what it is
		if plate.Open {
			if ledger, err = computeLedger(plate); err != nil {
				return fail(ctx, *jsonOut, err)
			}
		}
		human := ledgerLine(ledger)
		for _, h := range ledger.Hunks {
			if !h.Covered {
				human += "\n  " + hunkLine(h)
			}
		}
		emit(ctx, *jsonOut, map[string]any{"sealed": !plate.Open, "ledger": ledger}, human)
		return 0
	}

	if !plate.Open { // already sealed: idempotent success, ledger as sealed
		out := map[string]any{"total": plate.Total, "sealed": true}
		if plate.Ledger != nil {
			out["ledger"] = plate.Ledger
		}
		emit(ctx, *jsonOut, out, "")
		return 0
	}
	if len(plate.Nibbles) == 0 {
		return fail(ctx, *jsonOut, errf(CodePlateEmpty, "%s has no nibbles: add at least one before sealing", plateDir))
	}

	// The coverage check: a plate about a diff never seals unchecked.
	ledger, err := computeLedger(plate)
	if err != nil {
		return fail(ctx, *jsonOut, err)
	}
	if ledger != nil {
		raw, err := json.MarshalIndent(ledger, "", "  ")
		if err != nil {
			return fail(ctx, *jsonOut, err)
		}
		if err := writeAtomic(filepath.Join(plateDir, "ledger.json"), append(raw, '\n')); err != nil {
			return fail(ctx, *jsonOut, err)
		}
	}

	marker := fmt.Sprintf("{\"total\": %d}\n", len(plate.Nibbles))
	if err := writeAtomic(filepath.Join(plateDir, "done"), []byte(marker)); err != nil {
		return fail(ctx, *jsonOut, err)
	}
	out := map[string]any{"total": len(plate.Nibbles), "sealed": true}
	human := fmt.Sprintf("✓ sealed at %d nibbles", len(plate.Nibbles))
	if ledger != nil {
		out["ledger"] = ledger
		human += " · " + ledgerLine(ledger)
	}
	emit(ctx, *jsonOut, out, human)
	return 0
}

// ledgerLine is the one-line human summary of a ledger.
func ledgerLine(l *protocol.Ledger) string {
	if l.Shown == l.Total {
		return fmt.Sprintf("ledger: every hunk of the diff was shown (%d of %d)", l.Shown, l.Total)
	}
	return fmt.Sprintf("ledger: %d of %d hunks not shown", l.Total-l.Shown, l.Total)
}

// hunkLine is one hunk of --check output: `<path>:<start>[-<end>]` plus the
// counts and side, precise enough to write a covering ref from.
func hunkLine(h protocol.LedgerHunk) string {
	loc := fmt.Sprintf("%s:%d", h.Path, h.Start)
	if h.End > h.Start {
		loc += fmt.Sprintf("-%d", h.End)
	}
	switch {
	case h.Binary:
		return loc + " (binary, " + h.Side + ")"
	default:
		return fmt.Sprintf("%s (+%d −%d, %s)", loc, h.Added, h.Removed, h.Side)
	}
}

// computeLedger runs the coverage check for a plate about a diff the CLI can
// resolve (worktree, range); nil for other plates. The diff comes from git,
// never from the agent.
func computeLedger(plate *protocol.Plate) (*protocol.Ledger, error) {
	about := plate.Header.About
	if about.Kind != "worktree" && about.Kind != "range" {
		return nil, nil
	}
	g, err := openGit(plate.Header.Repo)
	if err != nil {
		return nil, err
	}
	var hunks []protocol.DiffHunk
	switch about.Kind {
	case "worktree":
		raw, err := g.DiffWorktree()
		if err != nil {
			return nil, err
		}
		if hunks, err = protocol.ParseUnifiedDiff(raw); err != nil {
			return nil, err
		}
		untracked, err := g.Untracked()
		if err != nil {
			return nil, err
		}
		for _, p := range untracked {
			h, ok, err := untrackedHunk(plate.Header.Repo, p)
			if err != nil {
				return nil, err
			}
			if ok {
				hunks = append(hunks, h)
			}
		}
	case "range":
		base, head, ok := strings.Cut(about.Range, "..")
		if !ok {
			return nil, errf(CodeLedger, "about range %q: want <base>..<head>", about.Range)
		}
		raw, err := g.DiffRange(base, head)
		if err != nil {
			return nil, err
		}
		if hunks, err = protocol.ParseUnifiedDiff(raw); err != nil {
			return nil, err
		}
	}
	var refs []protocol.Ref
	for _, nb := range plate.Nibbles {
		for _, nr := range nb.Refs {
			ref, err := protocol.ParseRef(nr.Ref)
			if err != nil {
				return nil, err
			}
			refs = append(refs, ref)
		}
	}
	ledger := protocol.Coverage(hunks, refs)
	return &ledger, nil
}

// untrackedHunk turns an untracked file into a fully added head-side hunk.
// An empty file has nothing to show (ok false); a file with NUL bytes is a
// binary hunk.
func untrackedHunk(root, path string) (protocol.DiffHunk, bool, error) {
	raw, err := os.ReadFile(filepath.Join(root, path))
	if err != nil {
		return protocol.DiffHunk{}, false, errf(CodeLedger, "untracked %s: %v", path, err)
	}
	if len(raw) == 0 {
		return protocol.DiffHunk{}, false, nil
	}
	if bytes.IndexByte(raw, 0) >= 0 {
		return protocol.DiffHunk{Path: path, Binary: true}, true, nil
	}
	n := len(protocol.SplitLines(raw).Lines)
	return protocol.DiffHunk{Path: path, HeadStart: 1, HeadLines: n}, true, nil
}

// RunLint validates a visual document standalone.
func RunLint(ctx Ctx, args []string) int {
	path, args := popArg(args)
	fs := flag.NewFlagSet("lint", flag.ContinueOnError)
	fs.SetOutput(ctx.Stderr)
	jsonOut := fs.Bool("json", false, "machine output")
	if err := fs.Parse(args); err != nil {
		return 2
	}
	if path == "" {
		path = fs.Arg(0)
	}
	if path == "" {
		fmt.Fprintln(ctx.Stderr, "nibble lint: <visual.json> is required")
		return 2
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return fail(ctx, *jsonOut, err)
	}
	if err := protocol.ValidateVisual(raw); err != nil {
		return fail(ctx, *jsonOut, err)
	}
	emit(ctx, *jsonOut, map[string]any{"valid": true}, "✓ valid")
	return 0
}
