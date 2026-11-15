package cmd

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/gianfrancodemarco/nibble/cli/internal/protocol"
)

// pollInterval is how often serve checks for the review. The spec's budget is
// detection within 2 seconds; 250ms leaves margin without fsnotify.
const pollInterval = 250 * time.Millisecond

// Review exit codes: the stable contract agents script against. They say
// what the agent owes when serve ends: 2 a round with comments it has not
// replied to, 0 the thread closed by done, 5 it stopped waiting with nothing
// owed; 1 stays reserved for errors.
const exitTimeout = 5

// keeperDefaultTimeout bounds a keeper when serve ran without --timeout.
const keeperDefaultTimeout = 2 * time.Hour

func roundExit(r *protocol.Round) int {
	if r.Done() {
		return 0
	}
	return 2
}

// serveRecord is .serve.json in the plate directory — a dotfile the
// protocol ignores: where the plate is (or was last) served, the token
// that stands its keeper down, and the round the last serve ended with.
type serveRecord struct {
	Addr    string `json:"addr,omitempty"`
	Token   string `json:"token,omitempty"`
	Printed int    `json:"printed"`
}

const serveRecordFile = ".serve.json"

func readServeRecord(plateDir string) *serveRecord {
	raw, err := os.ReadFile(filepath.Join(plateDir, serveRecordFile))
	if err != nil {
		return nil
	}
	var rec serveRecord
	if json.Unmarshal(raw, &rec) != nil {
		return nil
	}
	return &rec
}

func writeServeRecord(plateDir string, rec serveRecord) {
	raw, _ := json.Marshal(rec)
	_ = writeAtomic(filepath.Join(plateDir, serveRecordFile), append(raw, '\n'))
}

// Keeper is what serve hands over when it exits on a round: the running
// server (in-process) or the listener (to a child process), the token that
// stands it down, and how long it may live.
type Keeper struct {
	PlateDir string
	Addr     string
	Token    string
	Timeout  time.Duration
	Srv      *http.Server // the server already serving, when kept in-process
	API      *apiServer
	Ln       net.Listener
}

// runKeeper keeps serving until the next serve posts the token to
// /api/handoff, the timeout elapses, or the plate directory is gone. It
// never prints and never wakes anyone: waiting stays serve's job.
func runKeeper(k Keeper) {
	srv, api := k.Srv, k.API
	if srv == nil {
		var err error
		if api, err = newAPIServer(k.PlateDir); err != nil {
			return
		}
		api.handoffToken = k.Token
		srv = &http.Server{Handler: api.handler()}
		go srv.Serve(k.Ln)
	}
	timeout := k.Timeout
	if timeout <= 0 {
		timeout = keeperDefaultTimeout
	}
	gone := time.NewTicker(5 * time.Second)
	defer gone.Stop()
	for {
		select {
		case <-api.handoff:
			srv.Close()
			return
		case <-time.After(timeout):
			srv.Close()
			return
		case <-gone.C:
			if _, err := os.Stat(k.PlateDir); err != nil {
				srv.Close()
				return
			}
		}
	}
}

// spawnKeeper is the production Keep: `nibble serve <plate> --keeper` in
// its own session, with the listening socket inherited as fd 3, so the
// address never closes between serve's exit and the next serve.
func spawnKeeper(k Keeper) {
	exe, err := os.Executable()
	if err != nil {
		return
	}
	tcp, ok := k.Ln.(*net.TCPListener)
	if !ok {
		return
	}
	f, err := tcp.File()
	if err != nil {
		return
	}
	defer f.Close()
	cmd := exec.Command(exe, "serve", k.PlateDir, "--keeper", "--addr", k.Addr, "--timeout", k.Timeout.String())
	cmd.ExtraFiles = []*os.File{f}
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := cmd.Start(); err != nil {
		return
	}
	go cmd.Wait() // reap if it ever ends while we still exist
}

// runKeeperChild is the child side of spawnKeeper.
func runKeeperChild(ctx Ctx, plateDir string, timeout time.Duration) int {
	f := os.NewFile(3, "listener")
	ln, err := net.FileListener(f)
	f.Close()
	if err != nil {
		fmt.Fprintf(ctx.Stderr, "nibble serve --keeper: %v\n", err)
		return 1
	}
	rec := readServeRecord(plateDir)
	if rec == nil {
		return 1
	}
	runKeeper(Keeper{PlateDir: plateDir, Addr: rec.Addr, Token: rec.Token, Timeout: timeout, Ln: ln})
	return 0
}

