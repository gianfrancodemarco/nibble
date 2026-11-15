package cmd

import (
	"embed"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gianfrancodemarco/nibble/cli/internal/protocol"
)

//go:embed ui
var uiFS embed.FS

// apiServer is the reader's data plane: everything protocol-shaped (parsing,
// trust, git) happens here, server-side; the UI only presents what it gets.
//
// It degrades per ref by what is actually available: a full git repo serves
// everything; a plain directory of files serves plain and worktree refs and
// marks base..head refs unverified; a missing root marks every ref
// unverified while the plate (and the review loop) keep working.
type apiServer struct {
	plateDir string
	repoName string  // the header's repo field, verbatim, for messages
	root     string  // resolved root; "" when missing
	git      gitRepo // nil when the root is not a git repository's top level

	// the hand-over: once serve has exited and a keeper holds this server,
	// the next serve posts the recorded token here to take the address back
	handoffToken string
	handoff      chan struct{}
	handoffOnce  sync.Once
}

// trustUnverified is presentation-level only: "could not check", as opposed
// to the protocol's stale, "checked, and the code moved". Never persisted.
const trustUnverified = "unverified"

// newAPIServer resolves the plate's root. The plate itself is re-read per
// request so an open plate being written stays current.
func newAPIServer(plateDir string) (*apiServer, error) {
	p, err := protocol.ParsePlate(plateDir)
	if err != nil {
		return nil, err
	}
	s := &apiServer{plateDir: plateDir, repoName: p.Header.Repo, handoff: make(chan struct{})}
	root := p.Header.Repo
	if !filepath.IsAbs(root) {
		root = filepath.Join(plateDir, root)
	}
	if st, err := os.Stat(root); err != nil || !st.IsDir() {
		return s, nil
	}
	s.root = root
	// Git counts only when the root is itself a repository's top level —
	// a snapshot directory that merely sits inside some other repo (like a
	// golden fixture inside this one) must not inherit that repo's git.
	if g, err := openGit(root); err == nil {
		if top, err := g.Root(); err == nil && samePath(top, root) {
			s.root, s.git = top, g
		}
	}
	return s, nil
}

func samePath(a, b string) bool {
	ra, err1 := filepath.EvalSymlinks(a)
	rb, err2 := filepath.EvalSymlinks(b)
	return err1 == nil && err2 == nil && ra == rb
}

func (s *apiServer) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/plate", s.servePlate)
	mux.HandleFunc("GET /api/code", s.serveCode)
	mux.HandleFunc("GET /api/ledger", s.serveLedger)
	mux.HandleFunc("POST /api/review", s.serveReview)
	mux.HandleFunc("GET /api/events", s.serveEvents)
	mux.HandleFunc("POST /api/handoff", s.serveHandoff)
	ui, err := fs.Sub(uiFS, "ui")
	if err != nil {
		panic(err) // embed is fixed at build time
	}
	mux.Handle("GET /", http.FileServerFS(ui))
	return mux
}

func httpError(w http.ResponseWriter, status int, err error) {
	code := protocol.ErrCode(err)
	msg := err.Error()
	if pe, ok := err.(*protocol.Error); ok {
		msg = pe.Msg
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]any{
		"error": map[string]string{"code": code, "message": msg},
	})
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

// --- trust ---

type apiTrust struct {
	Level string `json:"level"`
	Line  int    `json:"line"`
	Shift int    `json:"shift"`
}

type apiRef struct {
	Ref    string   `json:"ref"`
	Path   string   `json:"path"`
	Start  int      `json:"start"`
	End    int      `json:"end"`
	At     string   `json:"at"` // the lines' address in the ref grammar, without a range
	Anchor string   `json:"anchor,omitempty"`
	Note   string   `json:"note,omitempty"`
	Diff   bool     `json:"diff,omitempty"`
	Trust  apiTrust `json:"trust"`
}

