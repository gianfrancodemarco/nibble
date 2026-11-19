# reader/ui-shell Specification

## Purpose

The chassis the visual kinds plug into: one canvas, a camera, the code
drawer and comments. Pure presentation — TypeScript compiled to one
static file, embedded in the Go binary, talking only to the JSON API.

## Requirements

### Requirement: One canvas, a camera

The shell SHALL render the whole plate on one canvas: a card per nibble laid
out in reading order, with **one card in view at a time** at standard window
sizes — the active card takes the viewport. Stepping SHALL move a camera
over that canvas, never a page navigation, and SHALL be reachable by
keyboard (arrow keys, home/end), by visible previous/next controls, by the
rail (one numbered, clickable segment per card, wearing the card's message
count), by clicking a neighbouring card where it peeks at the canvas edge,
and by a horizontal trackpad gesture, which moves exactly one card. A
relayout of the canvas — the chat changing width, the window resizing —
SHALL keep the active card centred throughout, without the navigation
animation. Nothing in the chrome SHALL resize the canvas under the camera:
the keyboard help is a popover over the canvas (`?` or its button), and the
plate's description is one folded line with a `more` toggle, so turning the
dial never changes the canvas height. Keyboard focus landing in another
card SHALL move the camera to that card. A card carries exactly one title —
the nibble's claim — plus its description when present, the rendered
visual as the body, and the budget reason when present; the visual's own
document title SHALL NOT appear as a second heading on the card.

#### Scenario: Stepping moves the camera
- **WHEN** the reader shows a 3-nibble plate and the user steps forward
- **THEN** the view animates to bring card 2 into view; the document URL and
  page do not change

#### Scenario: Every way of stepping lands the same
- **WHEN** the user presses →, clicks the next control, clicks the third
  rail segment, or swipes horizontally on a trackpad
- **THEN** the targeted card becomes active and sits centred in the canvas,
  and the rail marks it

#### Scenario: A relayout never moves the card off centre
- **WHEN** the chat column collapses while card 2 is active
- **THEN** at no point during the width change is card 2 more than a few
  pixels off centre, and it does not slide afterwards

#### Scenario: The help and the dial leave the canvas alone
- **WHEN** the reader opens the help, or turns the dial on a plate with a
  long description
- **THEN** the canvas keeps its width and height and the active card stays
  centred

#### Scenario: Focus follows the camera
- **WHEN** the user tabs onto a code chip that belongs to card 4
- **THEN** card 4 becomes the active card and settles centred in the canvas

#### Scenario: One card at a time
- **WHEN** a plate renders at a standard window size
- **THEN** the active card takes the canvas and only the edges of its
  neighbours show, dimmed; clicking a visible neighbour makes it the active
  card and nothing else

#### Scenario: The rail names and counts the cards
- **WHEN** a 3-nibble plate's second nibble has a thread of six messages
- **THEN** the rail shows three numbered segments, the second badged 6,
  and clicking the third centres card 3

#### Scenario: One title per card
- **WHEN** a nibble whose visual declares its own `title` renders
- **THEN** the card shows the nibble's title once, and the visual's document
  title is not rendered as a heading

#### Scenario: The visual is the card
- **WHEN** the active card renders a map at a standard window size
- **THEN** the rendered visual is the dominant element, and the card's title
  and description are visible without scrolling — the visual shrinks before
  the text leaves the view

#### Scenario: A wide visual takes its own height
- **WHEN** the active card renders a map wider than it is tall
- **THEN** the drawing fills the visual slot's width at the height that
  width gives it, centred in the slot, not stretched into the slot's height

### Requirement: Code drawer with trust badges

Each ref on a card SHALL be clickable and open a drawer showing the code from
`/api/code`: line numbers, the referenced range distinguished from context,
and a trust badge — `exact`, `shifted ±N` (with the resolved position), or
`stale` with a visible warning that the code has moved on.

#### Scenario: Stale ref is not presented as current
- **WHEN** a ref's trust is `stale` and its drawer is opened
- **THEN** the drawer shows the stale badge and warning alongside whatever is
  at the original range now

