# nibble

**Agent explanations you can poke.**

Coding agents read and write code faster than anyone can follow. When one
finishes a change, debugs a bug or reviews a PR, it hands you a wall of prose
full of `file:line` references — and you either rebuild the picture in your
head, or type *looks good* and quietly give up your understanding of the
codebase.

nibble turns what an agent wants to tell you into an **interactive visual
model** of your code, served in small *nibbles*: one claim, one visual, the
evidence a click away. You scrub the timeline, toggle the fix, click a box to
see the lines behind it — and answer the agent right on the diagram.

> *nibble: so you can ruminate.*

## Status

**Design phase.** No code yet — the PRD and design mockups are done and the
initial product decisions are settled. Start here:

- **[docs/PRD.html](docs/PRD.html)** — the PRD, interactive (step the loop,
  turn the detail dial, filter requirements). Clone and open in a browser.
- **[docs/design/mockups.html](docs/design/mockups.html)** — design mockups
  with a live reader demo: scrub the cache-stampede timeline, flip the fix on.

## How it works

Your agent needs only a shell. It writes a *plate* — a folder of small JSON
files — through the `nibble` CLI, which validates every reference against the
real code and refuses what doesn't exist. Then it blocks on `nibble serve`
until you've read, poked and answered:

```sh
nibble new   --title "PR 1247 · ch 1: payments" --about pr:1247
nibble add   <plate> --caption "…" --visual timeline.json \
             --ref "src/cache/prices.ts:43-45 @cache"
nibble done  <plate>
nibble serve <plate>     # blocks until your review; its exit wakes the agent
```

Your comments come back pinned to the thing you disagreed with — a node, an
edge, a moment on a timeline, a line of code — with a trust level
(`exact` / `shifted` / `stale`) if the code moved underneath.

## Opinions

nibble is opinionated on purpose:

1. **Picture first, prose last.** Captions are one or two sentences, never a paragraph.
2. **Interactive, not animated.** Every visual has something to do: scrub, toggle, step, compare.
3. **One canvas per plate.** Nibbles move a camera across one shared map, not a slideshow.
4. **Code is evidence, on demand.** Click anything to open the validated lines behind it.
5. **Small by default.** Budgets that scale with the task; exceeding them requires a reason, printed on the plate.
6. **Detail is a dial.** Overview / standard / deep — layers on the same canvas, never a longer document.
7. **Review covers the diff *and its shadow*.** The PR map shows changed code, its unvisited dependents, and a ledger of what the plate didn't show you.

## Components

| Component | What it is | Stage |
| --- | --- | --- |
| `cli/` | Single static Go binary: all commands, validation, fingerprints, the local server | v0.1 |
| `reader/` | TypeScript SPA: canvas, visual kinds, detail dial, code drawer — pure presentation | v0.1 |
| `skill/` | What `nibble setup` installs into Claude Code / Codex / Cursor | v0.1 |
| `protocol/` | Plate format, visual JSON Schemas, trust rules, golden files | v0.1 |
| `pill/` | Thin Tauri shell: menu-bar icon + floating pill for waiting plates | v1 |
| editor panel | VS Code / Cursor webview around the same reader | later |

## Prior art

[deck](https://github.com/henit-chobisa/deck) got the agent-side mechanics
right, and nibble keeps them with credit: the agent writes through a shell CLI,
refs are validated at write time, and a blocking command returns your review.
The bet nibble changes is the medium — an explorable model you manipulate,
instead of a guided walk through code.

## License

Not chosen yet.