// refAt is the location part of a ref string — what a client prefixes to
// `:<start>-<end>` to name lines of the same file and side without knowing
// the grammar: `src/a.ts`, `diff:src/a.ts@worktree`,
// `diff:src/a.ts@<base>..<head>#<side>`.
func refAt(ref protocol.Ref) string {
	if ref.Diff == nil {
		return ref.Path
	}
	if ref.Diff.Worktree {
		return "diff:" + ref.Path + "@worktree"
	}
	return fmt.Sprintf("diff:%s@%s..%s#%s", ref.Path, ref.Diff.Base, ref.Diff.Head, ref.Diff.Side)
}

// unverifiable says why a ref cannot be checked with what is available, or
// "" when it can.
func (s *apiServer) unverifiable(ref protocol.Ref) string {
	if s.root == "" {
		return fmt.Sprintf("the plate's root %s isn't on this machine", s.repoName)
	}
	if ref.Diff != nil && !ref.Diff.Worktree && s.git == nil {
		return fmt.Sprintf("%s isn't a git repository, needed to resolve %s..%s",
			s.repoName, ref.Diff.Base, ref.Diff.Head)
	}
	return ""
}

// resolveRef parses a stored ref and computes its trust against the code as
// it is now. The current content is returned for the drawer (nil = missing
// or unverifiable).
func (s *apiServer) resolveRef(nr protocol.NibbleRef) (apiRef, *protocol.FileContent, error) {
	ref, err := protocol.ParseRef(nr.Ref)
	if err != nil {
		return apiRef{}, nil, err
	}
	out := apiRef{
		Ref: nr.Ref, Path: ref.Path, Start: ref.Start, End: ref.End, At: refAt(ref),
		Anchor: ref.Anchor, Note: ref.Note, Diff: ref.Diff != nil,
		Trust: apiTrust{Level: trustUnverified, Line: ref.Start},
	}
	if s.unverifiable(ref) != "" {
		return out, nil, nil
	}
	content, err := loadRefContent(s.root, s.git, ref)
	if err != nil {
		return apiRef{}, nil, err
	}
	if nr.FP == "" {
		// A bare ref (a hand-written comment's): nothing to check against,
		// so the lines are served at their stated range, unverified. An
		// empty fingerprint would otherwise match at every position.
		return out, content, nil
	}
	fp := &protocol.Fingerprint{
		Sum: nr.FP, Lines: nr.Lines,
		CtxBefore: nr.CtxBefore, CtxAfter: nr.CtxAfter,
	}
	level, shift := fp.Trust(ref.Start, content)
	out.Trust = apiTrust{Level: string(level), Line: ref.Start, Shift: shift}
	if level == protocol.TrustShifted {
		out.Trust.Line = ref.Start + shift
	}
	return out, content, nil
}

// --- GET /api/plate ---

func (s *apiServer) servePlate(w http.ResponseWriter, r *http.Request) {
	p, err := protocol.ParsePlate(s.plateDir)
	if err != nil {
		httpError(w, http.StatusConflict, err)
		return
	}
	type nibbleOut struct {
		N           int                   `json:"n"`
		Title       string                `json:"title"`
		Description *protocol.Description `json:"description,omitempty"`
		Because     string                `json:"because,omitempty"`
		Visual      json.RawMessage       `json:"visual"`
		Refs        []apiRef              `json:"refs"`
	}
	nibbles := make([]nibbleOut, 0, len(p.Nibbles))
	for i, n := range p.Nibbles {
		out := nibbleOut{
			N: i + 1, Title: n.Title, Description: n.Description, Because: n.Because,
			Visual: n.Visual, Refs: make([]apiRef, 0, len(n.Refs)),
		}
		for _, nr := range n.Refs {
			ar, _, err := s.resolveRef(nr)
			if err != nil {
				httpError(w, http.StatusInternalServerError, err)
				return
			}
			out.Refs = append(out.Refs, ar)
		}
		nibbles = append(nibbles, out)
	}
	thread, err := s.threadOut(p)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err)
		return
	}
	about := map[string]any{"kind": p.Header.About.Kind}
	if p.Header.About.PR != 0 {
		about["pr"] = p.Header.About.PR
	}
	if p.Header.About.Range != "" {
		about["range"] = p.Header.About.Range
	}
	out := map[string]any{
		"title":    p.Header.Title,
		"repo":     p.Header.Repo,
		"head_sha": p.Header.HeadSHA,
		"about":    about,
		"open":     p.Open,
		"total":    p.Total,
		"thread":   thread,
		"ledger":   p.Ledger,
		"nibbles":  nibbles,
		"source": map[string]any{
			"path":  p.Header.Repo,
			"found": s.root != "",
			"git":   s.git != nil,
		},
	}
	if p.Header.Description != nil {
		out["description"] = p.Header.Description
	}
	if p.Header.Because != "" {
		out["because"] = p.Header.Because
	}
	writeJSON(w, out)
}

