package protocol

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// goldenRoot locates protocol/golden at the repository root, relative to this
// package (cli/internal/protocol → ../../../protocol/golden).
func goldenRoot(t *testing.T) string {
	t.Helper()
	root, err := filepath.Abs(filepath.Join("..", "..", "..", "protocol", "golden"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(root); err != nil {
		t.Fatalf("golden root not found: %v", err)
	}
	return root
}

// runners maps a top-level golden category to the function that knows how to
// run its fixtures. A fixture in a category without a runner fails the suite:
// every golden file must be exercised by something.
var runners = map[string]func(t *testing.T, path string){}

// TestGolden walks protocol/golden and dispatches every fixture to its
// category runner. It is the conformance suite's entry point.
func TestGolden(t *testing.T) {
	root := goldenRoot(t)
	categories, err := os.ReadDir(root)
	if err != nil {
		t.Fatal(err)
	}
	for _, cat := range categories {
		if !cat.IsDir() {
			continue
		}
		name := cat.Name()
		var fixtures []string
		err := filepath.WalkDir(filepath.Join(root, name), func(path string, d os.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if !d.IsDir() && !strings.HasPrefix(d.Name(), ".") {
				fixtures = append(fixtures, path)
			}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
		if len(fixtures) == 0 {
			continue
		}
		run, ok := runners[name]
		if !ok {
			t.Fatalf("golden category %q has %d fixture(s) but no runner", name, len(fixtures))
		}
		t.Run(name, func(t *testing.T) {
			for _, f := range fixtures {
				run(t, f)
			}
		})
	}
}
