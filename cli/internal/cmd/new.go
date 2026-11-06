package cmd

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

var rangeRe = regexp.MustCompile(`^[^.\s]+\.\.[^.\s]+$`)

// RunNew creates a fresh plate and prints its path.
func RunNew(ctx Ctx, args []string) int {
	fs := flag.NewFlagSet("new", flag.ContinueOnError)
	fs.SetOutput(ctx.Stderr)
	title := fs.String("title", "", "plate title (required)")
	description := fs.String("description", "", "overview description (markdown, ≤100 words)")
	descStandard := fs.String("description-standard", "", "standard-level description (markdown, ≤250 words)")
	because := fs.String("because", "", "reason for exceeding a budget")
	about := fs.String("about", "code", "code | worktree | <base>..<head>")
	jsonOut := fs.Bool("json", false, "machine output")
	if err := fs.Parse(args); err != nil {
		return 2
	}
	if *title == "" {
		fmt.Fprintln(ctx.Stderr, "nibble new: --title is required")
		return 2
	}
	desc, err := descriptionValue(*description, *descStandard, "plate.description")
	if err != nil {
		return fail(ctx, *jsonOut, err)
	}
	if *because == "" {
		if err := checkDescriptionBudgets(*description, *descStandard); err != nil {
			return fail(ctx, *jsonOut, err)
		}
	}
	var aboutJSON any
	switch {
	case *about == "code" || *about == "worktree":
		aboutJSON = *about
	case rangeRe.MatchString(*about):
		aboutJSON = map[string]string{"range": *about}
	default:
		fmt.Fprintf(ctx.Stderr, "nibble new: --about %q: want code, worktree or <base>..<head>\n", *about)
		return 2
	}

	g, err := openGit(ctx.Dir)
	if err != nil {
		return fail(ctx, *jsonOut, err)
	}
	root, err := g.Root()
	if err != nil {
		return fail(ctx, *jsonOut, err)
	}
	head, err := g.Head()
	if err != nil {
		return fail(ctx, *jsonOut, err)
	}

	plates, err := ctx.PlatesDir()
	if err != nil {
		return fail(ctx, *jsonOut, err)
	}
	var rnd [2]byte
	if _, err := rand.Read(rnd[:]); err != nil {
		return fail(ctx, *jsonOut, err)
	}
	now := time.Now()
	dir := filepath.Join(plates, fmt.Sprintf("p-%s-%s", now.Format("20060102-150405"), hex.EncodeToString(rnd[:])))
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fail(ctx, *jsonOut, err)
	}

	header := map[string]any{
		"version":    1,
		"title":      *title,
		"repo":       root,
		"head_sha":   head,
		"about":      aboutJSON,
		"created_at": now.Format(time.RFC3339),
	}
	if desc != nil {
		header["description"] = desc
	}
	if *because != "" {
		header["because"] = *because
	}
	raw, err := json.MarshalIndent(header, "", "  ")
	if err != nil {
		return fail(ctx, *jsonOut, err)
	}
	if err := writeAtomic(filepath.Join(dir, "plate.json"), append(raw, '\n')); err != nil {
		return fail(ctx, *jsonOut, err)
	}

	if *jsonOut {
		emit(ctx, true, map[string]any{"plate": dir}, "")
	} else {
		fmt.Fprintln(ctx.Stdout, dir)
	}
	return 0
}

// writeAtomic writes via temp file + rename so no consumer ever observes a
// half-written protocol file.
func writeAtomic(path string, data []byte) error {
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		os.Remove(tmp)
		return err
	}
	return nil
}

// wordCount counts words in budgeted text after stripping light markdown.
func wordCount(text string) int {
	stripped := strings.NewReplacer("*", "", "_", "", "`", "", "#", "", ">", "", "[", " ", "]", " ", "(", " ", ")", " ").Replace(text)
	return len(strings.Fields(stripped))
}
