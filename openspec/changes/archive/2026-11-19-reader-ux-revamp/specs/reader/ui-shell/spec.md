# Spec Delta

## MODIFIED Requirements

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

## ADDED Requirements

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
