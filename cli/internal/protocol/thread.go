package protocol

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

// The review thread: numbered rounds of the reader's comments, each with the
// agent's replies, and thread links that let a later comment continue a
// conversation an earlier one opened. Everything below is derived from the
// files — nothing says "whose move" except what is on disk.

// Turn is whose move it is on a plate.
type Turn string

// A done round (no comments) is nothing to address now, not an end: the
// chat stays open and a later round may follow.
const (
	TurnReader Turn = "reader" // no review yet, or the latest round is fully answered (done included)
	TurnAgent  Turn = "agent"  // the latest round has a comment without a reply
)

// ReviewFile and ReplyFile name a round's files: round 1 keeps the v1 names.
func ReviewFile(round int) string {
	if round == 1 {
		return "review.json"
	}
	return fmt.Sprintf("review.%d.json", round)
}

func ReplyFile(round int) string {
	if round == 1 {
		return "reply.json"
	}
	return fmt.Sprintf("reply.%d.json", round)
}

// Reply is the agent's answer to one comment of its round: To is the
// comment's 1-based index, Refs are stored refs in the nibble form (no
// anchors), Because a budget reason shown to the reader.
type Reply struct {
	To      int         `json:"to"`
	Text    string      `json:"text"`
	Refs    []NibbleRef `json:"refs,omitempty"`
	Because string      `json:"because,omitempty"`
}

// Replies is a reply file.
type Replies struct {
	Replies []Reply `json:"replies"`
}

// Round is one review round and the replies to it.
type Round struct {
	N       int
	Review  *Review
	Replies []Reply
	// targets and refs resolved per comment (a continuation inherits its
	// opener's)
	targets []string
	refs    []*NibbleRef
}

// ReplyTo returns the reply to comment i (1-based), or nil.
func (r *Round) ReplyTo(i int) *Reply {
	for k := range r.Replies {
		if r.Replies[k].To == i {
			return &r.Replies[k]
		}
	}
	return nil
}

// Target returns the resolved target of comment i (1-based): its own, or the
// opener's when it continues a thread.
func (r *Round) Target(i int) string {
	if i < 1 || i > len(r.targets) {
		return ""
	}
	return r.targets[i-1]
}

// Ref returns the resolved ref of comment i (1-based): the lines it points
// at, its own or the opener's when it continues a thread; nil when the
// comment is on a target, not lines.
func (r *Round) Ref(i int) *NibbleRef {
	if i < 1 || i > len(r.refs) {
		return nil
	}
	return r.refs[i-1]
}

// Answered reports whether every comment of the round has a reply.
func (r *Round) Answered() bool {
	for i := range r.Review.Comments {
		if r.ReplyTo(i+1) == nil {
			return false
		}
	}
	return true
}

// Done reports whether the round's review carries no comments.
func (r *Round) Done() bool { return len(r.Review.Comments) == 0 }

// AnsweredCount is how many of the round's comments have a reply.
func (r *Round) AnsweredCount() int {
	n := 0
	for i := range r.Review.Comments {
		if r.ReplyTo(i+1) != nil {
			n++
		}
	}
	return n
}

// Latest returns the newest round, or nil when the plate has no review.
func (p *Plate) Latest() *Round {
	if len(p.Rounds) == 0 {
		return nil
	}
	return &p.Rounds[len(p.Rounds)-1]
}

// Turn derives whose move it is from the rounds.
func (p *Plate) Turn() Turn {
	r := p.Latest()
	if r == nil || r.Answered() {
		return TurnReader
	}
	return TurnAgent
}

// Message is one message of a thread: a reader's comment or the agent's
// reply to it, in conversation order.
type Message struct {
	From    string      `json:"from"` // "reader" | "agent"
	Round   int         `json:"round"`
	Index   int         `json:"index"`        // the comment's index in its round (a reply carries its comment's)
	ID      string      `json:"id,omitempty"` // "<round>.<index>" on reader messages
	Text    string      `json:"text"`
	Refs    []NibbleRef `json:"refs,omitempty"`
	Because string      `json:"because,omitempty"`
}

