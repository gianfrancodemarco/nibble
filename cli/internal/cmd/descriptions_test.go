package cmd

import (
	"strings"
	"testing"

	"github.com/gianfrancodemarco/nibble/cli/internal/protocol"
)

// words builds a text of exactly n words.
func words(n int) string {
	return strings.TrimSpace(strings.Repeat("word ", n))
}

func TestAddTitleRename(t *testing.T) {
	repo := gitInit(t)
	ctx, plate := newTestPlate(t, repo)
	visual := writeFile(t, t.TempDir(), "map.json", testMap)

	t.Run("--title writes the nibble title", func(t *testing.T) {
		code, _, errb := run(t, ctx, "add", plate, "--title", "the claim", "--visual", visual)
		if code != 0 {
			t.Fatalf("exit = %d, stderr = %s", code, errb)
		}
		p, err := protocol.ParsePlate(plate)
		if err != nil || p.Nibbles[0].Title != "the claim" {
			t.Fatalf("plate after add: %v, %+v", err, p.Nibbles)
		}
	})

	t.Run("--caption is a usage error naming --title", func(t *testing.T) {
		code, _, errb := run(t, ctx, "add", plate, "--caption", "old flag", "--visual", visual)
		if code != 2 {
			t.Fatalf("exit = %d, want 2 (stderr %s)", code, errb)
		}
		if !strings.Contains(errb, "--title") {
			t.Fatalf("usage error should name --title: %s", errb)
		}
	})
}

func TestAddDescriptions(t *testing.T) {
	repo := gitInit(t)
	ctx, plate := newTestPlate(t, repo)
	visual := writeFile(t, t.TempDir(), "map.json", testMap)

	t.Run("both variants stored", func(t *testing.T) {
		code, _, errb := run(t, ctx, "add", plate, "--title", "c", "--visual", visual,
			"--description", "the skim", "--description-standard", "the full story")
		if code != 0 {
			t.Fatalf("exit = %d, stderr = %s", code, errb)
		}
		p, err := protocol.ParsePlate(plate)
		if err != nil {
			t.Fatal(err)
		}
		d := p.Nibbles[len(p.Nibbles)-1].Description
		if d == nil || d.Overview != "the skim" || d.Standard != "the full story" {
			t.Fatalf("description = %+v", d)
		}
	})

	t.Run("standard alone rejected", func(t *testing.T) {
		code, _, errb := run(t, ctx, "add", plate, "--title", "c", "--visual", visual,
			"--description-standard", "only long")
		if code != 1 || !strings.Contains(errb, "nibble.description") {
			t.Fatalf("exit = %d, stderr = %s", code, errb)
		}
	})

	t.Run("overview budget is 100", func(t *testing.T) {
		code, _, errb := run(t, ctx, "add", plate, "--title", "c", "--visual", visual,
			"--description", words(101))
		if code != 1 || !strings.Contains(errb, "cli.budget") || !strings.Contains(errb, "100") {
			t.Fatalf("exit = %d, stderr = %s", code, errb)
		}
	})

	t.Run("standard budget is 250", func(t *testing.T) {
		code, _, errb := run(t, ctx, "add", plate, "--title", "c", "--visual", visual,
			"--description", "skim", "--description-standard", words(251))
		if code != 1 || !strings.Contains(errb, "cli.budget") || !strings.Contains(errb, "250") {
			t.Fatalf("exit = %d, stderr = %s", code, errb)
		}
	})

	t.Run("title budget names 40 under the new flag", func(t *testing.T) {
		code, _, errb := run(t, ctx, "add", plate, "--title", words(41), "--visual", visual)
		if code != 1 || !strings.Contains(errb, "cli.budget") || !strings.Contains(errb, "40") {
			t.Fatalf("exit = %d, stderr = %s", code, errb)
		}
	})
}

func TestNewDescriptions(t *testing.T) {
	repo := gitInit(t)

	t.Run("variants stored on plate.json", func(t *testing.T) {
		ctx := Ctx{Dir: repo, Home: t.TempDir()}
		code, out, errb := run(t, ctx, "new", "--title", "t",
			"--description", "the gist", "--description-standard", "the full story")
		if code != 0 {
			t.Fatalf("exit = %d, stderr = %s", code, errb)
		}
		p, err := protocol.ParsePlate(strings.TrimSpace(out))
		if err != nil {
			t.Fatal(err)
		}
		d := p.Header.Description
		if d == nil || d.Overview != "the gist" || d.Standard != "the full story" {
			t.Fatalf("header description = %+v", d)
		}
	})

	t.Run("standard alone rejected", func(t *testing.T) {
		ctx := Ctx{Dir: repo, Home: t.TempDir()}
		code, _, errb := run(t, ctx, "new", "--title", "t", "--description-standard", "only long")
		if code != 1 || !strings.Contains(errb, "plate.description") {
			t.Fatalf("exit = %d, stderr = %s", code, errb)
		}
	})

	t.Run("overview budget with because stored on the header", func(t *testing.T) {
		ctx := Ctx{Dir: repo, Home: t.TempDir()}
		code, _, errb := run(t, ctx, "new", "--title", "t", "--description", words(101))
		if code != 1 || !strings.Contains(errb, "cli.budget") {
			t.Fatalf("over budget: exit = %d, stderr = %s", code, errb)
		}
		code, out, errb := run(t, ctx, "new", "--title", "t", "--description", words(101),
			"--because", "the incident needs the context")
		if code != 0 {
			t.Fatalf("because override: exit = %d, stderr = %s", code, errb)
		}
		p, err := protocol.ParsePlate(strings.TrimSpace(out))
		if err != nil || p.Header.Because != "the incident needs the context" {
			t.Fatalf("header because: %v, %+v", err, p.Header)
		}
	})

	t.Run("standard description budget enforced on new", func(t *testing.T) {
		ctx := Ctx{Dir: repo, Home: t.TempDir()}
		code, _, errb := run(t, ctx, "new", "--title", "t",
			"--description", "skim", "--description-standard", words(251))
		if code != 1 || !strings.Contains(errb, "cli.budget") || !strings.Contains(errb, "250") {
			t.Fatalf("exit = %d, stderr = %s", code, errb)
		}
	})
}
