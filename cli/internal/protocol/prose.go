package protocol

import (
	"regexp"
	"slices"
)

// ProseLink is one anchor link in nibble prose: [phrase](@id). The phrase is
// the raw markdown between the brackets; the id names an element of the
// nibble's own visual.
type ProseLink struct {
	Phrase string
	ID     string
}

var (
	// code spans shield their content: `[x](@y)` is literal text.
	codeSpanRe = regexp.MustCompile("`[^`]*`")
	// the id reuses the ref-anchor charset (ref.go restRe).
	proseLinkRe = regexp.MustCompile(`\[([^\]]*)\]\(@([A-Za-z0-9_-]+)\)`)
)

// ProseAnchors scans markdown prose for [phrase](@id) anchor links, in
// order. Links inside backtick code spans are not links; [text](url) without
// the @ form is left alone. An empty phrase is reported so validation can
// reject it.
func ProseAnchors(md string) []ProseLink {
	// Blank out code spans without shifting offsets, so reported links keep
	// their order and nothing inside a span can match.
	masked := codeSpanRe.ReplaceAllStringFunc(md, func(s string) string {
		b := make([]byte, len(s))
		for i := range b {
			b[i] = ' '
		}
		return string(b)
	})
	var out []ProseLink
	for _, m := range proseLinkRe.FindAllStringSubmatchIndex(masked, -1) {
		// read the phrase from the original string: masking only hides spans,
		// and a match can never straddle one (spans are whole-masked).
		out = append(out, ProseLink{Phrase: md[m[2]:m[3]], ID: md[m[4]:m[5]]})
	}
	return out
}

// proseVariants lists a prose surface's markdown strings: the title and, when
// a description is present, both its variants.
func proseVariants(title string, d *Description) []string {
	out := []string{title}
	if d != nil {
		out = append(out, d.Overview)
		if d.Standard != "" {
			out = append(out, d.Standard)
		}
	}
	return out
}

// ValidateNibbleProse checks every anchor link in a nibble's prose against
// the element ids its visual declares. The CLI calls it at add time with the
// same inputs the plate loader uses, so the two paths cannot diverge.
func ValidateNibbleProse(where, title string, d *Description, anchors []string) error {
	for _, md := range proseVariants(title, d) {
		for _, l := range ProseAnchors(md) {
			if l.Phrase == "" {
				return errf(CodeNibbleProseDangling, "%s: anchor link (@%s) has an empty phrase: give the reader words to hover", where, l.ID)
			}
			if !slices.Contains(anchors, l.ID) {
				return errf(CodeNibbleProseDangling, "%s: prose links [%s](@%s) but no element %q is in this nibble's visual (it declares %s)",
					where, l.Phrase, l.ID, l.ID, quoteList(anchors))
			}
		}
	}
	return nil
}

// validatePlateProse rejects anchor links in the plate header's description:
// there is no visual to resolve them against.
func validatePlateProse(d *Description) error {
	for _, md := range proseVariants("", d) {
		if ls := ProseAnchors(md); len(ls) > 0 {
			return errf(CodePlateProseAnchor, "plate description links [%s](@%s), but anchor links resolve against a nibble's visual — the plate has none",
				ls[0].Phrase, ls[0].ID)
		}
	}
	return nil
}

func quoteList(ids []string) string {
	if len(ids) == 0 {
		return "no element ids"
	}
	out := ""
	for i, id := range ids {
		if i > 0 {
			out += ", "
		}
		out += "\"" + id + "\""
	}
	return out
}
