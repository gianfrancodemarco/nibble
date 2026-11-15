package cmd

import (
	"bytes"
	"net/http"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"
)

// syncBuf is a bytes.Buffer safe to write from the serve goroutine while the
// test reads it.
type syncBuf struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (s *syncBuf) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.Write(p)
}

func (s *syncBuf) String() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.String()
}

var readerURLRe = regexp.MustCompile(`reader: (http://127\.0\.0\.1:\d+)`)

// startServe runs RunServe in a goroutine and waits for the reader URL line.
func startServe(t *testing.T, ctx Ctx, args ...string) (url string, stdout *syncBuf, code <-chan int) {
	t.Helper()
	var out, errb syncBuf
	c := ctx
	c.Stdout, c.Stderr = &out, &errb
	if c.Keep == nil {
		c.Keep = inProcessKeep
	}
	ch := make(chan int, 1)
	go func() { ch <- RunServe(c, args) }()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if m := readerURLRe.FindStringSubmatch(errb.String()); m != nil {
			return m[1], &out, ch
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("no reader URL on stderr; stderr = %q", errb.String())
	return "", nil, nil
}

func TestServeHTTPSide(t *testing.T) {
	repo := gitInit(t)

	t.Run("review through the reader ends serve with the review's code", func(t *testing.T) {
		ctx, plate := sealedPlate(t, repo)
		url, stdout, code := startServe(t, ctx, plate)

		// stdout stays silent while waiting.
		if stdout.String() != "" {
			t.Fatalf("stdout before review: %q", stdout.String())
		}
		// The API is live on the announced URL.
		resp, err := http.Get(url + "/api/plate")
		if err != nil || resp.StatusCode != 200 {
			t.Fatalf("GET /api/plate: %v %v", err, resp)
		}
		resp.Body.Close()

		resp, err = http.Post(url+"/api/review", "application/json",
			strings.NewReader(reviewComments))
		if err != nil || resp.StatusCode != 200 {
			t.Fatalf("POST /api/review: %v %v", err, resp)
		}
		resp.Body.Close()

		select {
		case got := <-code:
			if got != 2 {
				t.Fatalf("serve exit = %d, want 2 (comments)", got)
			}
		case <-time.After(2 * time.Second):
			t.Fatal("serve did not exit within 2s of the posted review")
		}
		if !strings.Contains(stdout.String(), "n2:cache") {
			t.Fatalf("stdout = %q", stdout.String())
		}
	})

	t.Run("no-ui stays headless", func(t *testing.T) {
		ctx, plate := sealedPlate(t, repo)
		var out, errb bytes.Buffer
		c := ctx
		c.Stdout, c.Stderr = &out, &errb
		code := RunServe(c, []string{plate, "--no-ui", "--timeout", "150ms"})
		if code != 5 {
			t.Fatalf("exit = %d, want 5 (timeout)", code)
		}
		if strings.Contains(errb.String(), "reader:") {
			t.Fatalf("headless serve announced a URL: %q", errb.String())
		}
	})

	t.Run("addr must stay on loopback", func(t *testing.T) {
		ctx, plate := sealedPlate(t, repo)
		var out, errb bytes.Buffer
		c := ctx
		c.Stdout, c.Stderr = &out, &errb
		if code := RunServe(c, []string{plate, "--addr", "0.0.0.0:0"}); code != 2 {
			t.Fatalf("exit = %d, want 2 (usage)", code)
		}
	})
}

// With the reader up, the round the previous serve ended with is served and
// waited on — the agent is about to stream replies into this very server —
// and a timeout exits with the owed round's code, never 5.
func TestServeUnansweredRoundStaysUp(t *testing.T) {
	repo := gitInit(t)
	ctx, plate := sealedPlate(t, repo)
	// the round is delivered by a serve, as in real life
	url0, _, codeCh0 := startServe(t, ctx, plate)
	http.Post(url0+"/api/review", "application/json", strings.NewReader(reviewComments))
	<-codeCh0

	url, stdout, codeCh := startServe(t, ctx, plate, "--timeout", "900ms")

	// Still up and serving while the round is owed.
	time.Sleep(200 * time.Millisecond)
	select {
	case got := <-codeCh:
		t.Fatalf("serve exited early with %d; should stay up for replies", got)
	default:
	}
	resp, err := http.Get(url + "/api/plate")
	if err != nil || resp.StatusCode != 200 {
		t.Fatalf("GET /api/plate on an unanswered plate: %v %v", err, resp)
	}
	resp.Body.Close()
	// A reply landing does not end the wait: the round is now answered and
	// the next one is what serve waits for.
	writeFile(t, plate, "reply.json", `{"replies":[{"to":1,"text":"on it"}]}`)
	time.Sleep(300 * time.Millisecond)
	select {
	case got := <-codeCh:
		t.Fatalf("serve exited on a reply with %d; should wait for the next round", got)
	default:
	}
	// the round was answered during the wait → nothing owed at timeout
	select {
	case got := <-codeCh:
		if got != 5 {
			t.Fatalf("exit = %d, want 5 (round answered, nothing owed)", got)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("serve did not exit after --timeout")
	}
	if stdout.String() != "" {
		t.Fatalf("nothing owed: stdout should be empty, got %q", stdout.String())
	}
}

// A round still owed at the timeout is printed and exits 2.
func TestServeTimeoutWhileOwed(t *testing.T) {
	repo := gitInit(t)
	ctx, plate := sealedPlate(t, repo)
	url0, _, codeCh0 := startServe(t, ctx, plate)
	http.Post(url0+"/api/review", "application/json", strings.NewReader(reviewComments))
	<-codeCh0
	_, stdout, codeCh := startServe(t, ctx, plate, "--timeout", "400ms")
	select {
	case got := <-codeCh:
		if got != 2 {
			t.Fatalf("exit = %d, want 2 (round owed)", got)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("serve did not exit after --timeout")
	}
	if !strings.Contains(stdout.String(), "n2:cache") {
		t.Fatalf("the owed round should print; stdout = %q", stdout.String())
	}
}

// After done the chat stays open: serve waits for the next round, and the
// keeper keeps the page up when a done round lands.
func TestServeAfterDoneKeepsWaiting(t *testing.T) {
	repo := gitInit(t)
	ctx, plate := sealedPlate(t, repo)
	writeFile(t, plate, "review.json", reviewDone)
	url, stdout, codeCh := startServe(t, ctx, plate, "--timeout", "500ms")
	resp, err := http.Get(url + "/api/plate")
	if err != nil || resp.StatusCode != 200 {
		t.Fatalf("GET /api/plate after done: %v %v", err, resp)
	}
	resp.Body.Close()
	select {
	case got := <-codeCh:
		if got != 5 {
			t.Fatalf("exit = %d, want 5 (nothing owed, nothing new)", got)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("serve did not exit after --timeout")
	}
	if stdout.String() != "" {
		t.Fatalf("stdout = %q, want nothing", stdout.String())
	}
}

// inProcessKeep stands in for the detached keeper process: the same loop,
// in a goroutine, holding the listener serve handed over.
func inProcessKeep(k Keeper) {
	go runKeeper(k)
}

// After serve exits on a round, the page outlives it: the keeper serves the
// same address, a reply written afterwards shows there, and the next serve
// takes the address back without being told which it was.
func TestServeKeeperOutlivesTheWakeUp(t *testing.T) {
	repo := gitInit(t)
	ctx, plate := sealedPlate(t, repo)
	url, _, codeCh := startServe(t, ctx, plate)
	if resp, err := http.Post(url+"/api/review", "application/json", strings.NewReader(reviewComments)); err != nil || resp.StatusCode != 200 {
		t.Fatalf("POST review: %v %v", err, resp)
	}
	select {
	case got := <-codeCh:
		if got != 2 {
			t.Fatalf("serve exit = %d, want 2", got)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("serve did not exit on the round")
	}

	// Still served, by the keeper.
	var p apiPlate
	if code := getJSON(t, url+"/api/plate", &p); code != 200 || p.Thread.Turn != "agent" {
		t.Fatalf("keeper before the reply: %d %+v", code, p.Thread)
	}
	ch := sseEvents(t, url)
	writeFile(t, plate, "reply.json", `{"replies":[{"to":1,"text":"on it"}]}`)
	if code := getJSON(t, url+"/api/plate", &p); code != 200 || p.Thread.Turn != "reader" {
		t.Fatalf("keeper after the reply: %d %+v", code, p.Thread)
	}
	waitEvent(t, ch, `reply {"round":1,"answered":1,"of":1}`)

	// The next serve, with no --addr, lands on the same URL and blocks.
	url2, _, codeCh2 := startServe(t, ctx, plate)
	if url2 != url {
		t.Fatalf("second serve on %s, want the recorded %s", url2, url)
	}
	time.Sleep(200 * time.Millisecond)
	select {
	case got := <-codeCh2:
		t.Fatalf("second serve exited early with %d", got)
	default:
	}
	if code := getJSON(t, url+"/api/plate", &p); code != 200 {
		t.Fatalf("after hand-over: %d", code)
	}
	if resp, err := http.Post(url+"/api/review", "application/json", strings.NewReader(`{"comments":[]}`)); err != nil || resp.StatusCode != 200 {
		t.Fatalf("POST done: %v %v", err, resp)
	}
	select {
	case got := <-codeCh2:
		if got != 0 {
			t.Fatalf("exit = %d, want 0", got)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("second serve did not exit on done")
	}
	// done is no end: the keeper still serves the page for the next word
	if code := getJSON(t, url+"/api/plate", &p); code != 200 || p.Thread.Turn != "reader" {
		t.Fatalf("after done: %d %+v", code, p.Thread)
	}
}

// Headless serve leaves nothing behind.
func TestServeHeadlessLeavesNoKeeper(t *testing.T) {
	repo := gitInit(t)
	ctx, plate := sealedPlate(t, repo)
	writeFile(t, plate, "review.json", reviewComments)
	kept := false
	ctx.Keep = func(Keeper) { kept = true }
	if code, _, _ := run(t, ctx, "serve", plate, "--no-ui"); code != 2 {
		t.Fatalf("exit = %d", code)
	}
	if kept {
		t.Fatal("headless serve handed a listener to a keeper")
	}
	if rec := readServeRecord(plate); rec == nil || rec.Addr != "" || rec.Printed != 1 {
		t.Fatalf("record = %+v, want printed 1 and no address", rec)
	}
}

// A stale record (keeper gone) is ignored; serve still starts.
func TestServeStaleRecord(t *testing.T) {
	repo := gitInit(t)
	ctx, plate := sealedPlate(t, repo)
	writeFile(t, plate, ".serve.json", `{"addr":"127.0.0.1:1","token":"x","printed":0}`)
	url, _, codeCh := startServe(t, ctx, plate, "--timeout", "300ms")
	if url == "http://127.0.0.1:1" {
		t.Fatal("serve should not insist on a dead recorded address")
	}
	select {
	case got := <-codeCh:
		if got != 5 {
			t.Fatalf("exit = %d, want 5", got)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("serve did not time out")
	}
}

// Seen rounds: a round this agent was never handed is printed at once even
// with the UI on; the round the previous serve ended with is waited on.
func TestServeSeenRounds(t *testing.T) {
	repo := gitInit(t)
	t.Run("unwatched round prints at once", func(t *testing.T) {
		ctx, plate := sealedPlate(t, repo)
		writeFile(t, plate, "review.json", reviewComments)
		start := time.Now()
		_, stdout, codeCh := startServe(t, ctx, plate, "--timeout", "5s")
		select {
		case got := <-codeCh:
			if got != 2 || time.Since(start) > time.Second || !strings.Contains(stdout.String(), "n2:cache") {
				t.Fatalf("exit = %d after %v, stdout %q", got, time.Since(start), stdout.String())
			}
		case <-time.After(2 * time.Second):
			t.Fatal("an unwatched round should print and exit at once")
		}
	})
	t.Run("the delivered round is waited on", func(t *testing.T) {
		ctx, plate := sealedPlate(t, repo)
		url, _, codeCh := startServe(t, ctx, plate)
		http.Post(url+"/api/review", "application/json", strings.NewReader(reviewComments))
		<-codeCh
		_, _, codeCh2 := startServe(t, ctx, plate, "--timeout", "600ms")
		time.Sleep(200 * time.Millisecond)
		select {
		case got := <-codeCh2:
			t.Fatalf("exited early with %d; the delivered round should be waited on", got)
		default:
		}
		select {
		case got := <-codeCh2:
			if got != 2 {
				t.Fatalf("exit = %d, want 2 (still owed)", got)
			}
		case <-time.After(2 * time.Second):
			t.Fatal("no exit on timeout")
		}
	})
}

// The real thing: a built nibble binary serves, exits on a round, and the
// address is still answering afterwards — the detached keeper child holds
// the inherited socket. Skipped where go is not on the PATH.
func TestKeeperProcess(t *testing.T) {
	if _, err := exec.LookPath("go"); err != nil {
		t.Skip("no go toolchain to build the binary")
	}
	bin := filepath.Join(t.TempDir(), "nibble")
	build := exec.Command("go", "build", "-o", bin, "./cmd/nibble")
	build.Dir = filepath.Join("..", "..")
	if out, err := build.CombinedOutput(); err != nil {
		t.Fatalf("go build: %v\n%s", err, out)
	}
	repo := gitInit(t)
	ctx, plate := sealedPlate(t, repo)
	_ = ctx

	cmd := exec.Command(bin, "serve", plate, "--timeout", "30s")
	var errb syncBuf
	cmd.Stderr = &errb
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	var url string
	for deadline := time.Now().Add(5 * time.Second); time.Now().Before(deadline); {
		if m := readerURLRe.FindStringSubmatch(errb.String()); m != nil {
			url = m[1]
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if url == "" {
		t.Fatalf("no reader URL; stderr = %q", errb.String())
	}
	if resp, err := http.Post(url+"/api/review", "application/json", strings.NewReader(reviewComments)); err != nil || resp.StatusCode != 200 {
		t.Fatalf("POST review: %v %v", err, resp)
	}
	if err := cmd.Wait(); err == nil || cmd.ProcessState.ExitCode() != 2 {
		t.Fatalf("serve exit = %v, want 2", err)
	}

	// The process is gone; the page is not.
	writeFile(t, plate, "reply.json", `{"replies":[{"to":1,"text":"on it"}]}`)
	var p apiPlate
	if code := getJSON(t, url+"/api/plate", &p); code != 200 || p.Thread.Turn != "reader" {
		t.Fatalf("after exit: %d %+v", code, p.Thread)
	}
	rec := readServeRecord(plate)
	if rec == nil || "http://"+rec.Addr != url || rec.Token == "" || rec.Printed != 1 {
		t.Fatalf("record = %+v", rec)
	}
	// Stand the keeper down the way the next serve would.
	if !postHandoff(rec.Addr, rec.Token) {
		t.Fatal("keeper did not accept the hand-off")
	}
	if ln, err := listenRetry(rec.Addr, 3*time.Second); err != nil {
		t.Fatalf("address not released: %v", err)
	} else {
		ln.Close()
	}
}
