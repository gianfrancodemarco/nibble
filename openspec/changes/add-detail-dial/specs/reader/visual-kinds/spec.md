# Spec Delta

## ADDED Requirements

### Requirement: Level-aware drawing
At the overview level the renderer SHALL omit every standard-only element; at
standard it SHALL draw everything. Omission SHALL NOT re-layout what remains:
an element drawn at both levels keeps identical position and geometry at both,
so the levels read as layers of one picture, never as two pictures. Layout is
computed from the full (standard) document.

#### Scenario: Overview hides standard-only elements in place
- **WHEN** a map with two overview nodes and one standard-only node is drawn
  at overview
- **THEN** only the two overview nodes and their edges are drawn, at exactly
  the positions they have at standard

#### Scenario: Returning to standard restores the full picture
- **WHEN** the level changes from overview back to standard
- **THEN** every element is drawn again, with nothing moved

### Requirement: Interactions follow the drawn set
Stepping, scrubbing and selection SHALL operate on drawn elements only: at
overview, sequence stepping advances through overview steps, the timeline
scrubber and states reflect overview events, and a standard-only element is
not selectable, carries no code marker, and cannot be a comment target.

#### Scenario: Sequence stepping skips hidden steps
- **WHEN** a sequence with five steps, two of them standard-only, is stepped
  through at overview
- **THEN** advancing visits exactly the three overview steps, in order

#### Scenario: Hidden element is not interactive
- **WHEN** a standard-only node with an anchored ref is hidden at overview
- **THEN** it cannot be selected and opens no code drawer until the level
  returns to standard