### Requirement: Comments and the send action

The shell SHALL let the reader write messages in the chat: a new thread on
a nibble (target `n<N>`) or a selected visual element (target
`n<N>:<element-id>`), or a follow-up in an existing thread. The composer's
**Send** (⌘⏎, the default) SHALL `POST /api/review` with the typed message
and every held draft as the next round — that is what wakes the agent;
**Hold** (⇧⌘⏎) keeps the message as a draft for the next send. Drafts show
at once, marked unsent, and can be removed. There SHALL be no done button:
with nothing typed and nothing held, send does nothing — silence is done.
While the turn is the agent's the composer SHALL be locked and say so. While
the plate has no card yet the composer SHALL be locked and say that the
first nibble has not landed. Opening the code behind a reply SHALL keep that
reply's thread focused.

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

#### Scenario: Nothing to write on yet
- **WHEN** the reader opens a plate the agent has created but not yet added
  a nibble to
- **THEN** the page renders without error, the placeholder card is centred,
  and the composer is locked with a message saying the first nibble has not
  landed

#### Scenario: A reply's code keeps the thread
- **WHEN** thread 1.1 on n2:cache is focused and the reader opens a code ref
  from the agent's reply in it
- **THEN** the drawer opens on those lines and the composer still reads
  "reply in n2:cache"

### Requirement: Follows a live plate

The shell SHALL subscribe to `/api/events` and reflect new nibbles and the
seal without a reload. Plate reloads SHALL be latest-wins: when reloads
overlap, only the newest response renders, so the shown nibble count never
goes backwards. The progress indicator SHALL say where the plate stands:
while open, a pulsing live marker and `N nibbles · still being written`;
once sealed, `N of N · sealed`.

#### Scenario: Plate grows while open
- **WHEN** the reader is open on a 2-nibble plate and the agent adds n3
- **THEN** card 3 appears without a reload

#### Scenario: Overlapping reloads keep the newest plate
- **WHEN** a reload carrying 3 nibbles resolves after a newer reload carrying
  4 has already rendered
- **THEN** the 4-nibble plate stays on screen and the count never shows 3

#### Scenario: Progress while the agent writes
- **WHEN** the reader shows an open plate with 2 nibbles
- **THEN** the progress reads `2 nibbles · still being written` beside a
  pulsing live marker

#### Scenario: Progress once sealed
- **WHEN** a 3-nibble plate seals
- **THEN** the progress reads `3 of 3 · sealed` and the live marker is gone

### Requirement: Built TS, embedded, drift-guarded

The UI SHALL be TypeScript under `reader/` compiled (pinned tsc, no bundler)
to a committed `app.js` embedded via `go:embed`, so `go install` needs no
Node. Dependencies SHALL stay minimal: no npm runtime dependencies; the only
third-party code is vendored, version-pinned static assets committed under
the ui directory and regenerated by a committed script. CI SHALL rebuild the
UI and fail on drift between source and committed output.

#### Scenario: Drift fails CI
- **WHEN** `app.ts` changes but the committed `app.js` is not rebuilt
- **THEN** the CI job fails on the diff

#### Scenario: Vendored assets are pinned and reproducible
- **WHEN** the vendored highlight bundle needs regenerating
- **THEN** a committed script rebuilds the identical file from a pinned
  upstream version, keeping its license header

### Requirement: The ledger card ends a diff plate

When the plate carries a ledger, the shell SHALL render one final card after
the last nibble — the not-shown ledger — showing every changed file of the
diff as a directory tree, one row per file and side with its uncovered line
ranges and a badge on covered files, plus the shown/total coverage. A fully
covered diff SHALL render the card saying so, never omit it; a plate without
a ledger renders no ledger card. The card joins the strip: camera, stepping
and keys treat it like a nibble card.

#### Scenario: Single-child directories collapse
- **WHEN** the changed files are `docs/guide/deep/one.md` and
  `docs/guide/deep/two.md`
- **THEN** the tree shows one `docs/guide/deep` directory holding both rows