// Thread is one conversation: the opener's id, target and lines (when the
// opener points at some), then the messages in order — opener, reply,
// follow-up, reply…
type Thread struct {
	ID       string
	Target   string
	Ref      *NibbleRef
	Messages []Message
}

// Threads reassembles the conversation from the rounds, one thread per
// opener in the order the openers were written.
func (p *Plate) Threads() []Thread {
	var out []Thread
	index := map[string]int{}
	for _, r := range p.Rounds {
		for i, c := range r.Review.Comments {
			id := fmt.Sprintf("%d.%d", r.N, i+1)
			key := id
			if c.Thread != "" {
				key = c.Thread
			}
			ti, ok := index[key]
			if !ok {
				ti = len(out)
				index[key] = ti
				out = append(out, Thread{ID: key, Target: r.Target(i + 1), Ref: r.Ref(i + 1)})
			}
			out[ti].Messages = append(out[ti].Messages, Message{
				From: "reader", Round: r.N, Index: i + 1, ID: id, Text: c.Text,
			})
			if rep := r.ReplyTo(i + 1); rep != nil {
				out[ti].Messages = append(out[ti].Messages, Message{
					From: "agent", Round: r.N, Index: i + 1, Text: rep.Text,
					Refs: rep.Refs, Because: rep.Because,
				})
			}
		}
	}
	return out
}

// History returns the messages of the thread comment i of round r
// continues, before that comment — empty for an opener.
func (p *Plate) History(round, i int) []Message {
	if round < 1 || round > len(p.Rounds) {
		return nil
	}
	r := &p.Rounds[round-1]
	if i < 1 || i > len(r.Review.Comments) {
		return nil
	}
	c := r.Review.Comments[i-1]
	if c.Thread == "" {
		return nil
	}
	for _, th := range p.Threads() {
		if th.ID != c.Thread {
			continue
		}
		for k, m := range th.Messages {
			if m.From == "reader" && m.Round == round && m.Index == i {
				return th.Messages[:k]
			}
		}
	}
	return nil
}

// ParseReplies parses and validates a reply file's shape: an object with a
// replies array, each with an integer `to` and non-empty text. Targets,
// duplicates, refs and prose are checked against the round by the loader.
func ParseReplies(raw []byte) (*Replies, error) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	var rs Replies
	if err := dec.Decode(&rs); err != nil {
		return nil, errf(CodeReplyMalformed, "reply file: %v", err)
	}
	if dec.More() {
		return nil, errf(CodeReplyMalformed, "reply file: trailing data after the replies object")
	}
	for i, r := range rs.Replies {
		if strings.TrimSpace(r.Text) == "" {
			return nil, errf(CodeReplyMalformed, "reply %d has no text", i+1)
		}
	}
	return &rs, nil
}

var threadIDRe = regexp.MustCompile(`^([1-9][0-9]*)\.([1-9][0-9]*)$`)

// parseThreadID splits "<round>.<index>".
func parseThreadID(s string) (round, index int, ok bool) {
	m := threadIDRe.FindStringSubmatch(s)
	if m == nil {
		return 0, 0, false
	}
	round, _ = strconv.Atoi(m[1])
	index, _ = strconv.Atoi(m[2])
	return round, index, true
}

// nibbleOfTarget returns the nibble number a comment target names (n2,
// n2:cache), or 0 for ledger, untargeted and malformed targets.
func nibbleOfTarget(target string) int {
	if !strings.HasPrefix(target, "n") {
		return 0
	}
	num, _, _ := strings.Cut(target[1:], ":")
	n, err := strconv.Atoi(num)
	if err != nil || n < 1 {
		return 0
	}
	return n
}

