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
