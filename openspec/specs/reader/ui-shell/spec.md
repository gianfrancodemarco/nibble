# reader/ui-shell Specification

## Purpose

The chassis the visual kinds plug into: one canvas, a camera, the code
drawer and comments. Pure presentation — TypeScript compiled to one
static file, embedded in the Go binary, talking only to the JSON API.

## Requirements





### Requirement: One canvas, a camera

The shell SHALL render the whole plate on one canvas: a card per nibble laid
out in reading order, with **one card in view at a time** at standard window
sizes — the active card takes the viewport, its neighbours off-screen.
Stepping (buttons, arrow keys) SHALL move a camera — an animated transform
sliding the strip to the next card — never a page navigation. A card carries
exactly one title — the nibble's claim — plus its description when present,
the rendered visual as the body, and the budget reason when present; the
visual's own document title SHALL NOT appear as a second heading on the card.

#### Scenario: Stepping moves the camera
- **WHEN** the reader shows a 3-nibble plate and the user steps forward
- **THEN** the canvas transform animates to bring card 2 into view; the
  document URL and page do not change

#### Scenario: One card at a time
- **WHEN** a plate renders at a standard window size
- **THEN** only the active card is in view, filling the canvas, with no
  neighbouring card competing for its width

#### Scenario: One title per card
- **WHEN** a nibble whose visual declares its own `title` renders
- **THEN** the card shows the nibble's title once, and the visual's document
  title is not rendered as a heading

#### Scenario: The visual is the card
- **WHEN** the active card renders a map at a standard window size
- **THEN** the rendered visual is the dominant element, and the card's title
  and description are visible without scrolling — the visual shrinks before
  the text leaves the view

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

The shell SHALL let the reader attach comments to a nibble (target `n<N>`)
or to a selected visual element (target `n<N>:<element-id>`). Pinned
comments are a draft: nothing is posted, comments can be removed, and
`serve` keeps running. Only an explicit send action SHALL `POST /api/review`
— the irreversible step is one deliberate button, never a stray click. The
send button SHALL say what it does: `done` with no pinned comments, `send
N comment(s)` with some. After a successful send — or on a plate that
already has a review — the shell SHALL show the review and lock input.

#### Scenario: Pinning a comment is not sending
- **WHEN** the reader pins a comment and nothing else
- **THEN** no request is made, `review.json` does not exist, and `serve` keeps
  waiting

#### Scenario: Send ends the loop
- **WHEN** the reader adds a comment on n2 and clicks send
- **THEN** the POST carries `{"comments":[{"target":"n2",...}]}`
  and the UI switches to the submitted, locked state, then attempts to close
  the tab (falling back to a visible "sent — you can close this tab" state
  where the browser refuses)

#### Scenario: Done with no comments
- **WHEN** the reader clicks send with no pinned comments
- **THEN** the POST carries `{"comments":[]}` — done — and `serve` exits 0

#### Scenario: Anchored comment rides the same review
- **WHEN** the reader selects a visual element `cache` on n2, pins a comment,
  and sends
- **THEN** the POST's comments include one with target `n2:cache`

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
SHALL show the existing "serve has exited" notice instead of silently going
stale. A transient stream reconnect, where the plate still fetches, SHALL
show nothing.

#### Scenario: Serve exits while the tab is open
- **WHEN** the serve process exits and the event stream errors with the plate
  unfetchable
- **THEN** the notice says serve has exited and suggests re-running it

#### Scenario: Transient reconnect stays quiet
- **WHEN** the event stream errors once but `/api/plate` still responds
- **THEN** no notice appears

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
