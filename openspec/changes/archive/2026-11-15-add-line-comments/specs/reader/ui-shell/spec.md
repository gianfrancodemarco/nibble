# Spec Delta

## ADDED Requirements

### Requirement: Selecting lines in the drawer

The drawer's gutter SHALL be a review gutter: activating a line number
selects that line, activating another with shift extends the selection to
a contiguous range, and activating the selected line again clears it.
Selected lines SHALL be visibly marked, distinct from the referenced range.
The selection SHALL clear when the drawer closes or shows other code, and
`esc` SHALL clear it before closing the drawer.

#### Scenario: One line, then a range
- **WHEN** the reader activates line 16's number, then line 18's with shift
- **THEN** lines 16 through 18 are marked selected

#### Scenario: Selection clears with the drawer
- **WHEN** lines are selected and the reader opens another ref's code
- **THEN** no line is selected in the new content

#### Scenario: Escape clears the lines first
- **WHEN** lines are selected and the reader presses `esc`
- **THEN** the selection clears and the drawer stays open; a second `esc`
  closes it

### Requirement: The composer writes on the selected lines

While lines are selected in the drawer and no thread is focused, the
composer SHALL say it opens a new thread on those lines (`src/x.ts:16-18`)
in the current target, and the comment it sends or holds SHALL carry
`target` as the current target and `ref` as `{"ref": "<at>:<start>-<end>"}`
built from the drawer's address. Lines selected in a reply ref's drawer
take the thread's target. Without a selection the composer behaves as
before.

#### Scenario: Line comment rides the review
- **WHEN** the drawer shows nibble 2's ref on `src/upload/handler.ts` with
  `s4` selected, lines 16-18 are selected, and the reader writes and sends
- **THEN** the POST carries `{"target": "n2:s4", "ref": {"ref":
  "src/upload/handler.ts:16-18"}, "text": …}`

#### Scenario: Line comment in the ledger drawer
- **WHEN** the ledger drawer shows `src/b.ts`'s base side on a range plate
  and the reader selects line 10 and writes
- **THEN** the draft's target is `ledger:src/b.ts#base` and its ref is
  `diff:src/b.ts@<base>..<head>#base:10`

#### Scenario: Composer names the lines
- **WHEN** lines 16-18 are selected and no thread is focused
- **THEN** the composer reads that it opens a new thread on
  `src/upload/handler.ts:16-18` in `n2:s4`

### Requirement: Line threads

A thread whose opener carries a ref SHALL show, under its target chip, a
code chip with the path, the range and the ref's trust badge. Activating
the chip SHALL move the camera to the thread's card, select its element
when the target names one, and open the drawer on the comment's lines. The
thread's chip and badges SHALL otherwise behave as a thread on the same
target.

#### Scenario: Chip opens the lines
- **WHEN** the reader activates the code chip of a thread on `n2:s4` with
  ref `src/upload/handler.ts:16-18` while reading nibble 1
- **THEN** the camera moves to nibble 2, `s4` is selected and the drawer
  shows lines 16-18 in-range with the ref's trust badge

#### Scenario: Trust shows on the chip
- **WHEN** a line thread's ref has gone stale
- **THEN** its code chip wears the stale badge

### Requirement: Lines tell threads apart

Two threads on one target with different refs SHALL be distinct, and a
draft on selected lines SHALL continue an existing thread only when its
target and ref both match.

#### Scenario: Same target, different lines
- **WHEN** thread 1.1 is on `n2:s4` lines 16-18 and the reader selects
  lines 30-31 of the same drawer and holds a message
- **THEN** a new thread appears, not a follow-up in thread 1.1

#### Scenario: Same lines continue the thread
- **WHEN** thread 1.1 is on `n2:s4` lines 16-18, round 1 is answered, and
  the reader selects lines 16-18 again and holds a message
- **THEN** the draft appears as a follow-up in thread 1.1

### Requirement: Threads mark their lines in the drawer

While the drawer shows code, every thread whose ref has the drawer's
address and whose trust-resolved range meets the shown lines SHALL wear a
message-count badge in the gutter on its first shown line; activating the
badge SHALL open the panel focused on that thread. Badges SHALL follow
messages landing and SHALL never be posted.

#### Scenario: Gutter badge opens the thread
- **WHEN** the drawer shows `src/upload/handler.ts` lines 12-22 and a
  three-message thread covers lines 16-18
- **THEN** line 16's gutter shows a badge reading 3, and activating it
  focuses that thread in the open panel

#### Scenario: Another file's thread stays out
- **WHEN** a thread covers `src/other.ts:1-3` and the drawer shows
  `src/upload/handler.ts`
- **THEN** no badge appears for it

#### Scenario: Shifted lines badge where they are now
- **WHEN** a thread's ref on lines 16-18 resolves `shifted +2`
- **THEN** the badge sits on line 18's gutter

## MODIFIED Requirements

### Requirement: The composer

The panel SHALL end with a composer. With a thread focused it SHALL write a
follow-up in that thread; with none focused it SHALL open a new thread on
the selected drawer lines, else the current selection, else the active
card, and say which. The composer SHALL be locked, saying why, while the
turn is the agent's. Send (⌘⏎) sends the message with every held draft;
hold (⇧⌘⏎) keeps it as a draft.

#### Scenario: Follow-up in the focused thread
- **WHEN** thread 1.2 is focused and the reader types and holds
- **THEN** a draft bubble appears at the end of thread 1.2, marked unsent,
  and the send button reads `Send +1`

#### Scenario: New thread on the selection
- **WHEN** no thread is focused, `cache` on nibble 2 is selected, and the
  reader types and holds
- **THEN** a new thread headed `n2:cache` appears with the draft bubble

#### Scenario: New thread on selected lines
- **WHEN** no thread is focused, the drawer has lines 16-18 selected, and
  the reader types and holds
- **THEN** a new thread headed `n2:cache` with the code chip
  `src/x.ts:16-18` appears with the draft bubble

#### Scenario: Draft removed
- **WHEN** the reader removes a draft bubble
- **THEN** it leaves the panel and the send button counts one fewer

#### Scenario: Composer locked on the agent's turn
- **WHEN** the turn is the agent's
- **THEN** the composer is disabled and says the agent is answering
