package protocol

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// TestErrorCodeIndex: every error code constant in this package must be
// documented in protocol/PROTOCOL.md's error code index, and no code may be
// declared twice.
func TestErrorCodeIndex(t *testing.T) {
	src, err := os.ReadFile("errors.go")
	if err != nil {
		t.Fatal(err)
	}
	re := regexp.MustCompile(`Code\w+\s*=\s*"([a-z0-9.\-]+)"`)
	matches := re.FindAllStringSubmatch(string(src), -1)
	if len(matches) == 0 {
		t.Fatal("no error codes found in errors.go")
	}

	doc, err := os.ReadFile(filepath.Join("..", "..", "..", "protocol", "PROTOCOL.md"))
	if err != nil {
		t.Fatal(err)
	}
	text := string(doc)

	seen := map[string]bool{}
	for _, m := range matches {
		code := m[1]
		if seen[code] {
			t.Errorf("code %q declared more than once", code)
		}
		seen[code] = true
		if !strings.Contains(text, "`"+code+"`") {
			t.Errorf("code %q is not documented in protocol/PROTOCOL.md", code)
		}
	}
}
