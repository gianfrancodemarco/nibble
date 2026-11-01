package cmd

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/gianfrancodemarco/nibble/cli/internal/protocol"
)

func TestRunNew(t *testing.T) {
	repo := gitInit(t)

	newPlate := func(t *testing.T, args ...string) (int, string, string) {
		t.Helper()
		ctx := Ctx{Dir: repo, Home: t.TempDir()}
		return run(t, ctx, append([]string{"new"}, args...)...)
	}

	t.Run("creates a valid open plate about code", func(t *testing.T) {
		code, out, errb := newPlate(t, "--title", "Why checkout slows")
		if code != 0 {
			t.Fatalf("exit = %d, stderr = %s", code, errb)
		}
		path := strings.TrimSpace(out)
		if path == "" || strings.ContainsRune(path, '\n') {
			t.Fatalf("stdout should be exactly the plate path, got %q", out)
		}
		p, err := protocol.ParsePlate(path)
		if err != nil {
			t.Fatalf("created plate invalid: %v", err)
		}
		if !p.Open || p.Header.About.Kind != "code" || p.Header.Title != "Why checkout slows" {
			t.Fatalf("plate = %+v", p.Header)
		}
		if len(p.Header.HeadSHA) < 7 || !strings.HasSuffix(p.Header.Repo, "/"+lastSegment(repo)) && p.Header.Repo != repo {
			t.Fatalf("header repo/head: %+v", p.Header)
		}
	})

	t.Run("about range", func(t *testing.T) {
		code, out, _ := newPlate(t, "--title", "t", "--about", "main..feat")
		if code != 0 {
			t.Fatal("exit != 0")
		}
		p, err := protocol.ParsePlate(strings.TrimSpace(out))
		if err != nil || p.Header.About.Kind != "range" || p.Header.About.Range != "main..feat" {
			t.Fatalf("about = %+v, err %v", p.Header.About, err)
		}
	})

	t.Run("about worktree", func(t *testing.T) {
		code, out, _ := newPlate(t, "--title", "t", "--about", "worktree")
		if code != 0 {
			t.Fatal("exit != 0")
		}
		p, err := protocol.ParsePlate(strings.TrimSpace(out))
		if err != nil || p.Header.About.Kind != "worktree" {
			t.Fatalf("about = %+v, err %v", p.Header.About, err)
		}
	})

	t.Run("json output", func(t *testing.T) {
		code, out, _ := newPlate(t, "--title", "t", "--json")
		if code != 0 {
			t.Fatal("exit != 0")
		}
		var obj struct {
			Plate string `json:"plate"`
		}
		if err := json.Unmarshal([]byte(out), &obj); err != nil || obj.Plate == "" {
			t.Fatalf("json out = %q, err %v", out, err)
		}
	})

	t.Run("outside a git repo", func(t *testing.T) {
		ctx := Ctx{Dir: t.TempDir(), Home: t.TempDir()}
		code, _, errb := run(t, ctx, "new", "--title", "t")
		if code != 1 || !strings.Contains(errb, "cli.repo.missing") {
			t.Fatalf("exit = %d, stderr = %q", code, errb)
		}
	})

	t.Run("missing title is a usage error", func(t *testing.T) {
		code, _, _ := newPlate(t)
		if code != 2 {
			t.Fatalf("exit = %d, want 2", code)
		}
	})
}

func lastSegment(p string) string {
	parts := strings.Split(p, "/")
	return parts[len(parts)-1]
}
