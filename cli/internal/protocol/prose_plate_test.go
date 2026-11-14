package protocol

import (
	"strings"
	"testing"
)

// TestNibbleProseAnchors covers [phrase](@id) links in nibble prose resolving
// against the nibble's own visual (spec: Prose anchor links).
func TestNibbleProseAnchors(t *testing.T) {
	cases := []struct {
		name   string
		nibble string
		want   string // error code, "" means valid
		inMsg  string // substring the error message must carry
	}{
		{
			name:   "title link to a declared id",
			nibble: `{"title":"the [A](@a) node","visual":` + testVisual + `,"refs":[]}`,
		},
		{
			name: "description links to a declared id",
			nibble: `{"title":"c","description":{"overview":"[A](@a) first","standard":"then [A again](@a)"},
				"visual":` + testVisual + `,"refs":[]}`,
		},
		{
			name:   "dangling title link",
			nibble: `{"title":"the [pool](@pool)","visual":` + testVisual + `,"refs":[]}`,
			want:   "nibble.prose.anchor.dangling",
			inMsg:  `"a"`, // the message names the ids the visual declares
		},
		{
			name: "dangling description link",
			nibble: `{"title":"c","description":{"overview":"[the pool](@pool)"},
				"visual":` + testVisual + `,"refs":[]}`,
			want:  "nibble.prose.anchor.dangling",
			inMsg: `"a"`,
		},
		{
			name: "dangling standard variant link",
			nibble: `{"title":"c","description":{"overview":"fine","standard":"[gone](@gone)"},
				"visual":` + testVisual + `,"refs":[]}`,
			want: "nibble.prose.anchor.dangling",
		},
		{
			name:   "empty phrase rejected",
			nibble: `{"title":"see [](@a)","visual":` + testVisual + `,"refs":[]}`,
			want:   "nibble.prose.anchor.dangling",
			inMsg:  "empty",
		},
		{
			name:   "url link untouched",
			nibble: `{"title":"see [RFC 42](https://example.com)","visual":` + testVisual + `,"refs":[]}`,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			dir := writePlate(t, testHeader, c.nibble)
			_, err := ParsePlate(dir)
			if got := ErrCode(err); got != c.want {
				t.Fatalf("error code = %q (%v), want %q", got, err, c.want)
			}
			if c.inMsg != "" && (err == nil || !strings.Contains(err.Error(), c.inMsg)) {
				t.Fatalf("error %v does not mention %q", err, c.inMsg)
			}
		})
	}
}

// TestPlateProseAnchors: the plate header has no visual, so anchor links in
// its description are rejected (spec: Plate prose carries no anchor links).
func TestPlateProseAnchors(t *testing.T) {
	header := func(desc string) string {
		return `{"version":1,"title":"t","description":` + desc +
			`,"repo":"/r","head_sha":"abc","about":"code","created_at":"2026-11-01T10:00:00Z"}`
	}
	cases := []struct {
		name string
		desc string
		want string
	}{
		{"anchor link in overview rejected", `{"overview":"[the cache](@cache)"}`, "plate.prose.anchor"},
		{"anchor link in standard rejected", `{"overview":"ok","standard":"[x](@x)"}`, "plate.prose.anchor"},
		{"ordinary bracketed text untouched", `{"overview":"see [RFC 42](https://example.com)"}`, ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			dir := writePlate(t, header(c.desc))
			_, err := ParsePlate(dir)
			if got := ErrCode(err); got != c.want {
				t.Fatalf("error code = %q (%v), want %q", got, err, c.want)
			}
		})
	}
}
