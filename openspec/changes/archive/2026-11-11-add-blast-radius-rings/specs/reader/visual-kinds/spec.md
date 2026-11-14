# Spec Delta

## ADDED Requirements

### Requirement: Ring layout
A ringed map (every node declaring `ring`) SHALL render as three concentric
zones read inside-out — `changed` at the centre, `dependent` around it,
`rest` outside — each zone visibly delimited and labelled, no two nodes
overlapping at the 12-node budget. An unringed map keeps its existing layout.
Layout SHALL be deterministic and computed from the full document; the dial
only changes which nodes are drawn, never where.

#### Scenario: Golden ringed map renders as rings
- **WHEN** the reader renders a golden ringed map (changed, dependent and
  rest nodes with edges across rings)
- **THEN** every node sits in the zone its `ring` names, the three zones are
  visibly delimited and labelled, and every node and edge is visible

#### Scenario: Dial does not re-layout rings
- **WHEN** a ringed map with a standard-only dependent node is flipped to
  overview
- **THEN** that node is omitted and every remaining node keeps its position

#### Scenario: Unringed map unchanged
- **WHEN** the reader renders a map with no `ring` hints
- **THEN** it renders with the existing tiered layout, with no ring zones

### Requirement: Visited dependents
The reader SHALL track, per open reader session, which `dependent` nodes the
reader has looked at: a dependent counts as visited once it is selected or
its code drawer is opened. Visited state SHALL persist across nibbles and
dial changes within the session, SHALL apply per element id across every
rendering of the same map, and SHALL NOT be written to the plate, the review,
or anywhere outside the open tab.

#### Scenario: Selecting a dependent visits it
- **WHEN** the reader selects dependent node `pricing-tests` and then clears
  the selection
- **THEN** `pricing-tests` remains visited for the rest of the session

#### Scenario: Opening code visits the node
- **WHEN** the reader opens the code drawer from dependent node `caller-api`
- **THEN** `caller-api` is visited

#### Scenario: Visited state stays out of the review
- **WHEN** the reader submits a review after visiting some dependents
- **THEN** the posted review carries no visited information

### Requirement: Unvisited dependents badged
On a ringed map, every unvisited `dependent` node SHALL carry a visible badge
that distinguishes it from visited dependents; visiting removes the badge
without re-layout. The map SHALL show a count of unvisited dependents (e.g.
"2 of 4 dependents unvisited") that updates as the reader visits them and
reads as done when none remain. `changed` and `rest` nodes are never badged.

#### Scenario: Badges mark the unvisited
- **WHEN** a ringed map with four dependent nodes renders and the reader has
  visited one of them
- **THEN** the three unvisited dependents carry the badge, the visited one
  does not, and the count reads 3 of 4 unvisited

#### Scenario: Visiting the last dependent
- **WHEN** the reader visits the final unvisited dependent
- **THEN** its badge disappears in place and the count reads as done

#### Scenario: Badge survives the dial
- **WHEN** the dial flips to overview and back to standard
- **THEN** visited dependents stay unbadged and unvisited ones stay badged
