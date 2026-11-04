package cmd

import (
	"encoding/json"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gianfrancodemarco/nibble/cli/skill"
)

// readTree returns path → content for every file under dir.
func readTree(t *testing.T, dir string) map[string]string {
	t.Helper()
	got := map[string]string{}
	err := filepath.WalkDir(dir, func(p string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		raw, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(dir, p)
		got[filepath.ToSlash(rel)] = string(raw)
		return nil
	})
	if err != nil {
		t.Fatalf("walking %s: %v", dir, err)
	}
	return got
}

// embeddedTree returns path → content for the embedded claude-code skill,
// keyed relative to the skill directory.
func embeddedTree(t *testing.T) map[string]string {
	t.Helper()
	want := map[string]string{}
	err := fs.WalkDir(skill.FS, "claude-code", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		raw, err := fs.ReadFile(skill.FS, p)
		if err != nil {
			return err
		}
		want[strings.TrimPrefix(p, "claude-code/")] = string(raw)
		return nil
	})
	if err != nil {
		t.Fatalf("walking embedded skill: %v", err)
	}
	return want
}

func skillDir(repo string) string {
	// git rev-parse resolves symlinks (/var → /private/var on macOS);
	// compare against the same resolved path.
	if r, err := filepath.EvalSymlinks(repo); err == nil {
		repo = r
	}
	return filepath.Join(repo, ".claude", "skills", "nibble")
}

func TestSetupFreshInstall(t *testing.T) {
	repo := gitInit(t)
	code, out, errb := run(t, Ctx{Dir: repo}, "setup")
	if code != 0 {
		t.Fatalf("setup: exit %d, %s", code, errb)
	}
	if strings.TrimSpace(out) != skillDir(repo) {
		t.Fatalf("stdout = %q, want the installed path %q", out, skillDir(repo))
	}
	got, want := readTree(t, skillDir(repo)), embeddedTree(t)
	if len(got) != len(want) {
		t.Fatalf("installed %d files, embedded skill has %d", len(got), len(want))
	}
	for p, content := range want {
		if got[p] != content {
			t.Errorf("%s differs from the embedded copy", p)
		}
	}
}

func TestSetupJSON(t *testing.T) {
	repo := gitInit(t)
	code, out, _ := run(t, Ctx{Dir: repo}, "setup", "--json")
	if code != 0 {
		t.Fatalf("exit %d", code)
	}
	var obj struct {
		Installed string `json:"installed"`
	}
	if err := json.Unmarshal([]byte(out), &obj); err != nil || obj.Installed != skillDir(repo) {
		t.Fatalf("stdout %q: err %v, installed %q", out, err, obj.Installed)
	}
}

func TestSetupOutsideRepo(t *testing.T) {
	code, _, errb := run(t, Ctx{Dir: t.TempDir()}, "setup")
	if code != 1 || !strings.Contains(errb, "cli.repo.missing") {
		t.Fatalf("exit %d, stderr %q; want 1 with cli.repo.missing", code, errb)
	}
}

func TestSetupUnknownAgent(t *testing.T) {
	repo := gitInit(t)
	code, _, errb := run(t, Ctx{Dir: repo}, "setup", "--agent", "cursor")
	if code != 2 || !strings.Contains(errb, "claude-code") {
		t.Fatalf("exit %d, stderr %q; want 2 naming claude-code", code, errb)
	}
}

func TestSetupInUsage(t *testing.T) {
	var out, errb strings.Builder
	Main([]string{"help"}, &out, &errb)
	if !strings.Contains(out.String(), "setup") {
		t.Fatal("usage does not mention setup")
	}
}

func mustSetup(t *testing.T, repo string) {
	t.Helper()
	if code, _, errb := run(t, Ctx{Dir: repo}, "setup"); code != 0 {
		t.Fatalf("setup: %s", errb)
	}
}

func TestSetupIdempotent(t *testing.T) {
	repo := gitInit(t)
	mustSetup(t, repo)
	before := map[string]time.Time{}
	err := filepath.WalkDir(skillDir(repo), func(p string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		before[p] = info.ModTime()
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	mustSetup(t, repo)
	for p, mt := range before {
		info, err := os.Stat(p)
		if err != nil {
			t.Fatalf("%s gone after re-run: %v", p, err)
		}
		if !info.ModTime().Equal(mt) {
			t.Errorf("%s rewritten on a no-op re-run", p)
		}
	}
}

func TestSetupRestoresEditedFile(t *testing.T) {
	repo := gitInit(t)
	mustSetup(t, repo)
	skillMD := filepath.Join(skillDir(repo), "SKILL.md")
	if err := os.WriteFile(skillMD, []byte("hand edit\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	mustSetup(t, repo)
	got, err := os.ReadFile(skillMD)
	if err != nil {
		t.Fatal(err)
	}
	if want := embeddedTree(t)["SKILL.md"]; string(got) != want {
		t.Fatal("hand-edited SKILL.md not restored to the embedded content")
	}
}

func TestSetupRemovesStaleAndSparesNeighbors(t *testing.T) {
	repo := gitInit(t)
	mustSetup(t, repo)
	// A file the embedded skill does not ship, inside the skill dir: removed.
	stale := filepath.Join(skillDir(repo), "examples", "old.json")
	if err := os.WriteFile(stale, []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	// A neighbor elsewhere under .claude/: never touched.
	neighbor := filepath.Join(skillDir(repo), "..", "other-skill", "SKILL.md")
	if err := os.MkdirAll(filepath.Dir(neighbor), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(neighbor, []byte("mine\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	mustSetup(t, repo)
	if _, err := os.Stat(stale); !os.IsNotExist(err) {
		t.Errorf("stale %s survived the sync", stale)
	}
	if raw, err := os.ReadFile(neighbor); err != nil || string(raw) != "mine\n" {
		t.Errorf("neighbor skill touched: %v %q", err, raw)
	}
}
