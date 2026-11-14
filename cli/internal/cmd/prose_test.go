package cmd

import (
	"strings"
	"testing"
)

// nibble add validates prose anchor links against the nibble's own visual,
// with a fix-it message naming the ids the visual declares.
func TestAddProseAnchors(t *testing.T) {
	repo := gitInit(t)
	ctx, plate := newTestPlate(t, repo)
	visual := writeFile(t, t.TempDir(), "map.json", testMap)

	t.Run("linked title accepted", func(t *testing.T) {
		code, _, errb := run(t, ctx, "add", plate, "--title", "the [cache](@cache) misses", "--visual", visual)
		if code != 0 {
			t.Fatalf("exit = %d, stderr = %s", code, errb)
		}
	})

	t.Run("dangling title link rejected naming the ids", func(t *testing.T) {
		code, _, errb := run(t, ctx, "add", plate, "--title", "the [pool](@pool) drains", "--visual", visual)
		if code != 1 {
			t.Fatalf("exit = %d, want 1 (stderr %s)", code, errb)
		}
		if !strings.Contains(errb, "nibble.prose.anchor.dangling") {
			t.Fatalf("stderr should carry the code: %s", errb)
		}
		if !strings.Contains(errb, `"cache"`) || !strings.Contains(errb, `"db"`) {
			t.Fatalf("fix-it message should name the visual's ids: %s", errb)
		}
	})

	t.Run("dangling description link rejected", func(t *testing.T) {
		code, _, errb := run(t, ctx, "add", plate, "--title", "c", "--visual", visual,
			"--description", "see [the pool](@pool)")
		if code != 1 || !strings.Contains(errb, "nibble.prose.anchor.dangling") {
			t.Fatalf("exit = %d, stderr = %s", code, errb)
		}
	})

	t.Run("dangling standard variant rejected", func(t *testing.T) {
		code, _, errb := run(t, ctx, "add", plate, "--title", "c", "--visual", visual,
			"--description", "fine", "--description-standard", "[gone](@gone)")
		if code != 1 || !strings.Contains(errb, "nibble.prose.anchor.dangling") {
			t.Fatalf("exit = %d, stderr = %s", code, errb)
		}
	})
}