#### Scenario: Partly covered file badged as such
- **WHEN** a file has three hunks and one is covered
- **THEN** its row is badged `1/3 shown` and its label lists only the two
  uncovered ranges

#### Scenario: Changed files listed as a tree
- **WHEN** a sealed worktree plate's ledger lists two uncovered hunks in
  `src/b.ts`, one uncovered in `src/c.ts` and one covered in `src/pool.ts`
- **THEN** the strip ends with a ledger card showing a `src` directory with
  rows for `b.ts`, `c.ts` and `pool.ts`, `pool.ts` badged as shown, and
  arrow-key navigation reaches the card after the last nibble

#### Scenario: Full coverage still shown
- **WHEN** the ledger is `{"shown": 6, "total": 6, "hunks": []}`
- **THEN** the ledger card states that everything in the diff was shown

#### Scenario: Ledger arrives with the seal
- **WHEN** an open plate seals while the reader is watching (SSE `sealed`)
- **THEN** the ledger card appears without a reload

### Requirement: Ledger files open their code

Each listed file row SHALL be activatable and open the code drawer on
`/api/ledger?file=<path>&side=<side>`, showing all of that file-and-side's
uncovered hunks with their lines highlighted and the stretches between
distant hunks elided, with the same trust/unavailability presentation as a
ref: real lines when the side is servable, the server's reason when it is
not.

#### Scenario: File row opens the drawer
- **WHEN** the reader activates a file row with two uncovered hunks on the
  ledger card
- **THEN** the drawer shows both hunks' lines highlighted, with a gap mark
  between non-adjacent segments

### Requirement: Ledger comments

The shell SHALL let the reader attach review comments to the ledger card as
a whole (target `ledger`) or to one file row (target `ledger:<path>` for a
head-side row, `ledger:<path>#base` for a deleted-lines row), through the
same pending-comments flow as nibble comments, posted in the same review.

#### Scenario: Comment pinned to a file
- **WHEN** the reader selects the `src/b.ts` row and adds "why is this
  change not in the walkthrough?"
- **THEN** the pending comment's target is `ledger:src/b.ts` and it posts
  with the review

#### Scenario: Comment on the ledger itself
- **WHEN** the reader comments with the ledger card active and no hunk
  selected
- **THEN** the comment's target is `ledger`

### Requirement: Detail dial
The shell SHALL offer one plate-wide detail dial with two positions in v0.1 —
`overview` and `standard` — opening at standard. It SHALL be visible, show the
active level, and be toggled by the `d` key. Changing the level SHALL redraw
every card's visual in place on the same canvas with the camera unmoved —
never a navigation, a scroll jump, or a per-nibble setting — and SHALL apply
to nibbles that stream in afterwards.

#### Scenario: Plate opens at standard
- **WHEN** a plate is opened
- **THEN** the dial shows standard and every visual is drawn in full

#### Scenario: Toggling with the keyboard
- **WHEN** the reader presses `d`
- **THEN** every card redraws at overview, the camera does not move, and the
  dial control shows overview; pressing `d` again returns to standard

#### Scenario: Live nibbles respect the dial
- **WHEN** a new nibble arrives over the event stream while the dial is at
  overview
- **THEN** its card renders at overview

### Requirement: Selection survives the dial
When the level changes, a selection whose element is still drawn SHALL
persist. A selection whose element is no longer drawn SHALL clear: the comment
target falls back to the plain `n<N>` and any highlight is removed. A comment
already pinned to an element SHALL keep its target regardless of the level.

#### Scenario: Selected element disappears at overview
- **WHEN** a standard-only node is selected and the dial turns to overview
- **THEN** the selection clears and the comment target falls back to `n<N>`

#### Scenario: Selected element survives the turn
- **WHEN** an overview node is selected and the dial turns to overview
- **THEN** the node stays selected and the comment target is unchanged

### Requirement: Descriptions follow the dial

The shell SHALL show the plate's description under the plate header and each
nibble's description under its title, choosing the variant by the dial level:
`overview` at overview, `standard` at standard, falling back to `overview`
when no standard variant exists. Both read as body text, with the active
card's description visible without scrolling; no description means no empty
text region. Turning the dial SHALL swap the texts in place — no navigation,
no camera move.

