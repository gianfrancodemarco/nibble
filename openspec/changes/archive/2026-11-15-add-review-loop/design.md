# Design

## Context

See proposal.md — Why. What exists today, and shapes the approach:

- `review.json` is the only answer file; `protocol.ParseReview` validates
  it, `ParsePlate` hangs it on `Plate.Review`, and `serve` polls for it,
  prints it and exits with `reviewExit` (0 / 2). `POST /api/review` refuses
  a second review with `review.exists`. The SSE poller diffs a
  `plateSnapshot` of counts.
- `nibble add` is the model for validated writes: parse the plate, verify
  and fingerprint each ref with `loadRefContent` + `CheckRef` +
  `NewFingerprint`, validate prose anchors with `ValidateNibbleProse`,
  check budgets, then write atomically under `lockDir`.
- The reader keeps `pending` comments client-side as chips in a footer
  bar, posts them on send, then calls `window.close()`; the comment
  popover (`c`) offers hold / ask now. `live.ts` decides append-vs-rebuild
  from a `PlateShape` whose `reviewed` flag forces a rebuild when the
  review lands. The code drawer is one element re-homed into the active
  card; the strip is the only other surface.
- The reader's EventSource retries forever; on error it probes
  `/api/plate` once and, if dead, flashes a permanent "serve has exited"
  notice.
- `serve` is launched by the agent in the background; the process ending is
  what wakes the agent (C3 in the PRD). That mechanic stays: the loop is
  serve → exit → reply → serve again.

## Goals / Non-Goals

**Goals:**

- One conversation per plate, in files, readable without nibble: rounds,
  thread links and replies as plain JSON beside the nibbles, immutable once
  written except the reply file of the current round, which grows one
  reply at a time.
- The turn is derived, never stored: nothing to desync.
- The reader's conversation surface is a chat: threads, bubbles, a
  composer, badges on the things being talked about.
- The human keeps one tab through the whole loop when the agent re-serves
  on the same address; a new address still works through the relayed link.
- No protocol version bump; every v1 plate and fixture parses unchanged.

**Non-Goals:**

- Keeping `serve` alive across the review (the exit is the wake-up).
- Replies that add nibbles or visuals (next item, *Ask for more*).
- The agent opening threads; it only answers.
- Sending one message at a time as its own round: the round is the batch,
  "ask now" is the one-message round.

## Decisions

### D1. Rounds as numbered file pairs; round 1 keeps the v1 names

`review.json` + `reply.json`, then `review.2.json` + `reply.2.json`. The
asymmetry (no `review.1.json`) is the price of leaving every existing plate,
fixture, script and doc valid. Alternatives: a single growing `thread.json`
(rewrites the one file the human's send and the agent's replies both touch,
and breaks the "review.json appears → serve wakes" contract tools already
script against); a `rounds/` directory (a new nesting level in a flat
layout, for no gain). Numbered siblings keep `ls` legible: the plate reads
as a transcript.

### D2. Threads are an optional link on a comment; ids are derived

A comment's id is `<round>.<index>`, never stored — a round is immutable
once written, so the position is the identity. A follow-up carries
`"thread": "<opener id>"` and inherits the opener's target; it may only
name an opener (no chains of links), of an earlier round, so a thread is
flat: opener, then alternating replies and follow-ups in round order.
Alternative considered: stored uuids on comments (a hand-written review
would have to mint them; the reader would have to keep them across
reloads); per-thread files (`t1.json`…) — a second numbering scheme beside
rounds, and the send would write several files instead of one.

### D3. One reply per comment, by index, replies streamed one at a time

A reply is `{"to": N, "text", "refs", "because"}`; `to` is the comment's
index in its round (the round's own reply file, so no round in `to`). The
reply file is rewritten under the plate lock on each `nibble reply`, so
replies stream into the open reader exactly as nibbles do with `add`. A
round is answered when every comment has a reply — the natural, explicit
hand-back without a separate "round done" marker. A reply to a follow-up is
a reply to that follow-up's comment; the conversation is reassembled from
the thread links, so the agent answers "the message" and the reader shows
"the thread". Alternative considered: a batch `--from replies.json`; it
would be atomic but the reader would see nothing until the agent finished.

### D4. Turn derived from the files

`reader` (no review, or latest round fully replied), `agent` (latest round
has an unreplied comment), `done` (latest review has no comments). Computed
in `protocol` (`Plate.Turn()`), served by the API, consumed by `serve`'s
wait and the reader's composer lock. Ordering rules make an inconsistent
thread a protocol error (`review.round`, `review.thread`), so a tool never
has to guess which round is live.

### D5. `serve` waits for the next unanswered round; exits with what is owed

The wait predicate is "a round the agent has not answered exists that did
not exist when the wait began" — concretely, `serve` records the round count
at start and ends when a later round lands, or immediately on a pre-existing
unanswered round in `--no-ui` mode (resume for scripts). A done round is
nothing to address, never an end: it is waited past like any answered
round, so the chat stays open for a later word. With the reader up, a pre-existing unanswered round
is served and waited on: the agent has just been woken by it and is about to
stream replies into this very server. Exit codes follow the owed round: 2
while a round has unreplied comments, 0 when the round was done, 5 when
`serve` stops with nothing owed. The agent's script reads the same codes it
reads today. The printed round carries each follow-up's history so the
agent never has to reassemble a conversation from files.

Alternative considered: a `--reply` flag to tell serve the agent is
answering. Rejected — the file state already says so, and a flag the agent
forgets would make serve exit on the round it was about to answer.

### D6. Same address, same tab — the keeper

The exit is the wake-up, but the page must not die with it. When a `serve`
with the reader up ends on a round, it spawns a detached child (`nibble
serve <plate> --keeper`, its own session, no stdio) and passes it the
listening socket as an inherited file descriptor, so the address never
closes: the API, the event stream and the page keep answering while the
agent writes replies, and each reply lands in the open tab through the
`reply` event. The keeper only serves files; it never waits for a round,
never prints, never wakes anyone. `serve` records `{addr, token, printed}`
in `.serve.json` (a dotfile the protocol ignores): the next `serve` reuses
the address when none is given, posts the token to `/api/handoff` so the
keeper closes its listener, then binds. The reader keeps the EventSource
(which retries on its own) and probes `/api/plate` every 2 s if it ever
fails, so the hand-overs are invisible and a dead server is still noticed.
`printed` is the round the last `serve` exited with: a later `serve` finding
an unanswered round it did not deliver prints it and exits at once — a
round that landed while only the keeper was up is still owed — while the
round it did deliver is served and waited on. Alternatives considered: not
exiting on a round (nothing wakes the agent); the skill's "re-serve before
you reply" discipline alone (a few seconds of dead page on every round, and
nothing if the agent forgets); pid files and signals for the hand-over (an
in-process keeper in tests has no pid of its own; a token over loopback
works in both).