// postHandoff asks the keeper on addr to stand down; reports whether one
// answered, so the caller knows whether to wait for the port.
func postHandoff(addr, token string) bool {
	body, _ := json.Marshal(map[string]string{"token": token})
	client := &http.Client{Timeout: time.Second}
	resp, err := client.Post("http://"+addr+"/api/handoff", "application/json", bytes.NewReader(body))
	if err != nil {
		return false
	}
	resp.Body.Close()
	return resp.StatusCode == 200
}

// listenRetry binds addr, waiting up to wait for a keeper to let go.
func listenRetry(addr string, wait time.Duration) (net.Listener, error) {
	deadline := time.Now().Add(wait)
	for {
		ln, err := net.Listen("tcp", addr)
		if err == nil || time.Now().After(deadline) {
			return ln, err
		}
		time.Sleep(50 * time.Millisecond)
	}
}

func newToken() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(b)
}

// RunServe blocks until the plate's thread gains a round, prints it, and
// exits with its code (2 comments to answer, 0 done — nothing to address
// now; the chat stays open). The process ending is what
// wakes the agent that started it — but with the reader up the page
// outlives the exit: the server is handed to a keeper, so replies the
// agent writes land in the open tab, and the next serve takes the address
// back. A round the agent already answered is waited past; the round the
// previous serve ended with is served while the replies stream in; a round
// that landed while nothing was waiting is printed at once, as headless
// serve prints any owed round — the resume path for scripts.
func RunServe(ctx Ctx, args []string) int {
	plateDir, args := popArg(args)
	fs := flag.NewFlagSet("serve", flag.ContinueOnError)
	fs.SetOutput(ctx.Stderr)
	timeout := fs.Duration("timeout", 0, "give up after this long (0 = wait forever)")
	jsonOut := fs.Bool("json", false, "machine output")
	addr := fs.String("addr", "", "reader address (loopback only; default: the address last served, else a random port)")
	noUI := fs.Bool("no-ui", false, "wait headless, serve no reader")
	keeperMode := fs.Bool("keeper", false, "internal: keep serving an inherited listener")
	if err := fs.Parse(args); err != nil {
		return 2
	}
	if plateDir == "" {
		plateDir = fs.Arg(0)
	}
	if plateDir == "" {
		fmt.Fprintln(ctx.Stderr, "nibble serve: <plate> is required")
		return 2
	}
	if *keeperMode {
		return runKeeperChild(ctx, plateDir, *timeout)
	}

	// Fail on an invalid plate before blocking.
	plate, err := protocol.ParsePlate(plateDir)
	if err != nil {
		return fail(ctx, *jsonOut, err)
	}
	rec := readServeRecord(plateDir)

	// The reader: served while we wait, loopback only. A review submitted
	// through it lands as a review file and ends the wait below — one code
	// path however the review arrives. The address is the one last served
	// when none is given, and a keeper holding it is asked to stand down.
	// note records the round this serve ended with; keep also hands the
	// running server over when the reader is up.
	note := func(printed int) {
		prev := serveRecord{}
		if rec != nil {
			prev = *rec
		}
		prev.Printed = printed
		writeServeRecord(plateDir, prev)
	}
	keep := note
	if !*noUI {
		fromRecord := false
		if *addr == "" {
			*addr = "127.0.0.1:0"
			if rec != nil && rec.Addr != "" {
				*addr, fromRecord = rec.Addr, true
			}
		}
		host, _, err := net.SplitHostPort(*addr)
		if err != nil || (host != "127.0.0.1" && host != "localhost") {
			fmt.Fprintf(ctx.Stderr, "nibble serve: --addr must stay on 127.0.0.1, got %q\n", *addr)
			return 2
		}
		var wait time.Duration // a keeper that answered needs a moment to let go
		if rec != nil && rec.Token != "" && rec.Addr == *addr && postHandoff(rec.Addr, rec.Token) {
			wait = 3 * time.Second
		}
		api, err := newAPIServer(plateDir)
		if err != nil {
			return fail(ctx, *jsonOut, err)
		}
		ln, err := listenRetry(*addr, wait)
		if err != nil && fromRecord {
			ln, err = net.Listen("tcp", "127.0.0.1:0") // the record was stale
		}
		if err != nil {
			return fail(ctx, *jsonOut, err)
		}
		srv := &http.Server{Handler: api.handler()}
		go srv.Serve(ln)
		fmt.Fprintf(ctx.Stderr, "reader: http://%s\n", ln.Addr())
		handed := false
		defer func() {
			if !handed {
				srv.Close()
			}
		}()
		keep = func(printed int) {
			handed = true
			k := Keeper{PlateDir: plateDir, Addr: ln.Addr().String(), Token: newToken(), Timeout: *timeout, Srv: srv, API: api, Ln: ln}
			api.handoffToken = k.Token
			writeServeRecord(plateDir, serveRecord{Addr: k.Addr, Token: k.Token, Printed: printed})
			if ctx.Keep != nil {
				ctx.Keep(k)
				return
			}
			// a child takes the socket; this process stops serving it
			k.Srv, k.API = nil, nil
			spawnKeeper(k)
			srv.Close()
		}
	}

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(sig)
	var timer <-chan time.Time
	if *timeout > 0 {
		timer = time.After(*timeout)
	}

	// Whose round is this? An unanswered round the previous serve did not
	// end with — it landed while nothing was waiting, or was written by
	// hand — is owed and printed at once; so is any owed round headless.
	// The round the previous serve did end with is what the agent is
	// answering now: with the reader up, serve it and wait for the next. A
	// done round is nothing to address: wait for the next like any answered
	// one — the chat never closes.
	if latest := plate.Latest(); latest != nil && !latest.Answered() {
		if seen := rec != nil && rec.Printed == latest.N; *noUI || !seen {
			printRound(ctx, *jsonOut, plateDir, plate, latest)
			keep(latest.N)
			return 2
		}
	}

	// Wait for the next round: a review file numbered past what exists now.
	known := len(plate.Rounds)
	nextPath := filepath.Join(plateDir, protocol.ReviewFile(known+1))
	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()
	// stopped: the wait ended by signal or timeout; the exit says what is
	// owed right now. Nothing is handed over: nobody is about to answer.
	stopped := func() int {
		fresh, err := protocol.ParsePlate(plateDir)
		if err != nil {
			return fail(ctx, *jsonOut, err)
		}
		if latest := fresh.Latest(); latest != nil && !latest.Answered() {
			printRound(ctx, *jsonOut, plateDir, fresh, latest)
			return roundExit(latest)
		}
		fmt.Fprintf(ctx.Stderr, "nibble serve: no review after %s\n", *timeout)
		return exitTimeout
	}
	for {
		select {
		case <-ticker.C:
			raw, err := os.ReadFile(nextPath)
			if err != nil {
				continue
			}
			fresh, perr := protocol.ParsePlate(plateDir)
			if perr == nil && len(fresh.Rounds) > known {
				latest := fresh.Latest()
				printRound(ctx, *jsonOut, plateDir, fresh, latest)
				keep(latest.N) // the page stays up: replies land live, and done is no end
				return roundExit(latest)
			}
			if perr != nil && json.Valid(raw) {
				// Complete JSON the plate still refuses is a bad round, not a
				// mid-write snapshot: fail, don't hang.
				return fail(ctx, *jsonOut, perr)
			}
			// Incomplete JSON: likely mid-write; keep waiting.
		case <-sig:
			return stopped()
		case <-timer:
			return stopped()
		}
	}
}

