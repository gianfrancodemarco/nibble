# Tasks

## 1. Protocol: rounds, threads, replies and the turn (TDD)

- [x] 1.1 Red: `plate_test.go` cases for the thread files — `review.json`
      alone parses as one unanswered round; `review.json` + `reply.json`
      (every comment replied) + `review.2.json` done parses as two rounds
      with the thread closed; a numbering gap, a round after done, and a
      round whose predecessor is unanswered each fail with `review.round`;
      green: `Round`/`Reply` types, `ParseReplies`, round discovery in
      `ParsePlate` (`Plate.Rounds`), codes in `errors.go`; verify
      `go test ./internal/protocol`
- [x] 1.2 Red: thread continuation cases — comment ids are `<round>.<index>`;
      `"thread": "1.2"` on a round-2 comment inherits target `n2:s4`; a
      missing opener, a same-round or later-round id, an opener that is
      itself a continuation, and a mismatched `target` each fail with
      `review.thread`; green: resolve links in `ParsePlate`, expose
      `Comment.ID`, `Comment.Thread` and the resolved target
- [x] 1.3 Red: reply validation cases — empty text / bad `to` / not an
      object → `reply.malformed`; `to` beyond the round or on a done review
      → `reply.target`; two replies to one comment → `reply.duplicate`;
      `reply.2.json` without `review.2.json` → `reply.orphan`; a stored ref
      with `@anchor` → `reply.anchor`; a ref with a bad `fp` →
      `ref.fp.invalid`; green: implement, reusing the nibble ref checks
- [x] 1.4 Red: reply prose cases — `[x](@s4)` in a reply to `n2:s4` passes
      when nibble 2 declares `s4`; the same on a reply to a follow-up of
      that thread passes; a dangling id, and any link in a reply on a
      `ledger:` or untargeted thread, fail with `reply.anchor`; green:
      resolve against the thread's target nibble via `ValidateNibbleProse`
- [x] 1.5 Red: `Plate.Turn()` table test — no review → `reader`; unreplied
      comment → `agent`; all replied → `reader`; done → `done`; and a
      `Plate.Threads()` helper returning each opener with its ordered
      messages (reader/agent alternation across rounds); green: implement;
      extend `plateExpected` with optional `turn`, `rounds` and `threads`
      so golden fixtures assert them
- [x] 1.6 Golden plates: `review-loop` (valid three-round conversation: two
      openers, replies with a stored ref copied from `cli-authored` and a
      prose link, a round-2 follow-up and its reply, round 3 done),
      `review-round-gap`, `review-after-done`, `review-thread-bad`,
      `reply-duplicate`, `reply-orphan`, `reply-anchor`, each with
      `expected.json`; verify `TestGolden` passes and fails when a fixture's
      expected code is edited
- [x] 1.7 `protocol/PROTOCOL.md`: the folder layout grows the round files;
      a "review thread" section replaces the `review.json` section (rounds,
      comment ids and `thread`, reply shape, ordering, the turn); eight
      codes in the error index and `review.exists`'s sharper meaning; the
      CLI paragraph lists `reply`; verify every code named in the doc
      exists in `errors.go` (grep)

## 2. CLI: `nibble reply` (TDD)

- [x] 2.1 Red: `reply_test.go` — on a sealed plate with a two-comment
      `review.json`, `reply --to 1 --text …` writes `reply.json` with one
      reply and prints `1 of 2`; `--to 2` then prints the round answered and
      `Turn()` is `reader`; with `--json` the object carries
      `round/to/answered/of`; green: `reply.go` wired in `main.go`'s
      dispatch, writing under `lockDir` with `writeAtomic`
- [x] 2.2 Red: refusals — no review, done review, `--to 3` on two comments
      → exit 1 `reply.target` naming the comments; a second `--to 1` →
      `reply.duplicate` with the file unchanged; missing `--to`/`--text` →
      exit 2; green: implement
