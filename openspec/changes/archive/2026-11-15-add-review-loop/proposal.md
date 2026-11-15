# Proposal

## Why

Today a plate takes exactly one review: the human sends comments, `serve`
exits, and the thread is over — the agent's answer lands in the chat, cut
off from the picture the comment was pinned to, and the only way to follow
up on the plate is to build a new one. The v0.2 roadmap's first item is the
review loop: the agent reads the comments as a batch, replies on the same
plate, pinned where each comment was, and hands the plate back for the next
round until the human says done. In the reader that exchange has to feel
like a chat: threads pinned to things, messages going both ways, a place to
type the next one.

## What Changes

- **Protocol**: the review becomes a thread of **rounds**. Round 1 keeps
  the v1 files (`review.json`); the agent's answers to it live in
  `reply.json`, one reply per comment, each with markdown text and optional
  validated refs. Round `k ≥ 2` is `review.k.json` / `reply.k.json`. Every
  comment has a derived id `<round>.<index>`; a comment in a later round
  MAY **continue a thread** by naming the comment that opened it
  (`"thread": "1.2"`), inheriting its target — so a conversation on one
  element runs opener → reply → follow-up → reply for as long as it needs.
  A round is *answered* when every comment has a reply; a review with no
  comments is `done` — nothing to address now, never an end: the chat
  stays open. Whose turn it is derives from
  the files. Round ordering, thread references and reply shape are
  validated (`review.round`, `review.thread`, `reply.malformed`,
  `reply.target`, `reply.duplicate`, `reply.orphan`, `reply.anchor`);
  golden plates cover the valid conversation and each failure.
- **CLI**: a new `nibble reply <plate> --to <N> --text <md> [--ref …]`
  appends one reply to the latest round, validated like `add` (refs against
  the real repo, fingerprinted; prose anchor links resolve against the
  nibble the thread points at; a word budget with `--because`). Each reply
  streams into an open reader as it lands.
- **CLI**: `nibble serve` learns the loop. It waits for the *next* round and
  exits with that round's code, printing each comment with the history of
  the thread it continues, so the agent reads a conversation, not a
  fragment. A plate whose latest round is already answered waits again
  instead of printing and exiting; `done` stays terminal. Its exit code
  reports what the agent owes: 2 while a round has unanswered comments, 0
  after done, 5 when it stopped waiting with nothing owed. Headless
  `--no-ui` on an unanswered round still prints it and exits, the resume
  path scripts rely on.
- **Reader API**: `/api/plate` carries the whole conversation (rounds,
  comment ids, thread links, replies with trust-badged refs) and whose turn
  it is; `POST /api/review` opens the next round and accepts `thread` on a
  comment (409 while the agent still owes replies — `review.exists`); the event stream adds `reply`; reply refs
  open in the drawer through `/api/code`.
- **Reader**: a **chat panel** beside the canvas. It lists every thread on
  the plate, each headed by its target chip (which moves the camera and
  selects the element), with the human's and the agent's messages as
  bubbles carrying round markers, trust-badged code chips for reply refs
  and prose links that light the visual. A composer at the bottom replies
  in the focused thread or opens a new one on the current selection; what
  you type shows at once as a draft bubble you can remove; one send button
  posts the round and "ask now" sends at once. Elements and cards with a
  thread wear a message-count badge that opens the panel on that thread.
  The panel header says whose turn it is and counts replies as they land.
  After sending, the tab no longer tries to close itself: it waits for the
  agent to serve the plate again and picks the conversation up when it
  does, on the same address.
- **Skill**: the review section teaches the loop end to end — read the
  round as a batch with each thread's history, fix code where a comment
  asks for it, `reply` to each comment with the answer and the lines that
  prove it, re-serve on the same address, and stop when the next round is
  `done`. The reply transcript, including a round-2 follow-up, is executed
  as a test like the authoring one.

Out of scope: adding new nibbles or a deep-dial layer in reply to a comment
(the next roadmap item, *Ask for more*, builds that on this loop); comments
on specific code lines in the drawer (*Line-level comments*); editing or
deleting a sent message; the agent opening threads of its own (it only
answers); any protocol version bump — the new files and the `thread` field
are additive, and a v1 plate with one `review.json` still parses and reads
exactly as before.

## Capabilities

### New Capabilities

- `cli/review-reply`: the `nibble reply` command — how an agent answers one
  comment of the latest round, what is validated, what is written, and how
  the round becomes answered.

### Modified Capabilities

- `protocol/plate-format`: the folder layout and lifecycle gain review
  rounds, thread continuation and reply files, their shape, ordering and
  validation codes.
- `cli/review-wait`: `serve` waits for the next round, exits with what the
  agent owes, and prints the round that ended the wait with thread history.
- `reader/http-api`: the plate endpoint carries the conversation and turn;
  review submission opens the next round, takes `thread`, or refuses with
  `review.exists`; live events add `reply`; the code
  endpoint serves reply refs.
- `reader/ui-shell`: the chat panel replaces pinned-comment chips as the
  conversation surface; badges on cards and elements; the sent tab stays
  open and reconnects when the plate is served again.
- `skill/claude-code`: teaches answering the review through the loop, with
  an executed transcript including a follow-up round.

## Impact

- `cli/internal/protocol`: `plate.go` (rounds, thread links, replies,
  turn), `errors.go` (new codes), tests, `protocol/golden/plates/*`
  fixtures (valid conversation, `cli-authored` grows a thread, bad-reply,
  bad-round and bad-thread fixtures).
- `cli/internal/cmd`: new `reply.go`, `serve.go` (wait condition, exit
  codes, printing with history), `http.go` (conversation in `/api/plate`,
  next-round POST with `thread`, reply refs in `/api/code`, `reply` SSE
  event), tests and the skill transcript test.
- `protocol/PROTOCOL.md`, `cli/README.md`.
- `reader/src/app.ts`, `live.ts` (thread-only reloads), new `chat.ts`
  (pure conversation logic), `index.html` (the panel), `style.css`; node
  tests.
- `cli/skill/claude-code/SKILL.md` (review section and a second executed
  transcript).
- `docs/guide/answering.html`, `docs/guide/agents.html`,
  `docs/guide/reading.html`, the live demo (`docs/demo/make.sh` snapshot
  gains a conversation so the panel renders on the site),
  `docs/roadmap.html`.