// printRound prints the round that ended the wait: markdown by default, the
// review object with `round`, per-comment `id` and thread `history` as JSON.
// A follow-up prints the conversation it continues before its own text, so
// the agent reads the thread, not a fragment; a comment on lines prints its
// location on the heading and quotes the lines, so the agent reads the code
// the human pointed at without opening the file.
func printRound(ctx Ctx, jsonOut bool, plateDir string, p *protocol.Plate, r *protocol.Round) {
	// the API server doubles as the ref resolver: the plate's root, git when
	// the root is a repository, per-ref degradation when they are missing
	res, _ := newAPIServer(plateDir)
	type refOut struct {
		apiRef
		Lines []lineOut `json:"lines"`
		Why   string    `json:"why,omitempty"`
	}
	resolve := func(nr *protocol.NibbleRef) *refOut {
		if nr == nil || res == nil {
			return nil
		}
		ar, content, err := res.resolveRef(*nr)
		if err != nil {
			return nil
		}
		out := &refOut{apiRef: ar, Lines: []lineOut{}}
		if pref, err := protocol.ParseRef(nr.Ref); err == nil {
			if why := res.unverifiable(pref); why != "" {
				out.Why = "code unavailable — " + why
			}
		}
		if content == nil {
			if out.Why == "" {
				out.Why = "the file is gone"
			}
			return out
		}
		out.Lines = rangeLines(ar, content, 0)
		return out
	}
	if jsonOut {
		type commentOut struct {
			ID      string             `json:"id"`
			Target  string             `json:"target,omitempty"`
			Ref     *refOut            `json:"ref,omitempty"`
			Thread  string             `json:"thread,omitempty"`
			Text    string             `json:"text"`
			History []protocol.Message `json:"history,omitempty"`
		}
		out := struct {
			Round    int          `json:"round"`
			Comments []commentOut `json:"comments"`
		}{Round: r.N, Comments: []commentOut{}}
		for i, c := range r.Review.Comments {
			out.Comments = append(out.Comments, commentOut{
				ID: c.ID, Target: r.Target(i + 1), Ref: resolve(r.Ref(i + 1)), Thread: c.Thread, Text: c.Text,
				History: p.History(r.N, i+1),
			})
		}
		raw, _ := json.Marshal(out)
		fmt.Fprintln(ctx.Stdout, string(raw))
		return
	}
	var b strings.Builder
	if r.Done() {
		fmt.Fprintf(&b, "done — no comments · round %d\n", r.N)
	} else {
		fmt.Fprintf(&b, "comments: %d · round %d\n", len(r.Review.Comments), r.N)
	}
	quote := func(text string) {
		for _, line := range strings.Split(strings.TrimSpace(text), "\n") {
			fmt.Fprintf(&b, "> %s\n", line)
		}
	}
	lines := func(nr *protocol.NibbleRef) {
		ro := resolve(nr)
		if ro == nil {
			return
		}
		switch {
		case ro.Why != "":
			fmt.Fprintf(&b, "(the lines could not be read: %s)\n", ro.Why)
			return
		case ro.Trust.Level == string(protocol.TrustShifted):
			fmt.Fprintf(&b, "(moved: now %s)\n", rangeLabel(ro.Trust.Line, ro.Trust.Line+ro.End-ro.Start))
		case ro.Trust.Level == string(protocol.TrustStale):
			fmt.Fprintf(&b, "(stale: the code at these lines was rewritten — showing the original range)\n")
		}
		if len(ro.Lines) == 0 {
			return
		}
		b.WriteString("```\n")
		for _, l := range ro.Lines {
			fmt.Fprintf(&b, "%d  %s\n", l.No, l.Text)
		}
		b.WriteString("```\n")
	}
	for i, c := range r.Review.Comments {
		target := r.Target(i + 1)
		if target == "" {
			target = "plate"
		}
		if nr := r.Ref(i + 1); nr != nil {
			target += " · " + refLabel(*nr)
		}
		if c.Thread != "" {
			fmt.Fprintf(&b, "\n## %s · %s continues %s\n", target, c.ID, c.Thread)
			lines(r.Ref(i + 1))
			for _, m := range p.History(r.N, i+1) {
				fmt.Fprintf(&b, "%s · round %d\n", m.From, m.Round)
				quote(m.Text)
			}
			fmt.Fprintf(&b, "reader · round %d\n", r.N)
		} else {
			fmt.Fprintf(&b, "\n## %s · %s\n", target, c.ID)
			lines(r.Ref(i + 1))
		}
		quote(c.Text)
	}
	fmt.Fprint(ctx.Stdout, b.String())
}

// refLabel names a stored ref's lines the way the reader shows them:
// `<path>:<start>-<end>`, with the diff side when it has one.
func refLabel(nr protocol.NibbleRef) string {
	ref, err := protocol.ParseRef(nr.Ref)
	if err != nil {
		return nr.Ref
	}
	label := ref.Path + ":" + rangeLabel(ref.Start, ref.End)
	if ref.Diff != nil && !ref.Diff.Worktree && ref.Diff.Side == "base" {
		label += " (base side)"
	}
	return label
}

func rangeLabel(start, end int) string {
	if end > start {
		return fmt.Sprintf("%d-%d", start, end)
	}
	return fmt.Sprintf("%d", start)
}
