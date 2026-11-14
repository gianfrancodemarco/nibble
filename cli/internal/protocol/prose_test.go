package protocol

import "testing"

func TestProseAnchors(t *testing.T) {
	cases := []struct {
		name string
		md   string
		want []ProseLink
	}{
		{"no links", "the cache misses fall through to the pool", nil},
		{"one link", "the [cache](@cache) misses", []ProseLink{{Phrase: "cache", ID: "cache"}}},
		{"two links", "[cache](@cache) falls to [the pool](@pool)",
			[]ProseLink{{Phrase: "cache", ID: "cache"}, {Phrase: "the pool", ID: "pool"}}},
		{"empty phrase reported", "see [](@cache) here", []ProseLink{{Phrase: "", ID: "cache"}}},
		{"url link ignored", "see [RFC 42](https://example.com)", nil},
		{"code span shields the link", "run `[x](@y)` verbatim", nil},
		{"code span shields a bracket", "`a](` then [real](@node)", []ProseLink{{Phrase: "real", ID: "node"}}},
		{"bad id charset not a link", "[x](@no spaces)", nil},
		{"id charset", "[x](@A-Za_z09)", []ProseLink{{Phrase: "x", ID: "A-Za_z09"}}},
		{"markdown inside phrase kept", "[**hot** path](@hot)", []ProseLink{{Phrase: "**hot** path", ID: "hot"}}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := ProseAnchors(c.md)
			if len(got) != len(c.want) {
				t.Fatalf("ProseAnchors(%q) = %v, want %v", c.md, got, c.want)
			}
			for i := range got {
				if got[i] != c.want[i] {
					t.Fatalf("ProseAnchors(%q)[%d] = %v, want %v", c.md, i, got[i], c.want[i])
				}
			}
		})
	}
}