// --- the thread: whose turn, every round's comments with their replies ---

type apiReply struct {
	Text    string   `json:"text"`
	Because string   `json:"because,omitempty"`
	Refs    []apiRef `json:"refs"`
}

type apiComment struct {
	ID     string    `json:"id"`
	Target string    `json:"target,omitempty"`
	Ref    *apiRef   `json:"ref,omitempty"` // the lines the thread is on, resolved (a follow-up shows its opener's)
	Thread string    `json:"thread,omitempty"`
	Text   string    `json:"text"`
	Reply  *apiReply `json:"reply"`
}

type apiRound struct {
	N        int          `json:"n"`
	Comments []apiComment `json:"comments"`
}

type apiThread struct {
	Turn   string     `json:"turn"`
	Rounds []apiRound `json:"rounds"`
}

func (s *apiServer) threadOut(p *protocol.Plate) (apiThread, error) {
	out := apiThread{Turn: string(p.Turn()), Rounds: []apiRound{}}
	for _, r := range p.Rounds {
		round := apiRound{N: r.N, Comments: []apiComment{}}
		for i, c := range r.Review.Comments {
			ac := apiComment{ID: c.ID, Target: r.Target(i + 1), Thread: c.Thread, Text: c.Text}
			if nr := r.Ref(i + 1); nr != nil {
				ref, _, err := s.resolveRef(*nr)
				if err != nil {
					return out, err
				}
				ac.Ref = &ref
			}
			if rep := r.ReplyTo(i + 1); rep != nil {
				ar := &apiReply{Text: rep.Text, Because: rep.Because, Refs: []apiRef{}}
				for _, nr := range rep.Refs {
					ref, _, err := s.resolveRef(nr)
					if err != nil {
						return out, err
					}
					ar.Refs = append(ar.Refs, ref)
				}
				ac.Reply = ar
			}
			round.Comments = append(round.Comments, ac)
		}
		out.Rounds = append(out.Rounds, round)
	}
	return out, nil
}

// --- GET /api/code?n=<N>&ref=<I> · ?round=<K>&comment=<I>&ref=<J> · ?comment=<id> ---

const drawerContext = 3

// lineOut is one drawer line: numbered, marked in/out of the shown range.
type lineOut struct {
	No   int    `json:"no"`
	Text string `json:"text"`
	In   bool   `json:"in"`
}