- [x] 2.3 Red: refs and prose — `--ref` over real lines is stored with an
      `fp1:` sum and line hashes; a range past EOF → `ref.range.beyond-eof`;
      `--ref "… @cache"` → `reply.anchor`; `--text "[enqueue](@s4)"` on an
      `n2:s4` comment passes, and on a round-2 follow-up of that thread
      passes, while `[x](@nope)` fails `reply.anchor`; a link on a `ledger:`
      comment fails; green: reuse `add`'s ref pipeline
- [x] 2.4 Red: budget — 151 words without `--because` → `cli.budget`; with
      `--because` the reply stores the reason; green: `replyWordBudget = 150`
- [x] 2.5 Red: a reply to a later round lands in `reply.2.json` (fixture:
      round 1 answered, `review.2.json` with one follow-up); green: pick the
      latest round's file name
- [x] 2.6 `cli/README.md`: `reply` in the command block, the reply budget
      under Budgets, the example-plate recipe deleting `review*.json` and
      `reply*.json`; verify the recipe runs as written

## 3. CLI: `serve` learns the loop (TDD)

- [x] 3.1 Red: `serve_test.go` — headless on an unanswered `review.json`
      still prints and exits 2 immediately; headless on a closed thread
      exits 0; on an answered round 1, `review.2.json` written 300 ms later
      is printed (`· round 2`) and exits with its code within 2 s; green:
      the wait predicate from design D5 (rounds at start, turn-aware)
- [x] 3.2 Red: `serve_http_test.go` — with the UI on an unanswered round,
      `serve` stays up (`/api/plate` answers), `reply.json` written during
      the wait does not end it, and `--timeout` ends it with exit 2; on an
      answered round, `--timeout` ends it with 5; a closed thread serves
      read-only and exits 0 on timeout; green: implement
- [x] 3.3 Red: output — markdown first line `comments: 1 · round 1`, `done —
      no comments · round 2`; a follow-up's section quotes its thread's
      opener and reply marked reader/agent before its text; `--json`
      carries `"round"` and per-comment `id` and `history`; green:
      implement with `Plate.Threads()`; verify the existing `TestRunServe`
      cases still pass unchanged

## 4. HTTP API: the conversation (TDD)

