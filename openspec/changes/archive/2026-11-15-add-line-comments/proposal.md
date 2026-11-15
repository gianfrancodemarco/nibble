# Proposal

## Why

A comment today pins to a nibble, an element or a ledger file — never to
the lines the reader is actually looking at in the drawer. "This branch is
wrong" on `n2:s4` makes the agent guess which of the ref's twenty lines was
meant, and the reader has no way to say "these three" except typing the
numbers. The v0.2 roadmap's next item is **line-level comments**: comment on
specific code lines in the drawer, not just on a nibble, like a PR review,
and have that pointer ride the review loop that already exists.

## What Changes

- **Protocol**: a review comment MAY carry a `ref` — one stored ref in the
  nibble form (`{"ref": "src/x.ts:15-19", "fp": …, "lines": […]}`), naming
  the lines the comment is about, next to its `target` (the nibble, element
  or ledger file whose drawer showed them). A comment ref takes no
  `@anchor` (the target already says which element); `fp` and the line
  hashes are optional — the reader's send stores them, a hand-written
  review may leave them out, in which case the ref's trust is
  `unverified` rather than computed. A continuation inherits its opener's
  ref and SHALL NOT carry one. One new code, `review.ref` (an anchor on a
  comment ref); the ref grammar and fingerprint codes apply as they do to
  reply refs. Golden plates cover a valid line thread and each refusal.
- **Reader API**: `/api/plate` serves each comment's ref with trust computed
  like a reply ref's; `/api/code?comment=<id>` opens a comment's lines in
  the drawer; `/api/code` and `/api/ledger` responses say the **address**
  the shown lines have in the ref grammar (`at`: `src/x.ts`,
  `diff:src/x.ts@worktree`, `diff:src/x.ts@a..b#base`) so the reader can
  name a line range without parsing refs; `POST /api/review` accepts a
  comment `ref` given as `{"ref": "<v1 ref string>"}`, verifies it against
  the code (grammar, range) and fingerprints it when the code is
  available, refusing a bad one before anything is written.
- **CLI**: `serve` prints a line comment with its location on the heading
  (`## n2:s4 · src/upload/handler.ts:15-19 · 1.1`) and quotes the lines it
  names, at the trust-resolved position, so the agent reads what the human
  pointed at without opening the file; `--json` carries the ref with its
  trust and the lines. `reply` is unchanged: a reply to a line comment is a
  reply to its comment, and its prose links resolve against the thread's
  nibble as before.
- **Reader**: the drawer's gutter becomes a review gutter. Clicking a line
  number selects it, shift-click extends the range, and the selected lines
  are marked; the composer then says it will open a thread on
  `src/x.ts:15-19` in the current target, and the sent comment carries the
  ref. A line thread shows a code chip (path, range, trust badge) under its
  target chip; activating the chip moves the camera to the card, selects
  the element and opens the drawer on the comment's lines. Lines a thread
  covers wear a message-count badge in the gutter that opens the panel on
  that thread, so a drawer reads like a PR diff with its conversations.
  Two threads on the same target but different lines are different threads.
- **Skill**: the review section teaches the line form — a comment that
  names lines is about those lines; read them, change them if asked, and
  reply with a `--ref` on the result — and the executed worked conversation
  gains a line comment in its second round.

Out of scope: comments on lines of the compare visual's panes (they are
drawn by the visual, not the drawer; a later change can route them through
the same ref form); multi-file or multi-range comments (one ref per
comment); suggested edits (a diff the reader proposes); the agent commenting
on lines (it only replies); editing a comment's lines after it is sent; any
protocol version bump — the `ref` field is additive, and every existing
plate, fixture and script parses and reads exactly as before.

## Capabilities

### New Capabilities

None — line comments are a form of the existing review comment, served
through the existing endpoints and surfaces.

### Modified Capabilities

- `protocol/plate-format`: a review comment may carry a `ref`; its shape,
  the optional fingerprint, the no-anchor rule, continuation inheritance
  and the `review.ref` code.
- `reader/http-api`: the plate endpoint serves comment refs with trust;
  the code endpoint serves a comment's lines by id; code and ledger
  responses carry the lines' address; review submission accepts, verifies
  and fingerprints a comment ref.
- `reader/ui-shell`: line selection in the drawer's gutter; the composer
  targets the selected lines; line threads with a code chip; gutter
  badges in the drawer; same-target threads told apart by lines.
- `cli/review-wait`: the printed round carries each line comment's
  location and quotes its lines; the JSON output carries the ref with
  trust and lines.
- `skill/claude-code`: the review section teaches line comments and the
  executed conversation transcript includes one.

## Impact

- `cli/internal/protocol`: `plate.go` (`ReviewComment.Ref`), `thread.go`
  (ref checks in `NextRound`, continuation rule), `errors.go`
  (`review.ref`), tests; `protocol/golden/plates/*` (new `line-comments`,
  `review-ref-anchor`, `review-ref-on-followup`; `cli-authored` grows a
  line comment and its reply).
- `cli/internal/cmd`: `http.go` (comment refs in `/api/plate`, `at` on
  code/ledger responses, `?comment=` on `/api/code`, ref verification on
  POST), `serve.go` (heading, quoted lines, JSON), `reply.go` (comment
  listing names the lines), tests and the skill transcript test.
- `protocol/PROTOCOL.md`, `cli/README.md`.
- `reader/src/app.ts` (gutter selection, line threads, drawer badges),
  `chat.ts` (thread identity with refs, composer destination, drawer
  badge lookup), `index.html`, `style.css`; node tests; rebuilt `app.js`
  and the `docs/visuals` copies.
- `cli/skill/claude-code/SKILL.md` (review section, worked conversation).
- `docs/guide/answering.html`, `docs/guide/reading.html`,
  `docs/guide/agents.html`, `docs/demo/make.sh` (the live demo gains a
  line thread), `docs/roadmap.html` at ship time.
