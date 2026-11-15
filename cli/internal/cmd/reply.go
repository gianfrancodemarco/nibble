package cmd

import (
	"encoding/json"
	"flag"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/gianfrancodemarco/nibble/cli/internal/protocol"
)

// replyWordBudget: an answer, not an essay — between the overview and the
// standard description. A long answer belongs in a new nibble.
const replyWordBudget = 150

// RunReply answers one comment of the latest review round on the same plate:
// validated like add (refs against the real repo, prose links against the
// thread's nibble, a budget), written under the plate lock, streaming into an
// open reader as it lands.
func RunReply(ctx Ctx, args []string) int {
	plateDir, args := popArg(args)
	fs := flag.NewFlagSet("reply", flag.ContinueOnError)
	fs.SetOutput(ctx.Stderr)
	to := fs.Int("to", 0, "the comment to answer: its 1-based index in the latest round")
	text := fs.String("text", "", "the answer (markdown, ≤150 words)")
	because := fs.String("because", "", "reason for exceeding the budget")
	jsonOut := fs.Bool("json", false, "machine output")
	var refs stringSlice
	fs.Var(&refs, "ref", "code reference (repeatable, no @anchor)")
	if err := fs.Parse(args); err != nil {
		return 2
	}
	if plateDir == "" {
		plateDir = fs.Arg(0)
	}
	if plateDir == "" || *to == 0 || strings.TrimSpace(*text) == "" {
		fmt.Fprintln(ctx.Stderr, "nibble reply: <plate>, --to and --text are required")
		return 2
	}

	plate, err := protocol.ParsePlate(plateDir)
	if err != nil {
		return fail(ctx, *jsonOut, err)
	}
	round := plate.Latest()
	if round == nil {
		return fail(ctx, *jsonOut, errf(protocol.CodeReplyTarget, "%s has no review yet: nothing to answer", plateDir))
	}
	if round.Done() {
		return fail(ctx, *jsonOut, errf(protocol.CodeReplyTarget, "round %d is done — the reader had nothing to address", round.N))
	}
	if *to < 1 || *to > len(round.Review.Comments) {
		return fail(ctx, *jsonOut, errf(protocol.CodeReplyTarget, "no comment %d in round %d; it has:\n%s", *to, round.N, listComments(round)))
	}
	if round.ReplyTo(*to) != nil {
		return fail(ctx, *jsonOut, errf(protocol.CodeReplyDuplicate, "comment %d of round %d already has a reply", *to, round.N))
	}

	// The root resolves like the server resolves it: relative to the plate
	// directory (a portable plate bundles a snapshot). Git is needed only to
	// read diff sides; plain and worktree refs verify against the files.
	root := plate.Header.Repo
	if !filepath.IsAbs(root) {
		root = filepath.Join(plateDir, root)
	}
	g, gerr := openGit(root)
	var stored []protocol.NibbleRef
	for _, raw := range refs {
		ref, err := protocol.ParseRef(raw)
		if err != nil {
			return fail(ctx, *jsonOut, err)
		}
		if ref.Anchor != "" {
			return fail(ctx, *jsonOut, errf(protocol.CodeReplyAnchor, "ref %q carries @%s, but reply refs take no anchor — the element already has its own refs", raw, ref.Anchor))
		}
		if ref.Diff != nil && !ref.Diff.Worktree && gerr != nil {
			return fail(ctx, *jsonOut, gerr)
		}
		content, err := loadRefContent(root, g, ref)
		if err != nil {
			return fail(ctx, *jsonOut, err)
		}
		if err := protocol.CheckRef(ref, content); err != nil {
			return fail(ctx, *jsonOut, err)
		}
		fp, err := protocol.NewFingerprint(content, ref.Start, ref.End)
		if err != nil {
			return fail(ctx, *jsonOut, err)
		}
		stored = append(stored, protocol.NibbleRef{
			Ref: raw, FP: fp.Sum, Lines: fp.Lines,
			CtxBefore: fp.CtxBefore, CtxAfter: fp.CtxAfter,
		})
	}

	if *because == "" {
		if n := wordCount(*text); n > replyWordBudget {
			return fail(ctx, *jsonOut, errf(CodeBudget,
				"reply is %d words (budget %d): answer the question, point at the lines, or state a reason with --because", n, replyWordBudget))
		}
	}

	reply := protocol.Reply{To: *to, Text: *text, Refs: stored, Because: *because}

	// Validate the would-be file exactly as the loader will, so nothing is
	// written that the next ParsePlate would refuse (prose links, shape).
	candidate := append(append([]protocol.Reply{}, round.Replies...), reply)
	if err := protocol.CheckReplies(round, candidate, plate.Nibbles); err != nil {
		return fail(ctx, *jsonOut, err)
	}

	unlock, err := lockDir(plateDir)
	if err != nil {
		return fail(ctx, *jsonOut, err)
	}
	defer unlock()

	// Re-read under the lock: another reply may have landed meanwhile.
	fresh, err := protocol.ParsePlate(plateDir)
	if err != nil {
		return fail(ctx, *jsonOut, err)
	}
	round = fresh.Latest()
	if round == nil || round.N != plate.Latest().N {
		return fail(ctx, *jsonOut, errf(protocol.CodeReplyTarget, "the plate's thread changed underneath; re-run reply"))
	}
	if round.ReplyTo(*to) != nil {
		return fail(ctx, *jsonOut, errf(protocol.CodeReplyDuplicate, "comment %d of round %d already has a reply", *to, round.N))
	}
	replies := append(append([]protocol.Reply{}, round.Replies...), reply)
	out, err := json.MarshalIndent(protocol.Replies{Replies: replies}, "", "  ")
	if err != nil {
		return fail(ctx, *jsonOut, err)
	}
	path := filepath.Join(plateDir, protocol.ReplyFile(round.N))
	if err := writeAtomic(path, append(out, '\n')); err != nil {
		return fail(ctx, *jsonOut, err)
	}

	answered := len(replies)
	of := len(round.Review.Comments)
	human := fmt.Sprintf("✓ reply %d of %d", answered, of)
	if answered == of {
		human += fmt.Sprintf(" — round %d answered; the reader can send the next round", round.N)
	}
	emit(ctx, *jsonOut, map[string]any{"round": round.N, "to": *to, "answered": answered, "of": of}, human)
	return 0
}

// listComments renders a round's comments for a reply.target message.
func listComments(r *protocol.Round) string {
	var b strings.Builder
	for i, c := range r.Review.Comments {
		target := r.Target(i + 1)
		if target == "" {
			target = "plate"
		}
		if nr := r.Ref(i + 1); nr != nil {
			target += " · " + refLabel(*nr)
		}
		fmt.Fprintf(&b, "  %d. %s — %s\n", i+1, target, c.Text)
	}
	return strings.TrimRight(b.String(), "\n")
}
