# Spec Delta

## ADDED Requirements

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
