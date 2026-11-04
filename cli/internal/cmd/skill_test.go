package cmd

import (
	"io/fs"
	"path"
	"strings"
	"testing"

	"github.com/gianfrancodemarco/nibble/cli/skill"
	"github.com/gianfrancodemarco/nibble/cli/internal/protocol"
)

// The embedded Claude Code skill is a complete package: SKILL.md plus at
// least one worked example visual per v1 kind, every one of them valid
// protocol JSON — the examples double as conformance fixtures.
func TestSkillPackageComplete(t *testing.T) {
	if _, err := fs.ReadFile(skill.FS, "claude-code/SKILL.md"); err != nil {
		t.Fatalf("claude-code/SKILL.md missing from embedded skill: %v", err)
	}
	kinds := map[string]bool{"map": false, "sequence": false, "timeline": false, "compare": false}
	err := fs.WalkDir(skill.FS, "claude-code", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || path.Ext(p) != ".json" {
			return err
		}
		raw, err := fs.ReadFile(skill.FS, p)
		if err != nil {
			return err
		}
		if err := protocol.ValidateVisual(raw); err != nil {
			t.Errorf("%s does not lint clean: %v", p, err)
			return nil
		}
		for k := range kinds {
			if strings.Contains(string(raw), `"kind": "`+k+`"`) || strings.Contains(string(raw), `"kind":"`+k+`"`) {
				kinds[k] = true
			}
		}
		return nil
	})
	if err != nil {
		t.Fatalf("walking embedded skill: %v", err)
	}
	for k, seen := range kinds {
		if !seen {
			t.Errorf("no example visual of kind %q in the skill package", k)
		}
	}
}
