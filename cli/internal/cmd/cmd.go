// Package cmd implements the nibble subcommands as in-process functions, so
// tests drive them without exec. main() is a dispatcher around Main.
package cmd

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
)

// Ctx carries everything a command touches, so tests can fake all of it.
type Ctx struct {
	Stdout io.Writer
	Stderr io.Writer
	Dir    string // working directory (git discovery starts here)
	Home   string // plates home; empty means $NIBBLE_HOME or ~/.nibble
}

// PlatesDir resolves the directory plates live in.
func (c Ctx) PlatesDir() (string, error) {
	home := c.Home
	if home == "" {
		home = os.Getenv("NIBBLE_HOME")
	}
	if home == "" {
		h, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		home = filepath.Join(h, ".nibble")
	}
	return filepath.Join(home, "plates"), nil
}

const usage = `nibble — agent explanations you can poke

usage:
  nibble new   --title <t> [--description <md>] [--description-standard <md>]
               [--about code|worktree|<base>..<head>] [--json]
  nibble add   <plate> --title <md> [--description <md>] [--description-standard <md>]
               --visual <file.json> [--ref <ref>]... [--because <reason>] [--json]
  nibble done  <plate> [--json]
  nibble lint  <visual.json> [--json]
  nibble serve <plate> [--timeout <dur>] [--json]
  nibble setup [--agent claude-code] [--json]

exit codes: 0 ok · 1 validation/protocol error · 2 usage
serve: 0 done · 2 comments to handle · 5 timeout
`

// Main dispatches a command line. It is the whole CLI; main() only calls it.
func Main(args []string, stdout, stderr io.Writer) int {
	dir, err := os.Getwd()
	if err != nil {
		fmt.Fprintln(stderr, "error:", err)
		return 1
	}
	ctx := Ctx{Stdout: stdout, Stderr: stderr, Dir: dir}
	if len(args) == 0 {
		fmt.Fprint(stderr, usage)
		return 2
	}
	cmd, rest := args[0], args[1:]
	switch cmd {
	case "new":
		return RunNew(ctx, rest)
	case "add":
		return RunAdd(ctx, rest)
	case "done":
		return RunDone(ctx, rest)
	case "lint":
		return RunLint(ctx, rest)
	case "serve":
		return RunServe(ctx, rest)
	case "setup":
		return RunSetup(ctx, rest)
	case "help", "-h", "--help":
		fmt.Fprint(stdout, usage)
		return 0
	default:
		fmt.Fprintf(stderr, "nibble: unknown command %q\n\n%s", cmd, usage)
		return 2
	}
}
