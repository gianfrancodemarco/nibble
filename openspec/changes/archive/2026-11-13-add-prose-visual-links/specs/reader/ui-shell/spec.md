# Spec Delta

## ADDED Requirements

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
