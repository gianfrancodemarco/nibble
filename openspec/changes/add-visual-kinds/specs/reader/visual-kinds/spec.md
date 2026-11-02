# Spec Delta

## Purpose

How the reader draws the four protocol-v1 visual kinds — map, sequence,
timeline, compare — as interactive SVG: layout computed from the declarative
document's meaning, per-kind interactions, anchors wired to code and
comments. Agents describe structure; this capability owns the pixels.

## ADDED Requirements

### Requirement: Layout from meaning, not pixels

The reader SHALL compute all geometry, colour and sizing itself from the
declarative visual document. Semantic hints SHALL be honoured as visual
distinctions: a map node's `focus` draws the eye, `tier` and `group` drive
placement, an edge's `style` (`flow`/`miss`/`weak`) and an event's `weight`
read differently at a glance. Rendering SHALL be deterministic: the same
document draws the same picture on every load.

#### Scenario: Focus node emphasized
- **WHEN** a map declares `focus: true` on node `cache` and not on `db`
- **THEN** the rendered `cache` node is visually emphasized relative to `db`

#### Scenario: Deterministic layout
- **WHEN** the same visual document is rendered twice
- **THEN** both renders place every element identically

### Requirement: Map rendering

A `map` SHALL render every node (labelled, `detail` revealed on
hover/selection) and every edge (with its label and a per-`style`
appearance), with no two nodes overlapping at the 12-node budget. Selecting
a node SHALL highlight it and its incident edges while dimming the rest;
selecting again or elsewhere clears it.

#### Scenario: Golden service map renders whole
- **WHEN** the reader renders `service-map.json` (nodes, edges, tiers,
  a focus node, a `miss` edge)
- **THEN** every node and edge is visible and labelled and the `miss` edge is
  visually distinct from `flow` edges

#### Scenario: Node selection highlights the neighbourhood
- **WHEN** the reader clicks node `cache` on a rendered map
- **THEN** `cache` and its incident edges highlight and unrelated nodes dim

### Requirement: Sequence rendering and stepping

A `sequence` SHALL render actors as labelled lifelines in declared order and
steps as arrows between them — `call`, `return` and `async` visually
distinct, `alt` steps carrying their branch label. The visual SHALL step:
advancing (space, or clicking a step) reveals steps one at a time with the
current step emphasized; a fully stepped sequence shows all steps.

#### Scenario: Stepping reveals one step at a time
- **WHEN** `checkout-request.json` (5 steps) is rendered and the reader
  advances twice
- **THEN** steps s1 and s2 are shown with s2 emphasized, and s3–s5 are not
  yet emphasized

#### Scenario: Branch label visible
- **WHEN** a step declares `alt: "on miss"`
- **THEN** the rendered arrow carries the "on miss" branch label

### Requirement: Timeline rendering, scrubbing and states

A `timeline` SHALL render lanes as labelled rows against one shared clock,
events placed by their `at` with `weight` as emphasis. A scrubber SHALL move
a time cursor: events up to the cursor read as happened, later ones as
pending. When the document declares `states`, the reader SHALL show the
`default` (else first) state and a toggle naming each state; switching
redraws the events of the chosen state on the same lanes and clock.

#### Scenario: Scrubbing the stampede
- **WHEN** `stampede.json` is rendered and the cursor is scrubbed to 12:00:00
- **THEN** the 11:58:00 cache event reads as happened and the 12:00:02
  checkout event reads as pending

#### Scenario: Toggling the fix
- **WHEN** the reader flips the state toggle from "jitter off" to "jitter on"
- **THEN** the lanes and clock stay put and the events redraw to the
  `jitter-on` event set

### Requirement: Compare rendering

A `compare` SHALL render both sides labelled, visually paired, with an
interaction that shifts attention between them (flip or slider). Each
content type renders: metrics as name/value/unit pairs aligned so a metric
reads across both sides; a ref as the referenced code (resolved through the
nibble ref anchored to that side's id, trust badge included) or as the bare
ref text when no nibble ref is anchored to it; a nested map per map
rendering, side by side.

#### Scenario: Metric sides read across
- **WHEN** `latency-metrics.json` is rendered
- **THEN** `p99 4.2 s` (before) and `p99 0.26 s` (after) are aligned as one
  row readable across the two labelled sides

#### Scenario: Ref side with an anchored nibble ref
- **WHEN** a compare side `after` holds a ref and the nibble carries a ref
  anchored `@after`
- **THEN** that side renders the anchored ref's code with its trust badge

### Requirement: Anchors open the code drawer

Every rendered element whose id a nibble ref anchors SHALL be marked as
carrying code and SHALL open the code drawer at that ref's validated lines
when activated (R4). Elements without an anchored ref SHALL NOT be marked.

#### Scenario: Anchored map node opens the drawer
- **WHEN** a nibble's ref carries `@cache` and the reader activates the
  rendered `cache` node's code affordance
- **THEN** the code drawer opens on that ref's lines with its trust badge

### Requirement: Anchored comment targets

Selecting a rendered element SHALL set the comment target to
`n<N>:<element-id>`, shown to the reader before pinning; pinning then
produces a review comment with that target. Clearing the selection SHALL
fall back to the plain `n<N>` target.

#### Scenario: Comment pinned to a node
- **WHEN** the reader selects map node `cache` on nibble 2 and pins
  "pool is the real bottleneck"
- **THEN** the pending comment's target is `n2:cache`

### Requirement: Visual types generated from the schemas

The reader's visual types SHALL be generated from `protocol/schemas/*.json`
by a pinned generator into a committed file; hand-written visual shapes are
not allowed. CI SHALL regenerate and fail on drift, exactly as it does for
`app.js`.

#### Scenario: Schema change without regeneration fails CI
- **WHEN** a visual schema changes but the committed generated types are not
  regenerated
- **THEN** the CI drift job fails on the diff