#### Scenario: Standard shows the fuller text
- **WHEN** a nibble has both description variants and the dial is at standard
- **THEN** the card shows the `standard` text under the title

#### Scenario: Overview shows the skim text
- **WHEN** the dial turns to overview
- **THEN** the same card swaps to the `overview` text without a page change

#### Scenario: Downward fallback
- **WHEN** a plate's description has only `overview` and the dial is at
  standard
- **THEN** the header shows the `overview` text

#### Scenario: No description, no region
- **WHEN** a nibble carries no `description`
- **THEN** its card shows title and visual only, with no empty description
  element

### Requirement: Arrivals never steal the reading

When a reload differs from the shown plate only by new cards at the end (new
nibbles, or the ledger card at the seal), the shell SHALL append those cards
in place: the open code drawer, the current selection, per-visual step state
and the camera SHALL all survive the arrival untouched. Any other difference
(dial flip, review, a changed existing nibble) MAY rebuild wholesale.

#### Scenario: Drawer survives an arrival
- **WHEN** the reader has a code drawer open on card 1 and nibble 3 arrives
- **THEN** the drawer stays open on the same code and card 3 joins the strip

#### Scenario: Step state survives an arrival
- **WHEN** a sequence on the active card is stepped to step 2 and a nibble
  arrives
- **THEN** the sequence still shows step 2

#### Scenario: The camera stays put
- **WHEN** the reader is on card 2 and nibble 4 arrives
- **THEN** the canvas transform does not change

### Requirement: Arriving cards animate in

A card that arrives after the first paint SHALL slide into the end of the
strip — including the first nibble landing in an empty strip and the ledger
card arriving at the seal — and the rail SHALL grow a segment for it in place
rather than rebuilding. The animation SHALL be disabled under
`prefers-reduced-motion`.

#### Scenario: First nibble lands in an empty strip
- **WHEN** the reader opened on a plate with no nibbles yet and n1 arrives
- **THEN** card 1 slides in with the arrival animation

#### Scenario: The ledger card arrives at the seal
- **WHEN** an open plate seals while the reader is watching
- **THEN** the ledger card slides into the end of the strip like a nibble

### Requirement: A ghost marks the next arrival

While the plate is open, the strip SHALL end with one non-interactive
placeholder card — a pulsing skeleton where the next nibble will land.
Arriving cards insert before it, the seal removes it, and it never counts as
a card: the rail, the progress text, stepping and comments ignore it. The
pulse SHALL be disabled under `prefers-reduced-motion`.

#### Scenario: Ghost while the agent writes
- **WHEN** the reader shows an open plate
- **THEN** a placeholder card ends the strip, and the rail and progress count
  only the real cards

#### Scenario: The seal removes the ghost
- **WHEN** the plate seals
- **THEN** the placeholder is gone and the last card is the final one

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

### Requirement: Per-language syntax highlighting

Code lines on every surface the shell draws — the code drawer, the ledger
drawer and the compare visual's ref panes — SHALL be highlighted with
grammar rules for the served file's language, resolved from the file path
the API already returns. A language outside the supported set SHALL render
as plain escaped text with no coloring. All output SHALL be HTML-escaped.

#### Scenario: Language follows the file path
- **WHEN** the drawer shows lines from `internal/pool.go` containing
  `x := price // hot path`
- **THEN** `//` starts a comment and Go keywords are colored, while the same
  text served from a `.py` path colors neither

#### Scenario: Each supported language has its own rules
- **WHEN** lines are served from Go, TypeScript/JavaScript, Python, JSON,
  YAML, Markdown, shell, CSS, HTML or SQL paths
- **THEN** each is highlighted by that language's grammar, not a shared
  keyword set

#### Scenario: A comment marker of another language is not a comment
- **WHEN** the drawer shows a CSS line `color: #fff; /* brand */`
- **THEN** `#fff` is not colored as a comment and `/* brand */` is

