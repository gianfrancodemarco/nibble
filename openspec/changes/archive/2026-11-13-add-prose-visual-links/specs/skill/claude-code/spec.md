# Spec Delta

## ADDED Requirements

### Requirement: Teaches prose anchor links

The skill SHALL teach that nibble prose names visual elements with
`[phrase](@id)` anchor links — when to link (the first mention of an element
the picture draws), when not to (don't link every noun), and that a link must
name an id of the nibble's own visual or validation rejects it. At least one
worked example's title or description SHALL carry an anchor link that
resolves against its example visual.

#### Scenario: Linking guidance present
- **WHEN** an agent reads the skill's authoring guidance
- **THEN** it finds the `[phrase](@id)` form, the restraint rule, and the
  dangling-anchor failure named with its error code

#### Scenario: Worked example links prose to its visual
- **WHEN** the worked examples are read alongside their visuals
- **THEN** at least one example's prose carries `[phrase](@id)` where `id` is
  an element of that example's visual
