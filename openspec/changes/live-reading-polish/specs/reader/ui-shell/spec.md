# Spec Delta

## MODIFIED Requirements

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

## ADDED Requirements

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
