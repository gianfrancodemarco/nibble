package cmd

import (
	"bytes"
	"net/http"
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

// A reviewed plate stays viewable: the UI serves it read-only and serve
// exits with the review's code only on timeout (or interrupt), never 5.
func TestServeReviewedPlateStaysUp(t *testing.T) {
	repo := gitInit(t)
	ctx, plate := sealedPlate(t, repo)
	writeFile(t, plate, "review.json", reviewComments)

	url, stdout, codeCh := startServe(t, ctx, plate, "--timeout", "700ms")

	// Still up and serving after the review was found.
	time.Sleep(200 * time.Millisecond)
	select {
	case got := <-codeCh:
		t.Fatalf("serve exited early with %d; should stay up for reading", got)
	default:
	}
	resp, err := http.Get(url + "/api/plate")
	if err != nil || resp.StatusCode != 200 {
		t.Fatalf("GET /api/plate on reviewed plate: %v %v", err, resp)
	}
	resp.Body.Close()
	if !strings.Contains(stdout.String(), "n2:cache") {
		t.Fatalf("review should print up front; stdout = %q", stdout.String())
	}

	select {
	case got := <-codeCh:
		if got != 2 {
			t.Fatalf("exit = %d, want 2 (comments), not 5: the review exists", got)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("serve did not exit after --timeout")
	}
}
