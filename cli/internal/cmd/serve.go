package cmd

import (
	"encoding/json"
	"flag"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"slices"
	"strings"
	"syscall"
	"time"

	"github.com/gianfrancodemarco/nibble/cli/internal/protocol"
)

// pollInterval is how often serve checks for the review. The spec's budget is
// detection within 2 seconds; 250ms leaves margin without fsnotify.
const pollInterval = 250 * time.Millisecond

// Verdict exit codes: the stable contract agents script against.
// 1 stays reserved for errors.
var verdictExit = map[string]int{
	"approve":  0,
	"changes":  2,
	"question": 3,
	"closed":   4,
}

const exitTimeout = 5

// RunServe blocks until the plate's review.json exists and parses, prints the
// review, and exits with the verdict's code. The process ending is what wakes
// the agent that started it.
func RunServe(ctx Ctx, args []string) int {
	plateDir, args := popArg(args)
	fs := flag.NewFlagSet("serve", flag.ContinueOnError)
	fs.SetOutput(ctx.Stderr)
	timeout := fs.Duration("timeout", 0, "give up after this long (0 = wait forever)")
	jsonOut := fs.Bool("json", false, "machine output")
	addr := fs.String("addr", "127.0.0.1:0", "reader address (loopback only)")
	noUI := fs.Bool("no-ui", false, "wait headless, serve no reader")
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

	// Fail on an invalid plate before blocking.
	if _, err := protocol.ParsePlate(plateDir); err != nil {
		return fail(ctx, *jsonOut, err)
	}

	// The reader: served while we wait, loopback only. A review submitted
	// through it lands as review.json and ends the wait below — one code
	// path however the review arrives.
	if !*noUI {
		host, _, err := net.SplitHostPort(*addr)
		if err != nil || (host != "127.0.0.1" && host != "localhost") {
			fmt.Fprintf(ctx.Stderr, "nibble serve: --addr must stay on 127.0.0.1, got %q\n", *addr)
			return 2
		}
		api, err := newAPIServer(plateDir)
		if err != nil {
			return fail(ctx, *jsonOut, err)
		}
		ln, err := net.Listen("tcp", *addr)
		if err != nil {
			return fail(ctx, *jsonOut, err)
		}
		srv := &http.Server{Handler: api.handler()}
		go srv.Serve(ln)
		defer srv.Close()
		fmt.Fprintf(ctx.Stderr, "reader: http://%s\n", ln.Addr())
	}

	reviewPath := filepath.Join(plateDir, "review.json")

	// A plate that already has a review leaves nothing to wait for. Headless,
	// print and exit — the resume path scripts rely on. With the reader up,
	// keep serving the plate read-only so it stays viewable; interrupt or
	// --timeout ends it, and the verdict is still the exit code (never 5:
	// the review exists).
	if raw, err := os.ReadFile(reviewPath); err == nil {
		var r protocol.Review
		if json.Unmarshal(raw, &r) == nil && slices.Contains(protocol.Verdicts, r.Verdict) {
			printReview(ctx, *jsonOut, raw, r)
			if !*noUI {
				fmt.Fprintln(ctx.Stderr, "already reviewed — serving read-only; ctrl-c or --timeout ends it")
				sig := make(chan os.Signal, 1)
				signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
				defer signal.Stop(sig)
				if *timeout > 0 {
					select {
					case <-sig:
					case <-time.After(*timeout):
					}
				} else {
					<-sig
				}
			}
			return verdictExit[r.Verdict]
		}
	}

	deadline := time.Time{}
	if *timeout > 0 {
		deadline = time.Now().Add(*timeout)
	}

	for {
		if raw, err := os.ReadFile(reviewPath); err == nil {
			var r protocol.Review
			if json.Unmarshal(raw, &r) == nil && r.Verdict != "" {
				if !slices.Contains(protocol.Verdicts, r.Verdict) {
					return fail(ctx, *jsonOut, errf("review.verdict.unknown",
						"verdict %q; want one of %s", r.Verdict, strings.Join(protocol.Verdicts, ", ")))
				}
				printReview(ctx, *jsonOut, raw, r)
				return verdictExit[r.Verdict]
			}
			// Unparseable or incomplete: likely mid-write; keep waiting.
		}
		if !deadline.IsZero() && time.Now().After(deadline) {
			fmt.Fprintf(ctx.Stderr, "nibble serve: no review after %s\n", *timeout)
			return exitTimeout
		}
		time.Sleep(pollInterval)
	}
}

func printReview(ctx Ctx, jsonOut bool, raw []byte, r protocol.Review) {
	if jsonOut {
		fmt.Fprintln(ctx.Stdout, strings.TrimSpace(string(raw)))
		return
	}
	var b strings.Builder
	fmt.Fprintf(&b, "verdict: %s\n", r.Verdict)
	for _, c := range r.Comments {
		target := c.Target
		if target == "" {
			target = "plate"
		}
		fmt.Fprintf(&b, "\n## %s\n", target)
		for _, line := range strings.Split(strings.TrimSpace(c.Text), "\n") {
			fmt.Fprintf(&b, "> %s\n", line)
		}
	}
	fmt.Fprint(ctx.Stdout, b.String())
}
