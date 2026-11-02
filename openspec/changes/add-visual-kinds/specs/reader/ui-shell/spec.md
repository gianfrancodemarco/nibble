# Spec Delta

## MODIFIED Requirements

### Requirement: One canvas, a camera

The shell SHALL render the whole plate on one canvas: a card per nibble
(caption, the rendered visual as the card's body, budget reason when
present) laid out in reading order. At standard window sizes the active
card's visual SHALL take the majority of the viewport (R1: visual-first),
caption below, code in the drawer. Stepping (buttons, arrow keys) SHALL move
a camera — an animated transform centering the active card — never a page
navigation.

#### Scenario: Stepping moves the camera
- **WHEN** the reader shows a 3-nibble plate and the user steps forward
- **THEN** the canvas transform animates to center card 2; the document URL
  and page do not change

#### Scenario: The visual is the card
- **WHEN** the active card renders a map at a standard window size
- **THEN** the rendered visual is the dominant element — larger than caption
  and chrome combined — with the caption beneath it

### Requirement: Comments and verdict

The shell SHALL let the reader attach comments to a nibble (target `n<N>`)
or to a selected visual element (target `n<N>:<element-id>`), and choose one
verdict (`approve` / `changes` / `question` / `closed`). Choosing is a
draft: nothing is posted, the verdict can be changed, and `serve` keeps
running. Only an explicit send action SHALL `POST /api/review` — the
irreversible step is one deliberate button, never a stray click. After a
successful send — or on a plate that already has a review — the shell SHALL
show the review and lock input.

#### Scenario: Choosing a verdict is not sending
- **WHEN** the reader clicks `approve` and nothing else
- **THEN** no request is made, `review.json` does not exist, and `serve` keeps
  waiting

#### Scenario: Send ends the loop
- **WHEN** the reader adds a comment on n2, chooses `changes`, and clicks send
- **THEN** the POST carries `{"verdict":"changes","comments":[{"target":"n2",...}]}`
  and the UI switches to the submitted, locked state, then attempts to close
  the tab (falling back to a visible "sent — you can close this tab" state
  where the browser refuses)

#### Scenario: Anchored comment rides the same review
- **WHEN** the reader selects a visual element `cache` on n2, pins a comment,
  and sends with verdict `changes`
- **THEN** the POST's comments include one with target `n2:cache`
