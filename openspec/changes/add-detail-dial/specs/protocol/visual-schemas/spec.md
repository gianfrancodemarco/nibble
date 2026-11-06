# Spec Delta

## ADDED Requirements

### Requirement: Per-element level hint
Map nodes and edges, sequence steps, and timeline lanes and events MAY declare
`level`, the minimum dial level at which the element is drawn. In protocol v1
the only accepted value is `"standard"` (standard-only); `"deep"` is reserved
for a later version. An absent `level` means the element belongs to the
overview and is drawn at every level. Any other value SHALL be rejected with
`visual.level.unknown`. Compare sides and sequence actors SHALL NOT accept
`level` (rejected as an unknown field).

#### Scenario: Standard-only map node accepted
- **WHEN** validating a map whose node declares `"level": "standard"`
- **THEN** the visual is valid and the node is standard-only

#### Scenario: Reserved deep level rejected
- **WHEN** validating a sequence step with `"level": "deep"`
- **THEN** validation fails with code `visual.level.unknown`

#### Scenario: Level on a compare side rejected
- **WHEN** validating a compare whose `before` side declares `"level": "standard"`
- **THEN** validation fails as an unknown field

### Requirement: Level coherence
An element drawn at overview SHALL NOT depend on one that is not: a map edge
without `level` whose `from` or `to` names a standard-only node SHALL be
rejected with `map.edge.level`, and a timeline event without `level` in a
standard-only lane SHALL be rejected with `timeline.event.level`. The
dependency the other way — a standard-only edge between overview nodes, a
standard-only event in an overview lane — is valid.

#### Scenario: Overview edge to a standard-only node rejected
- **WHEN** validating a map where node `cache` is standard-only and an
  unlevelled edge declares `"to": "cache"`
- **THEN** validation fails with code `map.edge.level`

#### Scenario: Overview event in a standard-only lane rejected
- **WHEN** validating a timeline where lane `gc` is standard-only and an
  unlevelled event declares `"lane": "gc"`
- **THEN** validation fails with code `timeline.event.level`

#### Scenario: Standard-only edge between overview nodes accepted
- **WHEN** validating a map where both endpoints are unlevelled and the edge
  declares `"level": "standard"`
- **THEN** the visual is valid

### Requirement: Overview never empty
A visual in which at least one element may carry `level` and every such
element declares `"level": "standard"` SHALL be rejected with
`visual.overview.empty` — its overview would draw nothing. A visual with no
levelled elements is valid: it reads identically at both levels.

#### Scenario: All-standard map rejected
- **WHEN** validating a map where every node and every edge declares
  `"level": "standard"`
- **THEN** validation fails with code `visual.overview.empty`

#### Scenario: Unlevelled legacy visual stays valid
- **WHEN** validating a visual written before levels existed, with no `level`
  fields anywhere
- **THEN** the visual is valid and all of it is drawn at both levels
