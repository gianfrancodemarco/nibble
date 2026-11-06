package protocol

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
)

// About says what code a plate is about: the code as it is, the uncommitted
// working tree, a PR, or an arbitrary base..head range.
type About struct {
	Kind  string // "code", "worktree", "pr", "range"
	PR    int
	Range string
}

// Description is levelled prose on a plate or a nibble: Overview is the skim
// text (required when a description is present), Standard the fuller text the
// dial shows at its standard level, falling back to Overview when absent.
type Description struct {
	Overview string `json:"overview"`
	Standard string `json:"standard,omitempty"`
}

// validateDescription checks the shape rules shared by plate and nibble
// descriptions; code is the error code to fail with.
func validateDescription(raw json.RawMessage, code, where string) (*Description, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, nil
	}
	var d Description
	if err := json.Unmarshal(raw, &d); err != nil {
		return nil, errf(code, "%s description: want {\"overview\": \"<md>\", \"standard\": \"<md>\"}: %v", where, err)
	}
	if d.Overview == "" {
		return nil, errf(code, "%s description needs a non-empty overview: the skim text is what makes a description readable at a glance", where)
	}
	return &d, nil
}

// PlateHeader is plate.json. Raw preserves the original bytes so unknown
// fields survive a rewrite.
type PlateHeader struct {
	Version     int             `json:"version"`
	Title       string          `json:"title"`
	Description *Description    `json:"description,omitempty"`
	Repo        string          `json:"repo"`
	HeadSHA     string          `json:"head_sha"`
	About       About           `json:"-"`
	CreatedAt   string          `json:"created_at"`
	Because     string          `json:"because,omitempty"`
	Raw         json.RawMessage `json:"-"`
}

// NibbleRef is one stored ref inside a nibble file: the ref string plus its
// fp1 fingerprint record.
type NibbleRef struct {
	Ref       string   `json:"ref"`
	FP        string   `json:"fp"`
	Lines     []string `json:"lines"`
	CtxBefore []string `json:"ctx_before,omitempty"`
	CtxAfter  []string `json:"ctx_after,omitempty"`
}

// Nibble is one n<N>.json file.
type Nibble struct {
	Title       string          `json:"title"`
	Description *Description    `json:"-"`
	Visual      json.RawMessage `json:"visual"`
	View        json.RawMessage `json:"view,omitempty"`
	Because     string          `json:"because,omitempty"`
	Refs        []NibbleRef     `json:"refs"`
	Raw         json.RawMessage `json:"-"`
}

// Review is review.json: the human's answer — their comments, nothing more.
// No comments means done: nothing to address.
type Review struct {
	Comments []ReviewComment `json:"comments"`
}

// ReviewComment is one pinned comment, targeted at a nibble or an element.
type ReviewComment struct {
	Target string `json:"target,omitempty"`
	Text   string `json:"text"`
}

// Plate is a parsed, validated plate folder.
type Plate struct {
	Header  PlateHeader
	Nibbles []Nibble
	Total   int  // from the done marker; 0 while open
	Open    bool // no done marker yet
	Ledger  *Ledger
	Review  *Review
}

// UnmarshalJSON accepts the four about forms: "code", "worktree",
// {"pr": N}, {"range": "<base>..<head>"}.
func (a *About) UnmarshalJSON(raw []byte) error {
	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		if s != "code" && s != "worktree" {
			return errf(CodePlateHeader, "about: unknown form %q", s)
		}
		a.Kind = s
		return nil
	}
	var obj struct {
		PR    *int    `json:"pr"`
		Range *string `json:"range"`
	}
	if err := json.Unmarshal(raw, &obj); err != nil {
		return errf(CodePlateHeader, "about: %v", err)
	}
	switch {
	case obj.PR != nil:
		a.Kind, a.PR = "pr", *obj.PR
	case obj.Range != nil:
		a.Kind, a.Range = "range", *obj.Range
	default:
		return errf(CodePlateHeader, "about: want \"code\", \"worktree\", {\"pr\":N} or {\"range\":\"a..b\"}")
	}
	return nil
}

var fpRe = regexp.MustCompile(`^fp1:[0-9a-f]{64}$`)
var hashRe = regexp.MustCompile(`^[0-9a-f]{64}$`)

// ParseReview parses and validates review.json bytes. A review is its
// comments; an empty or absent comments array means done. Every comment
// must carry non-empty text.
func ParseReview(raw []byte) (*Review, error) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	var r Review
	if err := dec.Decode(&r); err != nil {
		return nil, errf(CodeReviewMalformed, "review.json: %v", err)
	}
	// A second document (or trailing garbage) is not a review.
	if dec.More() {
		return nil, errf(CodeReviewMalformed, "review.json: trailing data after the review object")
	}
	for i, c := range r.Comments {
		if strings.TrimSpace(c.Text) == "" {
			return nil, errf(CodeReviewMalformed, "review.json: comment %d has no text", i+1)
		}
	}
	return &r, nil
}