#### Scenario: Unknown language stays plain
- **WHEN** the drawer shows lines from a `.xyz` file containing `<b>` and
  `a & b`
- **THEN** no token is colored and every character is HTML-escaped

#### Scenario: Every code surface highlights alike
- **WHEN** the same `.go` ref renders in the drawer and in a compare visual's
  ref pane
- **THEN** both show identical token coloring

### Requirement: Multi-line constructs keep their color

Highlighting SHALL carry lexical state across consecutive served lines, so a
construct spanning lines — a block comment, a Go raw string, a Python
triple-quoted string — keeps its color on every line it covers. An elided
gap between non-adjacent segments SHALL reset the state, so a mid-construct
elision cannot discolor everything after it.

#### Scenario: Block comment spans lines
- **WHEN** the drawer shows a TypeScript excerpt whose `/*` opens on line 3
  and closes with `*/` on line 6
- **THEN** lines 3 through 6 are all colored as comment, and line 7 is not

#### Scenario: Raw string spans lines
- **WHEN** the drawer shows a Go excerpt with a backtick raw string opened on
  one line and closed two lines later
- **THEN** every line between the backticks is colored as string

#### Scenario: Elision resets state
- **WHEN** a ledger drawer excerpt elides a gap and a block comment opened
  before the gap
- **THEN** lines after the gap mark are highlighted from a clean state, not
  as a continuing comment

### Requirement: Prose links light the visual

A `[phrase](@id)` anchor link in a nibble's title or description SHALL render
as an interactive phrase. Hovering (or keyboard-focusing) the phrase SHALL
highlight the element with that id in the same card's visual, and leaving it
SHALL clear the highlight. Activating the phrase (click, Enter) SHALL select
that element — the same selection the visual's own click path produces, so
the comment target and the drawer affordances follow.

#### Scenario: Hover lights the element
- **WHEN** the reader hovers `the [cache](@cache)` in a nibble's description
- **THEN** the map node `cache` in that card's visual is highlighted, and the
  highlight clears when the pointer leaves the phrase

#### Scenario: Click selects the element
- **WHEN** the reader clicks the phrase `[cache](@cache)`
- **THEN** the element `cache` becomes the card's selection and the comment
  target reads `n<N>:cache`, exactly as if the element itself was clicked

#### Scenario: Highlight stays inside the card
- **WHEN** two nibbles both have an element `cache` and the reader hovers a
  prose link on the first card
- **THEN** only the first card's element lights up

### Requirement: The visual lights the prose

Hovering an addressable element in a nibble's visual SHALL highlight every
prose phrase on that card that links to its id, and leaving the element SHALL
clear them. While an element is selected, its linked phrases SHALL stay
marked, so the prose and the picture read as one selection.

#### Scenario: Element hover lights the phrases
- **WHEN** the reader hovers the map node `cache` and the card's title and
  description each carry a `(@cache)` link
- **THEN** both phrases are highlighted until the pointer leaves the node

#### Scenario: Selection marks the phrases
- **WHEN** the reader selects the element `cache`
- **THEN** every `(@cache)` phrase on the card stays marked until the
  selection clears

### Requirement: Selecting an element opens its code

Selecting an addressable element — by clicking it in the visual, or by
activating a prose phrase that links to it — SHALL also open the code drawer
on the ref anchored to that id, when the nibble anchors one. A toggle-off
(deselecting the already-selected element) SHALL NOT open the drawer, and an
id with no anchored ref SHALL select exactly as before, with no drawer. The
code chip's own click path is unchanged: it opens the drawer without
selecting.

#### Scenario: Phrase click opens the linked code
- **WHEN** the reader clicks the phrase `[cache](@cache)` and a ref anchors
  `@cache`
- **THEN** the element is selected and the code drawer opens on that ref's
  lines

#### Scenario: Element click opens its code
- **WHEN** the reader clicks the map node `cache` itself
- **THEN** the same selection and the same drawer open as from the phrase

#### Scenario: Deselecting opens nothing
- **WHEN** the reader clicks the selected element `cache` again
- **THEN** the selection clears and the drawer is not re-opened

