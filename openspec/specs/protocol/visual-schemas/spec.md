# protocol/visual-schemas Specification

## Purpose
Defines the declarative visual format: what an agent may say about a picture.
Agents describe structure and meaning; they never control pixels, colours or
positions. One schema per visual kind, versioned with the protocol.

## Requirements



### Requirement: Visual envelope

Every visual SHALL declare `kind` (one of `map`, `sequence`, `timeline`,
`compare` in protocol v1) and `title` (string). A visual with an unknown
`kind` SHALL fail validation with error code `visual.kind.unknown`. The
envelope SHALL contain no colour, coordinate, size or font fields, and
validation SHALL reject unknown top-level fields (`visual.field.unknown`)
so presentation knobs cannot creep in.

#### Scenario: Unknown kind
- **WHEN** a visual declares `kind: "gantt"`
- **THEN** validation fails with `visual.kind.unknown` listing the v1 kinds

#### Scenario: Pixel smuggling rejected
- **WHEN** a map node carries `x`, `color` or `width` fields
- **THEN** validation fails with `visual.field.unknown` naming the field

### Requirement: Map documents

A `map` SHALL declare `nodes` (id, label, optional `detail`, optional
semantic hints `group`, `tier` (`edge|service|data`), `focus` (boolean)) and
`edges` (from, to, optional label, optional `style: flow|miss|weak`). Node
ids SHALL be unique (`map.node.duplicate`); edges SHALL reference existing
ids (`map.edge.dangling`). A map SHALL have at most 12 nodes
(`map.nodes.budget`).

#### Scenario: Dangling edge
- **WHEN** an edge names `to: "db"` and no node has id `db`
- **THEN** validation fails with `map.edge.dangling`

#### Scenario: Thirteen nodes
- **WHEN** a map declares 13 nodes
- **THEN** validation fails with `map.nodes.budget`

### Requirement: Sequence documents

A `sequence` SHALL declare `actors` (ordered, unique ids with labels) and
`steps`, each with `from`, `to`, `label`, and optional `kind: call|return|
async` and optional `alt` (branch label). Steps SHALL reference declared
actors (`sequence.step.dangling`).

#### Scenario: Step between declared actors
- **WHEN** actors `api` and `db` are declared and a step goes `api → db`
- **THEN** the document validates

### Requirement: Timeline documents

A `timeline` SHALL declare `lanes` (actor id + label), `events` (lane, time
offset or timestamp, label, optional `weight`), and optional `states`: named
precomputed what-if states, each a complete alternative event set with a
label (e.g. "jitter on"). Exactly one state MAY be marked `default`. Events
SHALL reference declared lanes (`timeline.event.dangling`); state names
SHALL be unique (`timeline.state.duplicate`).

#### Scenario: What-if as precomputed states
- **WHEN** a timeline declares states `jitter off` (default) and `jitter on`,
  each with its own events
- **THEN** the document validates and consumers can toggle between the two

### Requirement: Compare documents

A `compare` SHALL declare exactly two sides, `before` and `after`, each with
a label and content that is either a ref (per refs-and-trust), a nested
`map`, or a metric list (name, value, unit). Both sides SHALL have the same
content type (`compare.sides.mismatch`).

#### Scenario: Ref vs metric mismatch
- **WHEN** `before` holds a ref and `after` holds a metric list
- **THEN** validation fails with `compare.sides.mismatch`

### Requirement: Anchors

Every element an agent may want to reference or a reader may want to comment
on — map nodes, sequence steps, timeline events and states, compare sides —
SHALL be addressable by a stable id within the visual, usable as a ref's
`@anchor` and as a comment target. Validation SHALL reject a nibble whose
ref anchors name ids absent from its own visual (`ref.anchor.dangling`).

#### Scenario: Ref anchored to a map node
- **WHEN** a nibble's ref carries `@cache` and its map has a node `cache`
- **THEN** the nibble validates

#### Scenario: Dangling anchor
- **WHEN** a ref carries `@pool` and no element in the nibble's visual has id `pool`
- **THEN** validation fails with `ref.anchor.dangling`

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
