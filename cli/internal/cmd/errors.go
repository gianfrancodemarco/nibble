package cmd

import (
	"encoding/json"
	"fmt"

	"github.com/gianfrancodemarco/nibble/cli/internal/protocol"
)

// CLI-owned error codes. Like the protocol's, they are the stable API and
// must be documented in protocol/PROTOCOL.md (enforced by TestErrorCodeIndex).
const (
	CodeRepoMissing = "cli.repo.missing"
	CodeBudget      = "cli.budget"
	CodePlateEmpty  = "cli.plate.empty"
	CodeLedger      = "cli.ledger"
)

func errf(code, format string, a ...any) *protocol.Error {
	return &protocol.Error{Code: code, Msg: fmt.Sprintf(format, a...)}
}

// fail reports err per the output conventions: a {"error": {...}} object on
// stdout with --json, a "code: message" line on stderr otherwise. Returns 1.
func fail(ctx Ctx, jsonOut bool, err error) int {
	code := protocol.ErrCode(err)
	msg := err.Error()
	if pe, ok := err.(*protocol.Error); ok {
		msg = pe.Msg
	}
	if jsonOut {
		out, _ := json.Marshal(map[string]any{"error": map[string]string{"code": code, "message": msg}})
		fmt.Fprintln(ctx.Stdout, string(out))
	} else {
		if code == "" {
			fmt.Fprintf(ctx.Stderr, "✗ %s\n", msg)
		} else {
			fmt.Fprintf(ctx.Stderr, "✗ %s: %s\n", code, msg)
		}
	}
	return 1
}

// emit prints a success object with --json, or nothing (stdout stays clean).
func emit(ctx Ctx, jsonOut bool, obj map[string]any, human string) {
	if jsonOut {
		out, _ := json.Marshal(obj)
		fmt.Fprintln(ctx.Stdout, string(out))
		return
	}
	if human != "" {
		fmt.Fprintln(ctx.Stderr, human)
	}
}