// NextRound validates a review as the round that follows rounds — ordering
// (the previous round answered; a done round trivially is) and every
// comment's thread link — and returns it with its targets resolved. The loader and the
// API's POST share it, so a round is refused before it is written exactly as
// it would be refused on disk.
func NextRound(rounds []Round, review *Review) (Round, error) {
	k := len(rounds) + 1
	if review.Comments == nil {
		review.Comments = []ReviewComment{}
	}
	if k > 1 {
		prev := &rounds[k-2]
		if !prev.Answered() {
			return Round{}, errf(CodeReviewRound, "%s exists but round %d still has comments without a reply: a round may only follow an answered one", ReviewFile(k), k-1)
		}
	}
	r := Round{N: k, Review: review}
	for i := range review.Comments {
		c := &review.Comments[i]
		c.ID = fmt.Sprintf("%d.%d", k, i+1)
		target := c.Target
		ref := c.Ref
		if ref != nil {
			if err := checkCommentRef(fmt.Sprintf("%s comment %d", ReviewFile(k), i+1), ref); err != nil {
				return Round{}, err
			}
		}
		if c.Thread != "" {
			if ref != nil {
				return Round{}, errf(CodeReviewThread, "%s comment %d: a follow-up carries no ref of its own — it is on thread %s's lines", ReviewFile(k), i+1, c.Thread)
			}
			tr, ti, ok := parseThreadID(c.Thread)
			if !ok {
				return Round{}, errf(CodeReviewThread, "%s comment %d: thread %q is not a comment id (<round>.<index>)", ReviewFile(k), i+1, c.Thread)
			}
			if tr >= k {
				return Round{}, errf(CodeReviewThread, "%s comment %d: thread %q must name a comment of an earlier round", ReviewFile(k), i+1, c.Thread)
			}
			opener := &rounds[tr-1]
			if ti > len(opener.Review.Comments) {
				return Round{}, errf(CodeReviewThread, "%s comment %d: thread %q names no comment (round %d has %d)", ReviewFile(k), i+1, c.Thread, tr, len(opener.Review.Comments))
			}
			oc := opener.Review.Comments[ti-1]
			if oc.Thread != "" {
				return Round{}, errf(CodeReviewThread, "%s comment %d: thread %q is itself a follow-up; name the opener %q", ReviewFile(k), i+1, c.Thread, oc.Thread)
			}
			if c.Target != "" && c.Target != oc.Target {
				return Round{}, errf(CodeReviewThread, "%s comment %d: target %q differs from thread %s's target %q", ReviewFile(k), i+1, c.Target, c.Thread, oc.Target)
			}
			target = oc.Target
			ref = opener.Ref(ti)
		}
		r.targets = append(r.targets, target)
		r.refs = append(r.refs, ref)
	}
	return r, nil
}

// checkCommentRef validates the lines a comment points at: a ref in the v1
// grammar with no anchor (the target already names the element), and the
// stored-ref shape when a fingerprint is present. A bare ref is valid and
// reports unverified trust.
func checkCommentRef(where string, nr *NibbleRef) error {
	ref, err := ParseRef(nr.Ref)
	if err != nil {
		return err
	}
	if ref.Anchor != "" {
		return errf(CodeReviewRef, "%s: ref %q carries @%s, but a comment ref takes no anchor — the target already names the element", where, nr.Ref, ref.Anchor)
	}
	if nr.FP == "" && len(nr.Lines) == 0 && len(nr.CtxBefore) == 0 && len(nr.CtxAfter) == 0 {
		return nil
	}
	return checkStoredRefShape(where, *nr)
}

// loadRounds reads review.json / reply.json, review.2.json / reply.2.json…
// and validates ordering, thread links and replies against the plate's
// nibbles (for reply prose anchors).
func loadRounds(dir string, nibbles []Nibble) ([]Round, error) {
	var rounds []Round
	for k := 1; ; k++ {
		rawReview, err := os.ReadFile(filepath.Join(dir, ReviewFile(k)))
		if err != nil {
			if _, err2 := os.Stat(filepath.Join(dir, ReplyFile(k))); err2 == nil {
				return nil, errf(CodeReplyOrphan, "%s exists but %s does not: a reply answers a review", ReplyFile(k), ReviewFile(k))
			}
			if _, err2 := os.Stat(filepath.Join(dir, ReviewFile(k+1))); err2 == nil {
				return nil, errf(CodeReviewRound, "%s exists but %s does not: rounds are numbered without gaps", ReviewFile(k+1), ReviewFile(k))
			}
			break
		}
		review, err := ParseReview(rawReview)
		if err != nil {
			return nil, err
		}
		r, err := NextRound(rounds, review)
		if err != nil {
			return nil, err
		}
		if rawReplies, err := os.ReadFile(filepath.Join(dir, ReplyFile(k))); err == nil {
			rs, err := ParseReplies(rawReplies)
			if err != nil {
				return nil, err
			}
			if err := CheckReplies(&r, rs.Replies, nibbles); err != nil {
				return nil, err
			}
			r.Replies = rs.Replies
		}
		rounds = append(rounds, r)
	}
	return rounds, nil
}

