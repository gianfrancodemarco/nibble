# Spec Delta

## Purpose

The Claude Code skill: the prompt content that teaches an agent when a plate
is worth building and how to author one that passes validation first try —
captions, visuals, refs, budgets, the serve/review loop. Prompt content, not
code: the CLI enforces what the skill teaches, and the skill's worked
examples are real protocol documents kept valid by CI.

## ADDED Requirements

### Requirement: Skill package shape

The skill SHALL live in the monorepo's `cli/skill/claude-code/` directory as a
Claude Code skill package: a `SKILL.md` whose frontmatter carries the skill
`name` and a `description` stating when to trigger, plus the worked-example
files it references by relative path. The package SHALL be installable as-is
(copying the directory yields a working skill) with no build step.

#### Scenario: Package is self-contained
- **WHEN** `cli/skill/claude-code/` is copied to `.claude/skills/nibble/` in any
  repository
- **THEN** `SKILL.md` parses with name and description frontmatter and every
  file it references resolves inside the copied directory

### Requirement: Teaches when a plate is worth building

`SKILL.md` SHALL state the trigger — explaining a change whose shape matters
(a PR or worktree review, an architecture or incident explanation) — and the
counter-cases where plain text is the right answer (a one-line fix, a rename,
an answer with no structure). It SHALL instruct the agent to tell the user a
plate is being built rather than silently switching output modes.

#### Scenario: Both sides of the trigger are taught
- **WHEN** `SKILL.md` is read
- **THEN** it names concrete cases to build a plate for and concrete cases to
  answer in plain text, not only the positive trigger

### Requirement: Teaches the authoring loop against real commands

`SKILL.md` SHALL teach the full loop with the real command surface: `nibble
new` (choosing `--about` for code, worktree and range plates), `nibble add`
with a caption, a visual file and `--ref` strings in the v1 grammar, `nibble
done`, and `nibble serve` blocking until the review, whose verdict is the
exit code (0 approve, 2 changes, 3 question, 4 closed, 5 timeout).

#### Scenario: The loop is complete
- **WHEN** an agent follows the skill's transcript end to end in a git repo
- **THEN** every command it runs exits 0 and ends with a sealed, served plate

### Requirement: Teaches self-correction on rejection

`SKILL.md` SHALL teach that validation errors are machine-readable and
correctable: on exit 1, read the error code and message, fix the input, and
retry the same command — never abandon the plate over a rejection.

#### Scenario: Self-correction is taught
- **WHEN** `SKILL.md`'s error-handling section is read
- **THEN** it shows at least one real rejection (its code and message) and the
  corrected retry that follows

### Requirement: Teaches visual choice and authoring per kind

The skill SHALL teach how to choose among the four v1 kinds — map for
structure, sequence for interactions, timeline for behavior over time (with
precomputed what-if states), compare for before/after — and how to author
each: meaning only, never pixels; semantic hints (`focus`, `tier`, `group`,
edge `style`, event `weight`); stable element ids that refs anchor to with
`@<id>`.

#### Scenario: Every kind has a worked example
- **WHEN** the skill package is inspected
- **THEN** each of map, sequence, timeline and compare has a complete example
  visual JSON file, and `SKILL.md` says when to reach for that kind

### Requirement: Teaches budgets as discipline, not obstacles

The skill SHALL state the budgets (40-word captions, 7 nibbles for `code` and
`worktree` plates, 12 for `range` plates, 12 map nodes) as the product's
respect for the reader's attention, teach writing within them, and teach
`--because` as the honest override: used when the content genuinely needs
more, with a reason the reader will see — never as a reflex to silence the
error.

#### Scenario: Budget override is framed with its cost
- **WHEN** `SKILL.md`'s budget section is read
- **THEN** it gives a case where `--because` is right and one where trimming
  the plate is right

### Requirement: Teaches answering the review

The skill SHALL teach reading `serve`'s result: the verdict from the exit
code, the review JSON from stdout, and comment targets (`n<N>` and
`n<N>:<element-id>`) mapped back to the nibble and element they point at. It
SHALL instruct the agent to answer `changes` and `question` verdicts by
addressing each comment where the work happens, and when asked for more
detail, to add to the explanation rather than rebuild the plate.

#### Scenario: Targets are decoded
- **WHEN** the skill's review section is read
- **THEN** it shows a review with an element-targeted comment (`n2:cache`
  style) and what the agent should do with it

### Requirement: Worked examples are valid protocol documents

Every example visual in the skill SHALL validate (as `nibble lint` validates
it), and the worked transcript's commands SHALL be consistent with the
examples. CI SHALL lint the skill's example JSON so the skill cannot drift
from the protocol.

#### Scenario: Examples lint clean
- **WHEN** `nibble lint` runs over every `*.json` example visual in the skill
  package
- **THEN** every file exits 0

#### Scenario: Drift fails CI
- **WHEN** a skill example visual is edited to carry an unknown field
- **THEN** the CI lint step fails naming that file
