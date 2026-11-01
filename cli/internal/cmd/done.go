package cmd

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"

	"github.com/gianfrancodemarco/nibble/cli/internal/protocol"
)

// RunDone seals a plate: no more nibbles after this.
func RunDone(ctx Ctx, args []string) int {
	plateDir, args := popArg(args)
	fs := flag.NewFlagSet("done", flag.ContinueOnError)
	fs.SetOutput(ctx.Stderr)
	jsonOut := fs.Bool("json", false, "machine output")
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
	if !plate.Open { // already sealed: idempotent success
		emit(ctx, *jsonOut, map[string]any{"total": plate.Total, "sealed": true}, "")
		return 0
	}
	if len(plate.Nibbles) == 0 {
		return fail(ctx, *jsonOut, errf(CodePlateEmpty, "%s has no nibbles: add at least one before sealing", plateDir))
	}
	marker := fmt.Sprintf("{\"total\": %d}\n", len(plate.Nibbles))
	if err := writeAtomic(filepath.Join(plateDir, "done"), []byte(marker)); err != nil {
		return fail(ctx, *jsonOut, err)
	}
	emit(ctx, *jsonOut, map[string]any{"total": len(plate.Nibbles), "sealed": true},
		fmt.Sprintf("✓ sealed at %d nibbles", len(plate.Nibbles)))
	return 0
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