// CheckReplies validates a round's replies against its review and the
// plate's nibbles: targets, duplicates, refs (shape, no anchors) and prose
// anchor links resolved against the comment's nibble. The CLI runs it on
// the would-be file before writing, so the two paths cannot diverge.
func CheckReplies(r *Round, replies []Reply, nibbles []Nibble) error {
	seen := map[int]bool{}
	for _, rep := range replies {
		where := fmt.Sprintf("%s reply to %d", ReplyFile(r.N), rep.To)
		if r.Done() {
			return errf(CodeReplyTarget, "%s: the review is done — there is nothing to answer", ReplyFile(r.N))
		}
		if rep.To < 1 || rep.To > len(r.Review.Comments) {
			return errf(CodeReplyTarget, "%s: no comment %d in round %d (it has %d)", ReplyFile(r.N), rep.To, r.N, len(r.Review.Comments))
		}
		if seen[rep.To] {
			return errf(CodeReplyDuplicate, "%s: comment %d already has a reply", ReplyFile(r.N), rep.To)
		}
		seen[rep.To] = true
		for _, nr := range rep.Refs {
			ref, err := ParseRef(nr.Ref)
			if err != nil {
				return err
			}
			if ref.Anchor != "" {
				return errf(CodeReplyAnchor, "%s: ref %q carries @%s, but reply refs take no anchor — the element already has its own refs", where, nr.Ref, ref.Anchor)
			}
			if err := checkStoredRefShape(where, nr); err != nil {
				return err
			}
		}
		if err := checkReplyProse(where, rep.Text, r.Target(rep.To), nibbles); err != nil {
			return err
		}
	}
	return nil
}

// checkReplyProse resolves a reply's anchor links against the visual of the
// nibble its thread targets; any link elsewhere is an error.
func checkReplyProse(where, text, target string, nibbles []Nibble) error {
	links := ProseAnchors(text)
	if len(links) == 0 {
		return nil
	}
	n := nibbleOfTarget(target)
	if n == 0 || n > len(nibbles) {
		return errf(CodeReplyAnchor, "%s: links [%s](@%s), but anchor links resolve against a nibble's visual and this thread's target %q names none",
			where, links[0].Phrase, links[0].ID, target)
	}
	anchors := CollectAnchors(nibbles[n-1].Visual)
	if err := ValidateNibbleProse(where, text, nil, anchors); err != nil {
		if pe, ok := err.(*Error); ok {
			return errf(CodeReplyAnchor, "%s", strings.Replace(pe.Msg, "this nibble's visual", fmt.Sprintf("nibble %d's visual", n), 1))
		}
		return err
	}
	return nil
}

// checkStoredRefShape verifies a stored ref's fingerprint record: fp1:<64
// hex> and 64-hex line hashes.
func checkStoredRefShape(where string, r NibbleRef) error {
	if !fpRe.MatchString(r.FP) {
		return errf(CodeRefFPInvalid, "%s ref %q: fp must match fp1:<64 hex>", where, r.Ref)
	}
	for _, h := range append(append(append([]string{}, r.Lines...), r.CtxBefore...), r.CtxAfter...) {
		if !hashRe.MatchString(h) {
			return errf(CodeRefFPInvalid, "%s ref %q: line hash %q is not 64 hex", where, r.Ref, h)
		}
	}
	return nil
}