func (s *apiServer) serveCode(w http.ResponseWriter, r *http.Request) {
	p, err := protocol.ParsePlate(s.plateDir)
	if err != nil {
		httpError(w, http.StatusConflict, err)
		return
	}
	q := r.URL.Query()
	ri, _ := strconv.Atoi(q.Get("ref"))
	var refs []protocol.NibbleRef
	if q.Has("comment") && !q.Has("round") {
		// a comment's lines, by its id (a follow-up serves its opener's)
		nr := commentRef(p, q.Get("comment"))
		if nr == nil {
			httpError(w, http.StatusNotFound, errf(protocol.CodeReviewRef, "no comment %q with lines", q.Get("comment")))
			return
		}
		refs, ri = []protocol.NibbleRef{*nr}, 0
	} else if q.Has("round") {
		// a reply's ref: round K's reply to comment I
		k, _ := strconv.Atoi(q.Get("round"))
		ci, _ := strconv.Atoi(q.Get("comment"))
		if k < 1 || k > len(p.Rounds) {
			httpError(w, http.StatusNotFound, errf(protocol.CodeReplyTarget, "no round %d", k))
			return
		}
		rep := p.Rounds[k-1].ReplyTo(ci)
		if rep == nil {
			httpError(w, http.StatusNotFound, errf(protocol.CodeReplyTarget, "round %d has no reply to comment %d", k, ci))
			return
		}
		if ri < 0 || ri >= len(rep.Refs) {
			httpError(w, http.StatusNotFound, errf("ref.syntax", "that reply has no ref %d", ri))
			return
		}
		refs = rep.Refs
	} else {
		n, _ := strconv.Atoi(q.Get("n"))
		if n < 1 || n > len(p.Nibbles) {
			httpError(w, http.StatusNotFound, errf("nibble.file", "no nibble %d", n))
			return
		}
		refs = p.Nibbles[n-1].Refs
		if ri < 0 || ri >= len(refs) {
			httpError(w, http.StatusNotFound, errf("ref.syntax", "nibble %d has no ref %d", n, ri))
			return
		}
	}
	ar, content, err := s.resolveRef(refs[ri])
	if err != nil {
		httpError(w, http.StatusInternalServerError, err)
		return
	}
	var why string
	if pref, err := protocol.ParseRef(refs[ri].Ref); err == nil {
		why = s.unverifiable(pref)
	}
	out := map[string]any{
		"ref": ar.Ref, "path": ar.Path, "at": ar.At, "trust": ar.Trust,
		"missing": content == nil && why == "", "lines": []lineOut{},
	}
	if why != "" {
		out["why"] = "code unavailable — " + why
	}
	if content != nil {
		out["lines"] = rangeLines(ar, content, drawerContext)
	}
	writeJSON(w, out)
}

// rangeLines is a resolved ref's lines with ctxN lines of context each
// side, the range marked in-range — shown where trust resolved it (shifted
// follows the code; stale shows the original range).
func rangeLines(ar apiRef, content *protocol.FileContent, ctxN int) []lineOut {
	start, end := ar.Start, ar.End
	if ar.Trust.Level == string(protocol.TrustShifted) {
		start += ar.Trust.Shift
		end += ar.Trust.Shift
	}
	lo := max(1, start-ctxN)
	hi := min(len(content.Lines), end+ctxN)
	lines := make([]lineOut, 0, max(0, hi-lo+1))
	for i := lo; i <= hi; i++ {
		lines = append(lines, lineOut{
			No: i, Text: content.Lines[i-1], In: i >= start && i <= end,
		})
	}
	return lines
}

// commentRef finds the lines comment id ("<round>.<index>") points at, or
// nil when there is no such comment or it is on a target, not lines.
func commentRef(p *protocol.Plate, id string) *protocol.NibbleRef {
	var k, i int
	if _, err := fmt.Sscanf(id, "%d.%d", &k, &i); err != nil || k < 1 || k > len(p.Rounds) {
		return nil
	}
	return p.Rounds[k-1].Ref(i)
}

// --- GET /api/ledger?file=<path>&side=<head|base> ---

// ledgerHunkRef synthesizes the ref-shaped address of a ledger hunk, so the
// drawer resolves and degrades exactly like a nibble ref: head-side hunks of
// a worktree plate read the file on disk, base-side hunks read the recorded
// base commit, range plates read their two revs through git.
func ledgerHunkRef(hdr protocol.PlateHeader, h protocol.LedgerHunk) protocol.Ref {
	ref := protocol.Ref{Path: h.Path, Start: h.Start, End: h.End}
	switch hdr.About.Kind {
	case "worktree":
		if h.Side == "base" {
			ref.Diff = &protocol.DiffSpec{Base: hdr.HeadSHA, Head: hdr.HeadSHA, Side: "base"}
		}
	case "range":
		base, head, _ := strings.Cut(hdr.About.Range, "..")
		ref.Diff = &protocol.DiffSpec{Base: base, Head: head, Side: h.Side}
	}
	return ref
}

