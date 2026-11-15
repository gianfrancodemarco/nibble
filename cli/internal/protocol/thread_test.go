package protocol

import (
	"os"
	"path/filepath"
	"testing"
)

// The review thread: rounds of review files, thread links between comments
// of different rounds, reply files, and the turn derived from all of it.

const threadNibble = `{"title":"c","visual":` + testVisual + `,"refs":[]}`

// a stored ref shape a reply may carry (fingerprint values are only checked
// for shape here; trust is computed elsewhere)
const storedRef = `{"ref":"src/a.ts:1-2 note","fp":"fp1:` + hex64 + `","lines":["` + hex64 + `","` + hex64 + `"]}`
const hex64 = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

// threadPlate writes a two-nibble plate plus the named thread files.
func threadPlate(t *testing.T, files map[string]string) string {
	t.Helper()
	dir := writePlate(t, testHeader, threadNibble, threadNibble)
	for name, body := range files {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

const twoComments = `{"comments":[{"target":"n1","text":"why?"},{"target":"n2:a","text":"and this?"}]}`
const twoReplies = `{"replies":[{"to":1,"text":"because"},{"to":2,"text":"that too"}]}`
const reviewDone = `{"comments":[]}`

func TestThreadRounds(t *testing.T) {
	cases := []struct {
		name   string
		files  map[string]string
		want   string // error code, "" means valid
		rounds int
		turn   Turn
	}{
		{name: "no review", files: nil, rounds: 0, turn: TurnReader},
		{name: "v1 single review, unanswered", files: map[string]string{"review.json": twoComments}, rounds: 1, turn: TurnAgent},
		{name: "half answered", files: map[string]string{"review.json": twoComments, "reply.json": `{"replies":[{"to":2,"text":"x"}]}`}, rounds: 1, turn: TurnAgent},
		{name: "answered", files: map[string]string{"review.json": twoComments, "reply.json": twoReplies}, rounds: 1, turn: TurnReader},
		{name: "done is not an end: the reader may write again", files: map[string]string{"review.json": reviewDone}, rounds: 1, turn: TurnReader},
		{name: "two rounds, second done", files: map[string]string{"review.json": twoComments, "reply.json": twoReplies, "review.2.json": reviewDone}, rounds: 2, turn: TurnReader},
		{name: "numbering gap", files: map[string]string{"review.json": twoComments, "reply.json": twoReplies, "review.3.json": reviewDone}, want: "review.round"},
		{name: "round before predecessor answered", files: map[string]string{"review.json": twoComments, "review.2.json": reviewDone}, want: "review.round"},
		{name: "round after done is fine", files: map[string]string{"review.json": reviewDone, "review.2.json": twoComments}, rounds: 2, turn: TurnAgent},
		{name: "malformed later round", files: map[string]string{"review.json": twoComments, "reply.json": twoReplies, "review.2.json": `{"comments":[{"target":"n1"}]}`}, want: "review.malformed"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			p, err := ParsePlate(threadPlate(t, tc.files))
			if tc.want != "" {
				if got := ErrCode(err); got != tc.want {
					t.Fatalf("error = %q (%v), want %q", got, err, tc.want)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if len(p.Rounds) != tc.rounds {
				t.Fatalf("rounds = %d, want %d", len(p.Rounds), tc.rounds)
			}
			if got := p.Turn(); got != tc.turn {
				t.Fatalf("turn = %q, want %q", got, tc.turn)
			}
		})
	}
}

func TestThreadLinks(t *testing.T) {
	answered := map[string]string{"review.json": twoComments, "reply.json": twoReplies}
	with := func(extra map[string]string) map[string]string {
		m := map[string]string{}
		for k, v := range answered {
			m[k] = v
		}
		for k, v := range extra {
			m[k] = v
		}
		return m
	}
	cases := []struct {
		name  string
		files map[string]string
		want  string
	}{
		{name: "follow-up inherits the opener's target", files: with(map[string]string{"review.2.json": `{"comments":[{"thread":"1.2","text":"and if full?"}]}`})},
		{name: "follow-up may repeat the target", files: with(map[string]string{"review.2.json": `{"comments":[{"thread":"1.2","target":"n2:a","text":"ok"}]}`})},
		{name: "missing opener", files: with(map[string]string{"review.2.json": `{"comments":[{"thread":"1.9","text":"?"}]}`}), want: "review.thread"},
		{name: "same round", files: with(map[string]string{"review.2.json": `{"comments":[{"target":"n1","text":"a"},{"thread":"2.1","text":"b"}]}`}), want: "review.thread"},
		{name: "later round", files: with(map[string]string{"review.2.json": `{"comments":[{"thread":"3.1","text":"?"}]}`}), want: "review.thread"},
		{name: "target mismatch", files: with(map[string]string{"review.2.json": `{"comments":[{"thread":"1.2","target":"n1","text":"?"}]}`}), want: "review.thread"},
		{name: "malformed id", files: with(map[string]string{"review.2.json": `{"comments":[{"thread":"one.two","text":"?"}]}`}), want: "review.thread"},
		{
			name: "opener must not be a continuation",
			files: with(map[string]string{
				"review.2.json": `{"comments":[{"thread":"1.2","text":"more"}]}`,
				"reply.2.json":  `{"replies":[{"to":1,"text":"sure"}]}`,
				"review.3.json": `{"comments":[{"thread":"2.1","text":"chain"}]}`,
			}),
			want: "review.thread",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			p, err := ParsePlate(threadPlate(t, tc.files))
			if tc.want != "" {
				if got := ErrCode(err); got != tc.want {
					t.Fatalf("error = %q (%v), want %q", got, err, tc.want)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			c := p.Rounds[1].Review.Comments[0]
			if c.ID != "2.1" || c.Thread != "1.2" {
				t.Fatalf("comment = %+v, want id 2.1 in thread 1.2", c)
			}
			if got := p.Rounds[1].Target(1); got != "n2:a" {
				t.Fatalf("resolved target = %q, want n2:a", got)
			}
		})
	}
}

func TestReplyValidation(t *testing.T) {
	cases := []struct {
		name  string
		files map[string]string
		want  string
	}{
		{name: "reply with a stored ref", files: map[string]string{"review.json": twoComments, "reply.json": `{"replies":[{"to":1,"text":"see","refs":[` + storedRef + `]}]}`}},
		{name: "not an object", files: map[string]string{"review.json": twoComments, "reply.json": `[]`}, want: "reply.malformed"},
		{name: "empty text", files: map[string]string{"review.json": twoComments, "reply.json": `{"replies":[{"to":1,"text":"  "}]}`}, want: "reply.malformed"},
		{name: "non-integer to", files: map[string]string{"review.json": twoComments, "reply.json": `{"replies":[{"to":"1","text":"x"}]}`}, want: "reply.malformed"},
		{name: "to beyond the round", files: map[string]string{"review.json": twoComments, "reply.json": `{"replies":[{"to":3,"text":"x"}]}`}, want: "reply.target"},
		{name: "to zero", files: map[string]string{"review.json": twoComments, "reply.json": `{"replies":[{"to":0,"text":"x"}]}`}, want: "reply.target"},
		{name: "reply on a done review", files: map[string]string{"review.json": reviewDone, "reply.json": `{"replies":[{"to":1,"text":"x"}]}`}, want: "reply.target"},
		{name: "duplicate", files: map[string]string{"review.json": twoComments, "reply.json": `{"replies":[{"to":1,"text":"x"},{"to":1,"text":"y"}]}`}, want: "reply.duplicate"},
		{name: "orphan", files: map[string]string{"review.json": twoComments, "reply.json": twoReplies, "reply.2.json": `{"replies":[]}`}, want: "reply.orphan"},
		{name: "orphan round 1", files: map[string]string{"reply.json": `{"replies":[]}`}, want: "reply.orphan"},
		{name: "ref with anchor", files: map[string]string{"review.json": twoComments, "reply.json": `{"replies":[{"to":1,"text":"x","refs":[{"ref":"src/a.ts:1-2 @a note","fp":"fp1:` + hex64 + `","lines":["` + hex64 + `","` + hex64 + `"]}]}]}`}, want: "reply.anchor"},
		{name: "ref with bad fp", files: map[string]string{"review.json": twoComments, "reply.json": `{"replies":[{"to":1,"text":"x","refs":[{"ref":"src/a.ts:1-2","fp":"nope","lines":[]}]}]}`}, want: "ref.fp.invalid"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			p, err := ParsePlate(threadPlate(t, tc.files))
			if got := ErrCode(err); got != tc.want {
				t.Fatalf("error = %q (%v), want %q", got, err, tc.want)
			}
			if tc.want == "" && p.Rounds[0].ReplyTo(1) == nil {
				t.Fatal("reply to comment 1 not found")
			}
		})
	}
}

func TestReplyProseAnchors(t *testing.T) {
	cases := []struct {
		name  string
		files map[string]string
		want  string
	}{
		{name: "link into the comment's nibble", files: map[string]string{"review.json": twoComments, "reply.json": `{"replies":[{"to":2,"text":"the [node](@a) is fine"}]}`}},
		{name: "link on a plain nibble target", files: map[string]string{"review.json": twoComments, "reply.json": `{"replies":[{"to":1,"text":"the [node](@a) is fine"}]}`}},
		{name: "dangling", files: map[string]string{"review.json": twoComments, "reply.json": `{"replies":[{"to":2,"text":"[x](@nope)"}]}`}, want: "reply.anchor"},
		{name: "empty phrase", files: map[string]string{"review.json": twoComments, "reply.json": `{"replies":[{"to":2,"text":"[](@a)"}]}`}, want: "reply.anchor"},
		{name: "ledger target takes no links", files: map[string]string{"review.json": `{"comments":[{"target":"ledger:src/a.ts","text":"?"}]}`, "reply.json": `{"replies":[{"to":1,"text":"[x](@a)"}]}`}, want: "reply.anchor"},
		{name: "untargeted takes no links", files: map[string]string{"review.json": `{"comments":[{"text":"?"}]}`, "reply.json": `{"replies":[{"to":1,"text":"[x](@a)"}]}`}, want: "reply.anchor"},
		{name: "unknown nibble takes no links", files: map[string]string{"review.json": `{"comments":[{"target":"n9","text":"?"}]}`, "reply.json": `{"replies":[{"to":1,"text":"[x](@a)"}]}`}, want: "reply.anchor"},
		{
			name: "follow-up reply resolves against the opener's nibble",
			files: map[string]string{
				"review.json": twoComments, "reply.json": twoReplies,
				"review.2.json": `{"comments":[{"thread":"1.2","text":"more"}]}`,
				"reply.2.json":  `{"replies":[{"to":1,"text":"[node](@a) again"}]}`,
			},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := ParsePlate(threadPlate(t, tc.files))
			if got := ErrCode(err); got != tc.want {
				t.Fatalf("error = %q (%v), want %q", got, err, tc.want)
			}
		})
	}
}

// Threads(): the conversation reassembled from rounds — one thread per
// opener, messages alternating reader/agent across rounds.
func TestThreadsAssembled(t *testing.T) {
	dir := threadPlate(t, map[string]string{
		"review.json":   twoComments,
		"reply.json":    twoReplies,
		"review.2.json": `{"comments":[{"thread":"1.2","text":"and if full?"},{"target":"n1","text":"new one"}]}`,
		"reply.2.json":  `{"replies":[{"to":1,"text":"it blocks"}]}`,
	})
	p, err := ParsePlate(dir)
	if err != nil {
		t.Fatal(err)
	}
	ths := p.Threads()
	if len(ths) != 3 {
		t.Fatalf("threads = %d, want 3", len(ths))
	}
	// thread 1.2: opener, reply, follow-up (2.1), reply
	th := ths[1]
	if th.ID != "1.2" || th.Target != "n2:a" {
		t.Fatalf("thread = %+v", th)
	}
	wantFrom := []string{"reader", "agent", "reader", "agent"}
	wantText := []string{"and this?", "that too", "and if full?", "it blocks"}
	if len(th.Messages) != 4 {
		t.Fatalf("messages = %d, want 4", len(th.Messages))
	}
	for i, m := range th.Messages {
		if m.From != wantFrom[i] || m.Text != wantText[i] {
			t.Errorf("message %d = %s %q, want %s %q", i, m.From, m.Text, wantFrom[i], wantText[i])
		}
	}
	if th.Messages[2].ID != "2.1" || th.Messages[2].Round != 2 {
		t.Errorf("follow-up = %+v", th.Messages[2])
	}
	// thread 2.2 opened in round 2, unanswered
	if ths[2].ID != "2.2" || len(ths[2].Messages) != 1 || ths[2].Target != "n1" {
		t.Errorf("third thread = %+v", ths[2])
	}
	if p.Turn() != TurnAgent {
		t.Errorf("turn = %q, want agent (2.2 unanswered)", p.Turn())
	}
}

// Round file names: round 1 keeps the v1 names.
func TestRoundFileNames(t *testing.T) {
	if ReviewFile(1) != "review.json" || ReplyFile(1) != "reply.json" {
		t.Fatalf("round 1 = %s / %s", ReviewFile(1), ReplyFile(1))
	}
	if ReviewFile(2) != "review.2.json" || ReplyFile(3) != "reply.3.json" {
		t.Fatalf("round k = %s / %s", ReviewFile(2), ReplyFile(3))
	}
}

// Comment refs: a comment may point at lines in the stored ref form; the
// fingerprint is optional (a hand-written review need not hash lines), an
// anchor is refused, and a follow-up inherits its opener's ref.
func TestCommentRefs(t *testing.T) {
	answered := map[string]string{"review.json": twoComments, "reply.json": twoReplies}
	with := func(extra map[string]string) map[string]string {
		m := map[string]string{}
		for k, v := range answered {
			m[k] = v
		}
		for k, v := range extra {
			m[k] = v
		}
		return m
	}
	lineComment := `{"comments":[{"target":"n2:a","ref":` + storedRef + `,"text":"this swallows the error"}]}`
	cases := []struct {
		name    string
		files   map[string]string
		want    string
		wantRef string // resolved ref string of round 1 (or round 2's first comment when wantRound2)
		round2  bool
	}{
		{name: "fingerprinted ref", files: map[string]string{"review.json": lineComment}, wantRef: "src/a.ts:1-2 note"},
		{name: "bare ref (hand-written)", files: map[string]string{"review.json": `{"comments":[{"target":"n1","ref":{"ref":"src/a.ts:2"},"text":"here"}]}`}, wantRef: "src/a.ts:2"},
		{name: "ref on a ledger base target", files: map[string]string{"review.json": `{"comments":[{"target":"ledger:src/b.ts#base","ref":{"ref":"diff:src/b.ts@abc..def#base:10-12"},"text":"gone"}]}`}, wantRef: "diff:src/b.ts@abc..def#base:10-12"},
		{name: "no range", files: map[string]string{"review.json": `{"comments":[{"target":"n1","ref":{"ref":"src/a.ts"},"text":"x"}]}`}, want: "ref.syntax"},
		{name: "anchor refused", files: map[string]string{"review.json": `{"comments":[{"target":"n1","ref":{"ref":"src/a.ts:1-3 @cache"},"text":"x"}]}`}, want: "review.ref"},
		{name: "bad fingerprint", files: map[string]string{"review.json": `{"comments":[{"target":"n1","ref":{"ref":"src/a.ts:1-3","fp":"nope"},"text":"x"}]}`}, want: "ref.fp.invalid"},
		{name: "ref not an object", files: map[string]string{"review.json": `{"comments":[{"target":"n1","ref":"src/a.ts:1-3","text":"x"}]}`}, want: "review.malformed"},
		{
			name:    "follow-up inherits the opener's ref",
			files:   with(map[string]string{"review.json": lineComment, "reply.json": `{"replies":[{"to":1,"text":"ok"}]}`, "review.2.json": `{"comments":[{"thread":"1.1","text":"still?"}]}`}),
			wantRef: "src/a.ts:1-2 note", round2: true,
		},
		{
			name:  "follow-up with its own ref",
			files: with(map[string]string{"review.json": lineComment, "reply.json": `{"replies":[{"to":1,"text":"ok"}]}`, "review.2.json": `{"comments":[{"thread":"1.1","ref":{"ref":"src/a.ts:5"},"text":"still?"}]}`}),
			want:  "review.thread",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			p, err := ParsePlate(threadPlate(t, tc.files))
			if tc.want != "" {
				if got := ErrCode(err); got != tc.want {
					t.Fatalf("error = %q (%v), want %q", got, err, tc.want)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			r := &p.Rounds[0]
			if tc.round2 {
				r = &p.Rounds[1]
			}
			ref := r.Ref(1)
			if ref == nil || ref.Ref != tc.wantRef {
				t.Fatalf("resolved ref = %+v, want %q", ref, tc.wantRef)
			}
			if tc.round2 {
				if p.Rounds[1].Review.Comments[0].Ref != nil {
					t.Fatalf("the follow-up must not carry a ref of its own")
				}
				ths := p.Threads()
				if ths[0].Ref == nil || ths[0].Ref.Ref != tc.wantRef {
					t.Fatalf("thread ref = %+v, want %q", ths[0].Ref, tc.wantRef)
				}
			}
			if r.Ref(2) != nil && len(r.Review.Comments) < 2 {
				t.Fatalf("Ref beyond the round must be nil")
			}
		})
	}
	// A comment without a ref resolves to nil.
	p, err := ParsePlate(threadPlate(t, map[string]string{"review.json": twoComments}))
	if err != nil {
		t.Fatal(err)
	}
	if p.Rounds[0].Ref(1) != nil || p.Rounds[0].Ref(3) != nil {
		t.Fatalf("plain comments have no ref")
	}
}