- [x] 4.1 Red: `http_test.go` — `/api/plate` on a fresh plate has
      `thread: {turn: "reader", rounds: []}`; with `review.json` (two
      comments) + a reply to comment 1 carrying a ref, `turn` is `agent`,
      round 1 lists both comments with ids, the first's reply has the ref
      with computed trust, the second's `reply` is null; a round-2
      follow-up carries `thread: "1.2"` and the opener's target; green:
      build the thread in `servePlate`, replacing the `review` field
      (update the test's response struct)
- [x] 4.2 Red: `POST /api/review` — 409 `review.exists` while a comment is
      unreplied with the message naming the round; 200 writing
      `review.2.json` once round 1 is answered, including a comment with
      `thread` and no target; 400 `review.thread` for a bad link, nothing
      written; 409 `review.closed` after a done review; green: implement
      under the lock, validating through the same parser `ParsePlate` uses
- [x] 4.3 Red: `/api/code?round=1&comment=1&ref=0` returns the reply ref's
      lines, context and trust; out-of-range round/comment/ref → 404;
      green: implement via `resolveRef`
- [x] 4.4 Red: SSE — writing a reply to one of two comments emits
      `reply {"round":1,"answered":1,"of":2}`; `review.2.json` emits
      `review {"round":2,"comments":N}`; green: extend `plateSnapshot`
      with rounds and reply counts

## 5. Reader: the chat panel (TDD, node suite)

- [x] 5.1 Red: `reader/test/chat.test.ts` for a new pure `src/chat.ts` —
      `buildThreads(thread, drafts)` groups comments by opener in round
      order with replies and follow-ups interleaved and drafts appended
      (a draft on a fresh target opens a new thread at the end);
      `cardOfTarget(target, nibbles, hasLedger)` (n2:s4 → 1, ledger:… →
      the ledger index, untargeted → 0, n9 on a 3-nibble plate → null);
      `badgeCounts(threads)` per element and per card; `turnLabel(thread,
      justSent)` strings for agent/reader/done with answered counts;
      `reviewBody(drafts)` emitting `{target}` for new threads and
      `{thread}` for follow-ups; add the file to both tsconfig `files`
      lists; green: implement
- [x] 5.2 Red: `live.test.ts` — `plateShape` takes the thread signature;
      `arrivalPlan` returns `"thread"` when only the thread differs, still
      `"append"` for a new nibble with the thread unchanged, `"rebuild"`
      when both differ; green: implement
- [x] 5.3 Shell: `index.html` gains the panel (`#chat`: header with turn
      text and the send button, `#threads`, the composer with hold / ask
      now) and a chrome toggle; the popover and footer review bar are
      removed; `c` toggles the panel; `Plate.thread` type replaces
      `review`; `renderChat()` draws threads from `buildThreads` with
      target chips, reader/agent bubbles, round and unsent marks, awaiting
      markers, reply refs as `trustBadge` chips calling `openDrawer` with
      the `round/comment/ref` query in the thread's card, reply prose via
      `proseToHtml` scoped to the thread's card; verify by serving the
      `review-loop` golden plate and reading both threads with a reply chip
      opening the drawer
- [x] 5.4 Shell: wiring — a target chip calls `setActive` then the host's
      `selectId`; selecting an element or activating a card focuses its
      thread in an open panel; the composer targets the focused thread or
      the current selection/card and says which; hold adds a draft bubble,
      ask now adds and submits; drafts removable; composer locked on the
      agent's turn and on done; `submit` no longer calls `window.close()`;
      verify by posting a review from the UI, writing `reply.json` by hand,
      and watching the header count up and the composer unlock
- [x] 5.5 Shell: badges — the host's chip seam places a count pill on
      elements with a thread (map, sequence, timeline, compare, ledger
      rows) and the card side bar shows its total; activating one opens
      the panel on that thread; counts refresh on a `"thread"` plan without
      touching the strip; verify on the golden plate and with a live reply
- [x] 5.6 Shell: reconnect — on a dead probe, show the sent-aware notice and
      poll `api/plate` every 2 s until it answers, then clear and reload;
      `EventSource` `open` after a drop reloads; the panel opens itself
      when the first reply ever lands; verify by killing and re-running
      `serve --addr` on the same port with a reply added
- [x] 5.7 Styles in `cli/internal/cmd/ui/style.css`: the panel (width,
      slide, both themes), thread headers, bubbles (reader/agent/draft),
      round marks, awaiting pulse, ref chips, badges on elements and
      cards, the composer; the legend's width rule reused for the camera
      recentre on toggle; rebuild `app.js` (`npm run build`) and verify
      `npm test` and the Go suite pass with the committed bundle

## 6. Skill: answering through the loop

- [x] 6.1 Rewrite SKILL.md's "## The review" into the loop: read the round
      as a batch, decode targets (incl. `ledger…`) and a follow-up's
      printed history, fix code where asked, `nibble reply` each comment
      with text and `--ref` proof, re-serve with `--addr` on the first
      address, handle the next round's three outcomes, never rebuild the
      plate; add "## A worked conversation" with the round-1 review that
      came back for the image-resize plate, its `reply` commands, the
      round-2 follow-up as `serve` prints it (with history) and its reply;
      verify the section reads against the CLI's real flags
- [x] 6.2 Red: `TestSkillConversationTranscript` — builds the authoring
      transcript's plate, writes each review JSON shown in "## A worked
      conversation" at the point the transcript shows it, runs the
      `nibble reply` commands and asserts every exit is 0 and the plate
      ends with two answered rounds; green: make the transcript pass;
      verify the existing `TestSkillTranscript` still passes
- [x] 6.3 `nibble setup` round trip: install the skill into a temp repo and
      verify the copied SKILL.md carries the conversation section (existing
      `setup_test.go` content check extended)

## 7. Golden plate from the CLI and the live demo

- [x] 7.1 Extend the `cli-authored` fixture through its generating test
      (`e2e_test.go`): round 1 with two comments, `reply` to both (one with
      a ref), a round-2 follow-up and its reply, `review.3.json` done;
      `expected.json` asserts `turn: done`, three rounds and two threads;
      verify `TestGolden` and the README recipe
- [x] 7.2 `docs/demo/make.sh`: after sealing, post a one-comment review on
      `n1:cache`, reply with a ref and a prose link, post a follow-up and
      reply again, snapshot the plate so the site's demo opens with a
      two-exchange thread; `shim.js` serves the reply refs' code snapshots
      and answers `POST api/review` locally so drafts on the demo page
      behave; verify `docs/visuals/reader.html` opens from `file://` with
      the panel and `cmp` against the embedded bundle passes

## 8. Site pages

- [x] 8.1 `docs/guide/answering.html`: the chat panel — threads on things,
      drafts, send, the agent's replies landing, follow-ups, done; the
      sent tab stays open; `docs/guide/agents.html`: `reply` in the
      command list, `serve`'s turn-aware exit codes and printed history,
      `review`/`reply` events, the per-round files and `thread`; `docs/
      guide/reading.html`: `c` opens the chat, badges on elements; verify
      each page renders (open in a browser) and links resolve
- [x] 8.2 `docs/index.html` / `docs/guide/index.html` wording ("one
      review", "threaded", the popover's hold / ask now) checked against
      the new behavior; verify no page still says the tab closes after
      sending

## 9. The page outlives the wake-up; the chat docks (TDD)

- [x] 9.1 Red: `serve_http_test.go` — after `serve` (UI) exits 2 on a posted
      round, `GET /api/plate` on the same URL still answers, a reply written
      afterwards shows in it and reaches a connected event stream; headless
      leaves nothing listening; green: a `keeper` loop in `serve.go` that
      serves an inherited listener and ends on `/api/handoff` with the
      recorded token, on timeout, or when the plate dir is gone; `Ctx.Keep`
      hook runs it in-process for tests, the default spawns `nibble serve
      --keeper` detached with the socket as fd 3
- [x] 9.2 Red: a later `serve` without `--addr` announces the recorded
      address, the keeper is gone, and the new `serve` blocks there until
      round 2; with the keeper dead and the record stale, `serve` still
      starts; green: `.serve.json` {addr, token, printed} and the hand-over
- [x] 9.3 Red: seen rounds — a hand-written unanswered `review.json` with no
      record prints and exits 2 at once with the UI on; the round a previous
      `serve` ended with is served and waited on; green: the `printed`
      record; verify `ParsePlate` ignores `.serve.json` and the golden
      walker skips it
- [x] 9.4 Red: `TestKeeperProcess` builds the real binary (`go build` into a
      temp dir, skipped without `go`), runs `serve`, posts a round, and
      finds the address still answering after the process exited; green:
      the detached spawn with `Setsid` and the inherited fd
- [x] 9.5 Reader: the chat docks on the right — a rail that never hides
      (name, count, live marker), expanding on `c` or click; the top-bar
      toggle goes; the element badge sits off the node's corner; rebuild
      `app.js`, verify `npm test` and both bundle copies in `docs/visuals`
      (`cmp`), and read the dock collapsed and expanded in a browser
- [x] 9.6 Skill, README, guide: replies show live without a re-serve;
      `serve <plate>` reuses the address; the conversation transcript's
      re-serve drops `--addr`; verify `TestSkillConversationTranscript`
      and `TestSetupInstallsConversationSection` still pass

## 10. One nibble per page, the chat fixed

- [x] 10.1 Reader: the active card fills the canvas (no neighbour slivers,
      as the camera requirement already says), the chat is a fixed column
      with no rail or collapse, `c` focuses the composer; the guide and the
      legend say so; rebuild, `npm test`, demo copies in sync, and a
      browser check of a plate with and without a conversation

## Workflow follow-up

- Archive the change (`/opsx:archive`), mark **Review loop** done in
  `docs/roadmap.html`, then commit, push and open the PR, per CLAUDE.md.
