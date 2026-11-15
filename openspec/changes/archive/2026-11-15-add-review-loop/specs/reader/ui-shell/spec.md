# Spec Delta

## MODIFIED Requirements

### Requirement: Comments and the send action

The shell SHALL let the reader write messages in the chat: a new thread on
a nibble (target `n<N>`) or a selected visual element (target
`n<N>:<element-id>`), or a follow-up in an existing thread. The composer's
**Send** (⌘⏎, the default) SHALL `POST /api/review` with the typed message
and every held draft as the next round — that is what wakes the agent;
**Hold** (⇧⌘⏎) keeps the message as a draft for the next send. Drafts show
at once, marked unsent, and can be removed. There SHALL be no done button:
with nothing typed and nothing held, send does nothing — silence is done.
While the turn is the agent's the composer SHALL be locked and say so.

#### Scenario: Pinning a comment is not sending
- **WHEN** the reader writes a message and holds it
- **THEN** it shows as an unsent draft, no request is made, `review.json`
  does not exist, and `serve` keeps waiting

#### Scenario: Send ends the loop
- **WHEN** the reader writes a message on n2 and presses ⌘⏎
- **THEN** the POST carries `{"comments":[{"target":"n2",...}]}` and the
  composer locks, saying the agent is answering — the tab stays open

#### Scenario: Done with no comments
- **WHEN** the composer is empty and nothing is held, and the reader presses
  send
- **THEN** no request is made

#### Scenario: Anchored comment rides the same review
- **WHEN** the reader selects a visual element `cache` on n2, writes a
  message, and sends
- **THEN** the POST's comments include one with target `n2:cache`

#### Scenario: Follow-up rides the next round
- **WHEN** round 1 is answered and the reader writes in thread 1.2 and sends
- **THEN** the POST's comment carries `"thread": "1.2"` and no target of its
  own

#### Scenario: Next round opens when the replies are in
- **WHEN** the reader is on a plate whose round 1 has every comment replied
- **THEN** the composer unlocks and a send opens round 2

### Requirement: A dead server is announced

When the event stream drops and the plate can no longer be fetched, the shell
SHALL say so instead of silently going stale, and keep probing for the plate
to be served again on the same address: when it is, the shell SHALL clear
the notice and reload the plate, picking up the conversation. Before any
review was sent the notice SHALL say serve has exited and suggest re-running
it; after a send it SHALL say the agent is awake and the tab reconnects
when the plate is served again. A transient stream reconnect, where the
plate still fetches — including the hand-over from `serve` to its keeper
and back — SHALL show nothing.

#### Scenario: Serve exits while the tab is open
- **WHEN** the serve process exits and the event stream errors with the plate
  unfetchable
- **THEN** the notice says serve has exited and suggests re-running it

#### Scenario: Transient reconnect stays quiet
- **WHEN** the event stream errors once but `/api/plate` still responds
- **THEN** no notice appears

#### Scenario: The plate comes back with replies
- **WHEN** the reader sent a review, serve exited, and the plate is served
  again on the same address with `reply.json` written
- **THEN** the notice clears and the replies render in the panel without
  the reader reloading the page by hand

## ADDED Requirements

### Requirement: The chat panel

The chat SHALL be a full-height column on the right of the page, beside
the one card in view, collapsible to a slim rail (name, message count, a
live marker while the agent answers) and back. It holds every thread in
opening order, a composer at its foot, and a header with the turn, the
count and the send button. Messages are bubbles, reader and agent told
apart, drafts marked unsent, never a round number. `c` opens it and
focuses the composer; it never moves the camera.

#### Scenario: Threads listed with their messages
- **WHEN** round 1 opened threads on `n2:s4` and `ledger:src/a.ts`, both
  replied, and round 2 followed up on `n2:s4`
- **THEN** the panel shows two threads; the first reads opener, reply,
  follow-up in order, the second opener and reply

#### Scenario: Focusing the composer keeps the view
- **WHEN** the reader is on nibble 3 with `cache` selected and presses `c`
- **THEN** the chat is open with the composer focused, the camera stays on
  nibble 3 and `cache` stays selected

#### Scenario: Full height, collapsible
- **WHEN** a plate opens
- **THEN** the chat column runs the full height of the page beside the
  single card; collapsing it leaves a rail with the count and live marker,
  and the card takes the freed width

#### Scenario: Untargeted comment
- **WHEN** a hand-written review carries a comment with no target
- **THEN** the panel shows its thread headed `plate`

### Requirement: Threads point at the plate