#### Scenario: No anchored ref, no drawer
- **WHEN** the reader selects an element whose id no ref anchors
- **THEN** the selection and comment target update and the drawer stays as it
  was

### Requirement: Prose links follow the dial

A prose link whose target element is not drawn at the current dial level
SHALL render as plain emphasized text: readable, but with no hover glow, no
pointer affordance and no selection on click. Turning the dial SHALL
re-evaluate the links, since the overview and standard descriptions and the
drawn set both change with it.

#### Scenario: Undrawn target goes inert
- **WHEN** the dial is at overview and a description phrase links to a
  standard-only element
- **THEN** the phrase renders as plain text with no highlight on hover and no
  selection on click

#### Scenario: Dial turn revives the link
- **WHEN** the dial turns from overview to standard and the element is now
  drawn
- **THEN** the same phrase is interactive again

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
the selected drawer lines, else the current selection, else the active
card, and say which. The composer SHALL be locked, saying why, while the
turn is the agent's. Send (⌘⏎) sends the message with every held draft;
hold (⇧⌘⏎) keeps it as a draft.

#### Scenario: Follow-up in the focused thread
- **WHEN** thread 1.2 is focused and the reader types and holds
- **THEN** a draft bubble appears at the end of thread 1.2, marked unsent,
  and the send button reads `Send +1`

#### Scenario: New thread on the selection
- **WHEN** no thread is focused, `cache` on nibble 2 is selected, and the
  reader types and holds
- **THEN** a new thread headed `n2:cache` appears with the draft bubble

#### Scenario: New thread on selected lines
- **WHEN** no thread is focused, the drawer has lines 16-18 selected, and
  the reader types and holds
- **THEN** a new thread headed `n2:cache` with the code chip
  `src/x.ts:16-18` appears with the draft bubble

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

### Requirement: Selecting lines in the drawer

The drawer's gutter SHALL be a review gutter: activating a line number
selects that line, activating another with shift extends the selection to
a contiguous range, and activating the selected line again clears it.
Selected lines SHALL be visibly marked, distinct from the referenced range.
The selection SHALL clear when the drawer closes or shows other code, and
`esc` SHALL clear it before closing the drawer.

#### Scenario: One line, then a range
- **WHEN** the reader activates line 16's number, then line 18's with shift
- **THEN** lines 16 through 18 are marked selected

#### Scenario: Selection clears with the drawer
- **WHEN** lines are selected and the reader opens another ref's code
- **THEN** no line is selected in the new content

#### Scenario: Escape clears the lines first
- **WHEN** lines are selected and the reader presses `esc`
- **THEN** the selection clears and the drawer stays open; a second `esc`
  closes it

### Requirement: The composer writes on the selected lines

While lines are selected in the drawer and no thread is focused, the
composer SHALL say it opens a new thread on those lines (`src/x.ts:16-18`)
in the current target, and the comment it sends or holds SHALL carry
`target` as the current target and `ref` as `{"ref": "<at>:<start>-<end>"}`
built from the drawer's address. Lines selected in a reply ref's drawer
take the thread's target. Without a selection the composer behaves as
before.

#### Scenario: Line comment rides the review
- **WHEN** the drawer shows nibble 2's ref on `src/upload/handler.ts` with
  `s4` selected, lines 16-18 are selected, and the reader writes and sends
- **THEN** the POST carries `{"target": "n2:s4", "ref": {"ref":
  "src/upload/handler.ts:16-18"}, "text": …}`

#### Scenario: Line comment in the ledger drawer
- **WHEN** the ledger drawer shows `src/b.ts`'s base side on a range plate
  and the reader selects line 10 and writes
- **THEN** the draft's target is `ledger:src/b.ts#base` and its ref is
  `diff:src/b.ts@<base>..<head>#base:10`

#### Scenario: Composer names the lines
- **WHEN** lines 16-18 are selected and no thread is focused
- **THEN** the composer reads that it opens a new thread on
  `src/upload/handler.ts:16-18` in `n2:s4`

### Requirement: Line threads

