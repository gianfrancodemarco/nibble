# Spec Delta

## ADDED Requirements

### Requirement: Ring hint on map nodes
A map node MAY declare `ring`: `"changed"` (the node changed), `"dependent"`
(unchanged, but depends on something that changed — a caller, importer, test
or config), or `"rest"` (everything else in view). Any other value SHALL be
rejected with `map.ring.unknown`, and elements of other visual kinds SHALL NOT
accept `ring`. Like every hint, `ring` says what the node is, never how it is
drawn.

#### Scenario: Ringed node accepted
- **WHEN** validating a map whose node declares `"ring": "dependent"`
- **THEN** the visual is valid

#### Scenario: Unknown ring value rejected
- **WHEN** validating a map node with `"ring": "blast"`
- **THEN** validation fails with code `map.ring.unknown` listing the three
  ring values

#### Scenario: Ring on a sequence actor rejected
- **WHEN** validating a sequence whose actor declares `"ring": "changed"`
- **THEN** validation fails as an unknown field

### Requirement: Ring coherence
Rings are all-or-nothing per map: if any node declares `ring`, every node
SHALL declare it, else validation fails with `map.ring.partial` naming the
unringed node ids. A ringed map SHALL contain at least one `changed` node,
else validation fails with `map.ring.empty` — rings only mean something
anchored on a change. A map with no `ring` hints at all remains valid and is
not a ringed map.

#### Scenario: Partially ringed map rejected
- **WHEN** validating a map where node `api` declares `"ring": "changed"` and
  node `db` declares no ring
- **THEN** validation fails with `map.ring.partial` naming `db`

#### Scenario: Ringed map without a change rejected
- **WHEN** validating a map whose nodes all declare `"ring": "dependent"` or
  `"ring": "rest"`
- **THEN** validation fails with `map.ring.empty`

#### Scenario: Unringed map still valid
- **WHEN** validating a map whose nodes declare no `ring` at all
- **THEN** the visual is valid

### Requirement: Rings compose with existing hints
`ring` SHALL compose with the existing node hints: a ringed node may still
declare `group` (e.g. grouping dependents into callers / importers / tests /
configs), `tier`, `focus`, `detail` and `level`. Ring coherence SHALL be
checked against all nodes of the document regardless of `level`, so a map is
ringed or not independent of the dial.

#### Scenario: Ringed node with group and level
- **WHEN** validating a ringed map whose node declares `"ring": "dependent"`,
  `"group": "tests"` and `"level": "standard"`
- **THEN** the visual is valid

#### Scenario: Coherence sees standard-only nodes
- **WHEN** a map's only unringed node is standard-only (`"level": "standard"`)
- **THEN** validation still fails with `map.ring.partial` naming it
