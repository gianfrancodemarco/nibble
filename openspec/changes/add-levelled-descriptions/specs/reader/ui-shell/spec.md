# Spec Delta

## MODIFIED Requirements

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

## ADDED Requirements

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