// ParsePlate reads and validates a plate directory per protocol v1.
// Files that are not part of the protocol are ignored.
func ParsePlate(dir string) (*Plate, error) {
	p := &Plate{}

	// Header.
	rawHeader, err := os.ReadFile(filepath.Join(dir, "plate.json"))
	if err != nil {
		return nil, errf(CodePlateHeader, "plate.json: %v", err)
	}
	var probe map[string]json.RawMessage
	if err := json.Unmarshal(rawHeader, &probe); err != nil {
		return nil, errf(CodePlateHeader, "plate.json: %v", err)
	}
	if _, ok := probe["version"]; !ok {
		return nil, errf(CodePlateVersionMissing, "plate.json has no version field")
	}
	var hdr struct {
		Version     int             `json:"version"`
		Title       string          `json:"title"`
		Description json.RawMessage `json:"description"`
		Repo        string          `json:"repo"`
		HeadSHA     string          `json:"head_sha"`
		About       About           `json:"about"`
		CreatedAt   string          `json:"created_at"`
		Because     string          `json:"because"`
	}
	if err := json.Unmarshal(rawHeader, &hdr); err != nil {
		if pe, ok := err.(*Error); ok {
			return nil, pe
		}
		return nil, errf(CodePlateHeader, "plate.json: %v", err)
	}
	if hdr.Version != Version {
		return nil, errf(CodePlateVersionUnsupported, "plate version %d; this consumer supports version %d", hdr.Version, Version)
	}
	if hdr.Title == "" {
		return nil, errf(CodePlateHeader, "plate.json: title must not be empty")
	}
	desc, err := validateDescription(hdr.Description, CodePlateDescription, "plate")
	if err != nil {
		return nil, err
	}
	p.Header = PlateHeader{
		Version: hdr.Version, Title: hdr.Title, Description: desc, Repo: hdr.Repo,
		HeadSHA: hdr.HeadSHA, About: hdr.About, CreatedAt: hdr.CreatedAt,
		Because: hdr.Because, Raw: rawHeader,
	}

	// Nibbles: n1.json, n2.json, … contiguous from 1.
	for n := 1; ; n++ {
		raw, err := os.ReadFile(filepath.Join(dir, fmt.Sprintf("n%d.json", n)))
		if err != nil {
			// A gap is an error only if a later nibble file exists.
			if _, err2 := os.Stat(filepath.Join(dir, fmt.Sprintf("n%d.json", n+1))); err2 == nil {
				return nil, errf(CodePlateNibblesGap, "n%d.json missing but n%d.json exists", n, n+1)
			}
			break
		}
		nib, err := parseNibble(raw, n)
		if err != nil {
			return nil, err
		}
		p.Nibbles = append(p.Nibbles, *nib)
	}

	// Lifecycle.
	if rawDone, err := os.ReadFile(filepath.Join(dir, "done")); err == nil {
		var done struct {
			Total int `json:"total"`
		}
		if err := json.Unmarshal(rawDone, &done); err != nil {
			return nil, errf(CodePlateSealed, "done marker: %v", err)
		}
		p.Total = done.Total
		if len(p.Nibbles) > done.Total {
			return nil, errf(CodePlateSealed, "plate sealed at %d nibbles but %d exist", done.Total, len(p.Nibbles))
		}
	} else {
		p.Open = true
	}

	// Ledger.
	if rawLedger, err := os.ReadFile(filepath.Join(dir, "ledger.json")); err == nil {
		l, err := parseLedger(rawLedger, p.Header.About.Kind)
		if err != nil {
			return nil, err
		}
		p.Ledger = l
	}

	// Review.
	if rawReview, err := os.ReadFile(filepath.Join(dir, "review.json")); err == nil {
		r, err := ParseReview(rawReview)
		if err != nil {
			return nil, err
		}
		p.Review = r
	}

	return p, nil
}

func parseNibble(raw []byte, n int) (*Nibble, error) {
	var nib Nibble
	if err := json.Unmarshal(raw, &nib); err != nil {
		return nil, errf(CodeNibbleFile, "n%d.json: %v", n, err)
	}
	nib.Raw = raw
	var extra struct {
		Caption     json.RawMessage `json:"caption"`
		Description json.RawMessage `json:"description"`
	}
	if err := json.Unmarshal(raw, &extra); err != nil {
		return nil, errf(CodeNibbleFile, "n%d.json: %v", n, err)
	}
	if nib.Title == "" {
		if len(extra.Caption) > 0 {
			return nil, errf(CodeNibbleTitleMissing, "n%d.json carries caption: the field was renamed title — same claim, same 40-word budget", n)
		}
		return nil, errf(CodeNibbleTitleMissing, "n%d.json has no title: every nibble leads with its claim", n)
	}
	desc, err := validateDescription(extra.Description, CodeNibbleDescription, fmt.Sprintf("n%d.json", n))
	if err != nil {
		return nil, err
	}
	nib.Description = desc
	if len(nib.Visual) == 0 || string(nib.Visual) == "null" {
		return nil, errf(CodeNibbleVisualMissing, "n%d.json has no visual: every nibble leads with one (map, sequence, timeline or compare)", n)
	}
	if err := ValidateVisual(nib.Visual); err != nil {
		return nil, err
	}
	anchors := CollectAnchors(nib.Visual)
	for _, r := range nib.Refs {
		ref, err := ParseRef(r.Ref)
		if err != nil {
			return nil, err
		}
		if !fpRe.MatchString(r.FP) {
			return nil, errf(CodeRefFPInvalid, "n%d.json ref %q: fp must match fp1:<64 hex>", n, r.Ref)
		}
		for _, h := range append(append(append([]string{}, r.Lines...), r.CtxBefore...), r.CtxAfter...) {
			if !hashRe.MatchString(h) {
				return nil, errf(CodeRefFPInvalid, "n%d.json ref %q: line hash %q is not 64 hex", n, r.Ref, h)
			}
		}
		if ref.Anchor != "" && !slices.Contains(anchors, ref.Anchor) {
			return nil, errf(CodeRefAnchorDangling, "n%d.json ref %q: no element %q in this nibble's visual", n, r.Ref, ref.Anchor)
		}
	}
	return &nib, nil
}