Activating a thread's target chip SHALL move the camera to the card the
target names and, for an element target, select that element exactly as
clicking it would. Selecting an element or activating a card that has a
thread SHALL focus that thread in an open panel.

#### Scenario: Chip moves the camera and selects
- **WHEN** the reader activates the chip of a thread on `n2:s4` while
  reading nibble 1
- **THEN** the camera moves to nibble 2, `s4` is selected and the thread is
  focused

#### Scenario: Selection focuses the thread
- **WHEN** the panel is open and the reader clicks `s4` on nibble 2
- **THEN** the thread on `n2:s4` scrolls into view and is focused

### Requirement: Message badges on the plate

A visual element with a thread SHALL wear a message-count badge, and a card
with any thread (on it or its elements) SHALL show the count in its side
bar; activating a badge SHALL open the panel focused on that thread. Badges
SHALL update as messages land and SHALL never be written to the review.

#### Scenario: Element badge opens its thread
- **WHEN** `s4` on nibble 2 has a thread of three messages and the reader
  activates its badge
- **THEN** the panel opens with that thread focused and the badge reads 3

#### Scenario: Badge counts a landing reply
- **WHEN** a reply to the thread on `s4` arrives over the stream
- **THEN** the badge reads 4 without a reload

### Requirement: The composer

The panel SHALL end with a composer. With a thread focused it SHALL write a
follow-up in that thread; with none focused it SHALL open a new thread on
the current selection, or the active card when nothing is selected, and
say which. The composer SHALL be locked, saying why, while the turn is the
agent's. Send (⌘⏎) sends the message with every held draft; hold (⇧⌘⏎)
keeps it as a draft.

#### Scenario: Follow-up in the focused thread
- **WHEN** thread 1.2 is focused and the reader types and holds
- **THEN** a draft bubble appears at the end of thread 1.2, marked unsent,
  and the send button reads `Send +1`

#### Scenario: New thread on the selection
- **WHEN** no thread is focused, `cache` on nibble 2 is selected, and the
  reader types and holds
- **THEN** a new thread headed `n2:cache` appears with the draft bubble

#### Scenario: Draft removed
- **WHEN** the reader removes a draft bubble
- **THEN** it leaves the panel and the send button counts one fewer

#### Scenario: Composer locked on the agent's turn
- **WHEN** the turn is the agent's
- **THEN** the composer is disabled and says the agent is answering

### Requirement: Replies carry evidence

An agent's message SHALL render its markdown with `[phrase](@id)` links
lighting and selecting the thread's card visual exactly as nibble prose
does, one trust-badged code chip per ref opening the drawer on that reply
ref inside the thread's card, and its `because` reason when present. While
the turn is the agent's, an unanswered message SHALL show an awaiting-reply
marker that disappears when the reply lands.

#### Scenario: Reply ref opens the drawer
- **WHEN** a reply carries a ref and the reader activates its chip
- **THEN** the drawer shows that ref's lines with its trust badge, inside the
  thread's card

#### Scenario: Reply link lights the visual
- **WHEN** a reply on nibble 2 reads "the [enqueue](@s4) is retried" and the
  reader hovers the phrase
- **THEN** element `s4` on nibble 2's visual is highlighted

#### Scenario: Awaiting a reply
- **WHEN** the turn is the agent's and a message has no reply yet
- **THEN** the message shows an awaiting-reply marker that disappears when
  the reply lands

### Requirement: The panel header tracks turns

The panel header SHALL say whose turn it is, without round numbers: while
the agent owes replies, that it is answering and how many of the messages
are answered, updating as replies land; once every message is answered,
that it is the reader's turn; after a done round, that done was sent and
the reader may write again.

#### Scenario: Replies landing
- **WHEN** the reader sent two messages and one reply arrives over the
  stream
- **THEN** the header reads that the agent is answering, 1 of 2, and the
  composer stays locked

#### Scenario: Round answered
- **WHEN** the second reply arrives
- **THEN** the composer unlocks and the header says it is the reader's turn

### Requirement: Thread updates keep the reading

A reload that changes only the conversation (a reply or a new round) SHALL
update the panel and the badges in place — the strip, the camera, the
selection, the panel's scroll position, the drafts and an open drawer SHALL
survive it.

#### Scenario: Reply arrives while the drawer is open
- **WHEN** the drawer is open on nibble 2, a draft is typed, and a reply to
  a nibble 1 thread lands
- **THEN** that thread shows the reply, the draft is still there and the
  drawer stays open where it was