### D7. The chat panel is a third surface, fixed on the right

A column fixed on the right of the canvas, always in view (the user chose
"one nibble per page, the chat fixed on the right" over a collapsible dock:
the conversation is half the point of the page, and the single card has the
width to spare), holding: a header with the turn
state and the send button, the thread list, and the composer. It replaces
the comment popover and the footer review bar — one place to read and
write. Threads are built client-side from the API's rounds (`chat.ts`,
pure: group by opener, order by round, append drafts), so the server stays
a file view. Draft messages live in the panel's own state as bubbles in
their thread (a new thread for a fresh target), posted as `{target}` or
`{thread}` comments on send. The panel never moves the camera on its own:
only a target chip does, through the same `setActive` + `selectId` path a
click uses, so the drawer and comment target follow. Alternatives
considered: threads inline under each card's text (the user chose the
panel: a chat reads as one conversation, and a card's side bar is too
narrow for a multi-round exchange); a modal (hides the picture the thread
is about).

### D8. Badges, not inline threads, on the plate

An element with a thread wears a small count pill next to its `</>` chip
(the renderers already place chips via the host's `data-anchor` seam), and
a card's side bar shows its total; both open the panel on the thread. The
visual stays the picture; the conversation stays in the panel. Badges
derive from the API thread on every reload and are never stored —
like visited state.

### D9. Thread-only reloads patch in place

`PlateShape` gains a `thread` signature (the thread JSON) in place of
`reviewed`; `arrivalPlan` returns a new `"thread"` plan when only that
differs. The shell then re-renders the panel's thread list (keeping scroll
and drafts) and the badges, leaving the strip, camera, selection and drawer
untouched. A reply landing while the human reads must not move anything —
the same rule that governs arriving nibbles.

### D10. Replies may link into the thread's visual

Reply prose runs through `proseToHtml` with the thread's card as scope, so
`[phrase](@id)` lights the visual like nibble prose; the host's hover
handshake is keyed by card, so the panel passes the card index for the
lookup. Validation on the CLI side resolves those ids against the thread's
target nibble (`reply.anchor`). Reply refs take no `@anchor` — the element
already carries its own refs — and open the drawer in the thread's card via
`/api/code?round&comment&ref`, served by the same `resolveRef` path.

### D11. Error codes

Seven new codes, chosen to name the situation the agent must fix:
`review.round` (ordering), `review.thread` (a bad thread link),
`reply.malformed`, `reply.target`,
`reply.duplicate`, `reply.orphan`, `reply.anchor` (a ref anchor, or a prose
link that doesn't resolve). `review.exists` keeps its code with a sharper
message ("round N still awaits the agent's reply").

### D12. Budget

Reply text: 150 words, `cli.budget` + `--because` like every other budget.
Between the overview (100) and standard (250) descriptions: an answer, not
an essay — a long answer belongs in a new nibble, which the next item
enables.

## Risks / Trade-offs

- [The reader sends round 2 before the agent's `reply` finished a round it
  thought was still its own] → impossible by construction: the API refuses
  a round while any comment lacks a reply (`review.exists`), and `reply`
  refuses a comment already answered (`reply.duplicate`); both under the
  plate lock.
- [Agent re-serves on a different port; the old tab waits forever] → the
  notice after a send says a new link may be relayed; the probe is cheap
  and stops the moment the tab is closed. The Tauri pill (v1) makes this
  moot.
- [`serve` on an unanswered round now blocks with the UI where it used to
  serve read-only] → observable behavior is the same (blocking, plate
  viewable); only the exit on timeout changes from "the review's code" to
  the owed round's code — identical for an unreplied round.
- [The panel takes width from the canvas] → it is closed by default on a
  plate with no conversation, opens itself when the first reply lands, and
  the camera recentres on resize as it already does for the legend.
- [Drafts lost on a thread-only reload] → drafts live in panel state, not
  in the DOM; the re-render reads them back; a full rebuild (a changed
  nibble) keeps them the same way.
- [Hand-written replies with refs need fingerprints] → `reply` computes
  them; a fixture written by hand copies stored refs from a CLI-authored
  plate, as the ledger fixtures already do.
- [`cli-authored` golden plate "ships reviewed" and the README's
  serve-the-example recipe deletes `review.json`] → the fixture grows a
  full conversation (round 1, replies, a round-2 follow-up, its reply, a
  round-3 done) and the recipe deletes `review*.json reply*.json`.