func (s *apiServer) serveLedger(w http.ResponseWriter, r *http.Request) {
	p, err := protocol.ParsePlate(s.plateDir)
	if err != nil {
		httpError(w, http.StatusConflict, err)
		return
	}
	if p.Ledger == nil {
		httpError(w, http.StatusNotFound, errf(protocol.CodePlateLedger, "this plate has no ledger"))
		return
	}
	path := r.URL.Query().Get("file")
	side := r.URL.Query().Get("side")
	if side == "" {
		side = "head"
	}
	var hunks []protocol.LedgerHunk
	if side == "head" || side == "base" {
		for _, h := range p.Ledger.Hunks {
			if h.Path == path && h.Side == side {
				hunks = append(hunks, h)
			}
		}
	}
	if len(hunks) == 0 {
		httpError(w, http.StatusNotFound, errf(protocol.CodePlateLedger,
			"the ledger has no %s-side hunks for %q", side, path))
		return
	}
	out := map[string]any{
		"path": path, "side": side, "hunks": len(hunks),
		"at":      refAt(ledgerHunkRef(p.Header, hunks[0])),
		"missing": false, "lines": []lineOut{},
	}
	if hunks[0].Binary {
		out["why"] = "binary file — no lines to show"
		writeJSON(w, out)
		return
	}
	ref := ledgerHunkRef(p.Header, hunks[0])
	if why := s.unverifiable(ref); why != "" {
		out["why"] = "code unavailable — " + why
		writeJSON(w, out)
		return
	}
	content, err := loadRefContent(s.root, s.git, ref)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err)
		return
	}
	if content == nil {
		out["missing"] = true
		writeJSON(w, out)
		return
	}
	// One segment of ±drawerContext per hunk, merged where they meet; a line
	// is in-range when an uncovered hunk holds it — covered hunks show as
	// plain context. Hunks arrive in diff order.
	in := func(n int) bool {
		for _, h := range hunks {
			if !h.Covered && n >= h.Start && n <= h.End {
				return true
			}
		}
		return false
	}
	var lines []lineOut
	last := 0
	for _, h := range hunks {
		lo := max(max(1, h.Start-drawerContext), last+1)
		hi := min(len(content.Lines), h.End+drawerContext)
		for n := lo; n <= hi; n++ {
			lines = append(lines, lineOut{No: n, Text: content.Lines[n-1], In: in(n)})
		}
		last = max(last, hi)
	}
	out["lines"] = lines
	writeJSON(w, out)
}

// --- POST /api/review ---

// serveReview writes the posted review as the next round. It is refused
// while the latest round still awaits the agent's replies (review.exists)
// and when a thread link does not resolve (review.thread) — before anything
// is written. A done round is not an end: the next round may follow it.
func (s *apiServer) serveReview(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))
	if err != nil {
		httpError(w, http.StatusBadRequest, errf(protocol.CodeReviewMalformed, "review: %v", err))
		return
	}
	rev, perr := protocol.ParseReview(body)
	if perr != nil {
		httpError(w, http.StatusBadRequest, perr)
		return
	}
	if err := s.fingerprintCommentRefs(rev); err != nil {
		httpError(w, http.StatusBadRequest, err)
		return
	}
	unlock, err := lockDir(s.plateDir)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err)
		return
	}
	defer unlock()
	p, err := protocol.ParsePlate(s.plateDir)
	if err != nil {
		httpError(w, http.StatusConflict, err)
		return
	}
	if latest := p.Latest(); latest != nil {
		if !latest.Answered() {
			httpError(w, http.StatusConflict, errf(protocol.CodeReviewExists,
				"round %d still awaits the agent's reply (%d of %d answered)", latest.N, latest.AnsweredCount(), len(latest.Review.Comments)))
			return
		}
	}
	round, err := protocol.NextRound(p.Rounds, rev)
	if err != nil {
		httpError(w, http.StatusBadRequest, err)
		return
	}
	raw, err := json.MarshalIndent(rev, "", "  ")
	if err != nil {
		httpError(w, http.StatusInternalServerError, err)
		return
	}
	if err := writeAtomic(filepath.Join(s.plateDir, protocol.ReviewFile(round.N)), append(raw, '\n')); err != nil {
		httpError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, map[string]any{"ok": true, "round": round.N})
}