A thread whose opener carries a ref SHALL show, under its target chip, a
code chip with the path, the range and the ref's trust badge. Activating
the chip SHALL move the camera to the thread's card, select its element
when the target names one, and open the drawer on the comment's lines. The
thread's chip and badges SHALL otherwise behave as a thread on the same
target.

#### Scenario: Chip opens the lines
- **WHEN** the reader activates the code chip of a thread on `n2:s4` with
  ref `src/upload/handler.ts:16-18` while reading nibble 1
- **THEN** the camera moves to nibble 2, `s4` is selected and the drawer
  shows lines 16-18 in-range with the ref's trust badge

#### Scenario: Trust shows on the chip
- **WHEN** a line thread's ref has gone stale
- **THEN** its code chip wears the stale badge

### Requirement: Lines tell threads apart

Two threads on one target with different refs SHALL be distinct, and a
draft on selected lines SHALL continue an existing thread only when its
target and ref both match.

#### Scenario: Same target, different lines
- **WHEN** thread 1.1 is on `n2:s4` lines 16-18 and the reader selects
  lines 30-31 of the same drawer and holds a message
- **THEN** a new thread appears, not a follow-up in thread 1.1

#### Scenario: Same lines continue the thread
- **WHEN** thread 1.1 is on `n2:s4` lines 16-18, round 1 is answered, and
  the reader selects lines 16-18 again and holds a message
- **THEN** the draft appears as a follow-up in thread 1.1

### Requirement: Threads mark their lines in the drawer

While the drawer shows code, every thread whose ref has the drawer's
address and whose trust-resolved range meets the shown lines SHALL wear a
message-count badge in the gutter on its first shown line; activating the
badge SHALL open the panel focused on that thread. Badges SHALL follow
messages landing and SHALL never be posted.

#### Scenario: Gutter badge opens the thread
- **WHEN** the drawer shows `src/upload/handler.ts` lines 12-22 and a
  three-message thread covers lines 16-18
- **THEN** line 16's gutter shows a badge reading 3, and activating it
  focuses that thread in the open panel

#### Scenario: Another file's thread stays out
- **WHEN** a thread covers `src/other.ts:1-3` and the drawer shows
  `src/upload/handler.ts`
- **THEN** no badge appears for it

#### Scenario: Shifted lines badge where they are now
- **WHEN** a thread's ref on lines 16-18 resolves `shifted +2`
- **THEN** the badge sits on line 18's gutter

### Requirement: Fullscreen visual

The shell SHALL offer a fullscreen mode in which the active card's visual
fills the window with the nibble's claim as a caption beneath it, entered
with `f`, with a ⤢ control on the visual, or by double-clicking the visual
(not a thing in it), and left with `esc`, `f`, the stage's close control,
or the browser leaving its own fullscreen. Stepping (keys, the stage's own
previous/next controls) SHALL keep working and swap the visual; a code
chip SHALL open the drawer as a sheet over the stage; the stage SHALL show
where the card stands (`2 / 5`). The visual's state — sequence step,
timeline cursor, selection, an open drawer — SHALL be exactly what it was
on both the way in and the way out, and the card SHALL be centred in the
canvas when the mode ends.

#### Scenario: The visual fills the window
- **WHEN** the reader presses `f` on a sequence card
- **THEN** the card covers the window, the sequence takes most of it, the
  claim reads as a caption beneath, and the stage counts `2 / 5`

#### Scenario: Stepping on the stage
- **WHEN** fullscreen is on and the reader presses →
- **THEN** the next card's visual is on the stage, with its own caption and
  count

#### Scenario: State survives both ways
- **WHEN** a sequence is stepped to 3/8, fullscreen is entered, stepped
  further on the stage, and left with `esc`
- **THEN** the card shows the step the stage showed last, and sits centred

#### Scenario: The drawer is a sheet on the stage
- **WHEN** fullscreen is on and the reader activates a code chip
- **THEN** the drawer opens inside the stage between the visual and the
  caption; `esc` closes the drawer first and a second `esc` leaves
  fullscreen