// fingerprintCommentRefs verifies each comment's ref — the reader posts
// `{"ref": "<at>:<start>-<end>"}` built from a drawer — against the code as
// `add` would (grammar, no anchor, the range inside the file) and stores
// its fingerprint, so the lines carry trust from then on. Code that is not
// available on this machine (per-ref degradation) leaves the ref bare:
// stored as given, unverified when served.
func (s *apiServer) fingerprintCommentRefs(rev *protocol.Review) error {
	for i := range rev.Comments {
		nr := rev.Comments[i].Ref
		if nr == nil || nr.FP != "" {
			continue
		}
		ref, err := protocol.ParseRef(nr.Ref)
		if err != nil {
			return err
		}
		if ref.Anchor != "" {
			return errf(protocol.CodeReviewRef, "comment %d: ref %q carries @%s, but a comment ref takes no anchor — the target already names the element", i+1, nr.Ref, ref.Anchor)
		}
		if s.unverifiable(ref) != "" {
			continue
		}
		content, err := loadRefContent(s.root, s.git, ref)
		if err != nil {
			return err
		}
		if err := protocol.CheckRef(ref, content); err != nil {
			return err
		}
		fp, err := protocol.NewFingerprint(content, ref.Start, ref.End)
		if err != nil {
			return err
		}
		nr.FP, nr.Lines, nr.CtxBefore, nr.CtxAfter = fp.Sum, fp.Lines, fp.CtxBefore, fp.CtxAfter
	}
	return nil
}

// --- POST /api/handoff ---

// serveHandoff lets the next serve take the address back from a keeper:
// the token recorded in the plate directory, and nothing else, stands the
// keeper down. A server that is not a keeper has no token and refuses.
func (s *apiServer) serveHandoff(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&body); err != nil || s.handoffToken == "" || body.Token != s.handoffToken {
		httpError(w, http.StatusForbidden, fmt.Errorf("not a keeper, or the wrong token"))
		return
	}
	writeJSON(w, map[string]any{"ok": true})
	s.handoffOnce.Do(func() { close(s.handoff) })
}

// --- GET /api/events ---

// plateSnapshot is what the SSE poller diffs: enough to notice a new nibble,
// the seal, and the review.
type plateSnapshot struct {
	nibbles  int
	total    int
	rounds   int // review rounds on disk
	comments int // comments of the latest round
	answered int // replies of the latest round
}

func (s *apiServer) snapshot() plateSnapshot {
	var snap plateSnapshot
	for n := 1; ; n++ {
		if _, err := os.Stat(filepath.Join(s.plateDir, fmt.Sprintf("n%d.json", n))); err != nil {
			break
		}
		snap.nibbles = n
	}
	if raw, err := os.ReadFile(filepath.Join(s.plateDir, "done")); err == nil {
		var d struct {
			Total int `json:"total"`
		}
		if json.Unmarshal(raw, &d) == nil {
			snap.total = d.Total
		}
	}
	if p, err := protocol.ParsePlate(s.plateDir); err == nil {
		snap.rounds = len(p.Rounds)
		if r := p.Latest(); r != nil {
			snap.comments = len(r.Review.Comments)
			snap.answered = r.AnsweredCount()
		}
	}
	return snap
}

func (s *apiServer) serveEvents(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		httpError(w, http.StatusInternalServerError, fmt.Errorf("streaming unsupported"))
		return
	}
	// The baseline is taken before the client hears "connected", so a
	// change right after the connect is never missed.
	last := s.snapshot()
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	fmt.Fprint(w, ": connected\n\n")
	flusher.Flush()

	emit := func(event, data string) {
		fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, data)
		flusher.Flush()
	}
	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-ticker.C:
			cur := s.snapshot()
			for n := last.nibbles + 1; n <= cur.nibbles; n++ {
				emit("nibble", fmt.Sprintf(`{"n":%d}`, n))
			}
			if cur.total != 0 && last.total == 0 {
				emit("sealed", fmt.Sprintf(`{"total":%d}`, cur.total))
			}
			if cur.rounds > last.rounds {
				emit("review", fmt.Sprintf(`{"round":%d,"comments":%d}`, cur.rounds, cur.comments))
			} else if cur.rounds == last.rounds && cur.rounds > 0 && cur.answered > last.answered {
				emit("reply", fmt.Sprintf(`{"round":%d,"answered":%d,"of":%d}`, cur.rounds, cur.answered, cur.comments))
			}
			last = cur
		}
	}
}
