// The chat's pure seams: threads from rounds, drafts, targets → cards and
// elements, badge counts, the turn's wording.

const chatRef = (): Ref => ({ ref: "src/a.ts:1-2", path: "src/a.ts", start: 1, end: 2, at: "src/a.ts", trust: { level: "exact", line: 1, shift: 0 } });

const twoRounds: ThreadData = {
  turn: "agent",
  rounds: [
    { n: 1, comments: [
      { id: "1.1", target: "n2:s4", text: "enqueue can fail?", reply: { text: "retried 3×", refs: [chatRef()] } },
      { id: "1.2", target: "ledger:src/x.ts", text: "why skipped?", reply: { text: "a comment tweak", refs: [] } },
    ] },
    { n: 2, comments: [
      { id: "2.1", thread: "1.1", target: "n2:s4", text: "and the client?", reply: null },
      { id: "2.2", target: "n1", text: "new one", reply: null },
    ] },
  ],
};

t("buildThreads: one thread per opener, messages interleaved round by round", () => {
  const ths = buildThreads(twoRounds, []);
  eq(ths.length, 3, "three openers");
  eq(ths[0].key, "1.1", "keyed by the opener");
  eq(ths[0].target, "n2:s4", "the opener's target");
  eq(ths[0].messages.map((m) => m.from), ["reader", "agent", "reader"], "opener, reply, follow-up");
  eq(ths[0].messages[1].at, { round: 1, comment: 1 }, "the reply knows where its refs resolve");
  eq(ths[0].messages[2].id, "2.1", "the follow-up's id");
  ok(ths[0].awaiting, "the follow-up has no reply and it is the agent's turn");
  ok(!ths[1].awaiting, "the ledger thread is answered");
  eq(ths[2].key, "2.2", "a round-2 opener is its own thread");
});

t("buildThreads: awaiting only on the agent's turn", () => {
  const ths = buildThreads({ ...twoRounds, turn: "reader" }, []);
  ok(!ths[0].awaiting, "reader's turn: nothing awaited");
});

t("buildThreads: drafts continue a thread or open a new one, grouped by target", () => {
  const drafts: Draft[] = [
    { key: 1, thread: "1.2", text: "still skipped?" },
    { key: 2, target: "n3", text: "fresh" },
    { key: 3, target: "n3", text: "fresh again" },
    { key: 4, text: "untargeted" },
  ];
  const ths = buildThreads(twoRounds, drafts);
  eq(ths.length, 5, "two new threads: n3 and untargeted");
  const ledger = ths[1];
  eq(ledger.messages[ledger.messages.length - 1], { from: "draft", text: "still skipped?", draftKey: 1 }, "follow-up draft at the end of its thread");
  eq(ths[3].id, null, "a draft-only thread has no id yet");
  eq(ths[3].target, "n3", "grouped by target");
  eq(ths[3].messages.length, 2, "both n3 drafts in one thread");
  eq(ths[4].target, "", "untargeted draft");
  eq(buildThreads(null, drafts).length, 3, "no thread yet: the follow-up, n3 and the untargeted draft each group alone");
});

t("sentThreadOn finds the sent thread a target already has", () => {
  const ths = buildThreads(twoRounds, [{ key: 1, target: "n3", text: "x" }]);
  eq(sentThreadOn(ths, "n2:s4"), "1.1", "sent");
  eq(sentThreadOn(ths, "n3"), null, "draft-only thread is not sent");
  eq(sentThreadOn(ths, "n9"), null, "none");
});

t("draftComments: follow-ups carry thread and no target, openers carry target", () => {
  eq(draftComments([
    { key: 1, thread: "1.2", text: "a" },
    { key: 2, target: "n3", text: "b" },
    { key: 3, text: "c" },
  ]), [{ thread: "1.2", text: "a" }, { target: "n3", text: "b" }, { text: "c" }], "shape");
  eq(JSON.parse(reviewBody(draftComments([]))), { comments: [] }, "no drafts is done");
});

t("cardOfTarget maps targets to cards", () => {
  eq(cardOfTarget("n2:s4", 3, false), 1, "element on nibble 2");
  eq(cardOfTarget("n3", 3, false), 2, "whole nibble");
  eq(cardOfTarget("ledger:src/a.ts", 3, true), 3, "ledger card after the nibbles");
  eq(cardOfTarget("ledger", 3, false), null, "no ledger card");
  eq(cardOfTarget(undefined, 3, false), 0, "untargeted → first card");
  eq(cardOfTarget("n9", 3, false), null, "nibble the plate lacks");
  eq(cardOfTarget("plate", 3, false), null, "unknown target");
});

t("anchorOfTarget pulls the element id", () => {
  eq(anchorOfTarget("n2:s4"), "s4", "element");
  eq(anchorOfTarget("n2"), null, "whole nibble");
  eq(anchorOfTarget("ledger:src/a.ts#base"), "src/a.ts#base", "ledger row");
  eq(anchorOfTarget("ledger"), null, "whole ledger");
  eq(anchorOfTarget(undefined), null, "untargeted");
});

t("badgeCounts counts messages per card and per element", () => {
  const ths = buildThreads(twoRounds, [{ key: 1, thread: "1.1", text: "d" }]);
  const b = badgeCounts(ths, 3, true);
  eq(b.cards.get(1), 4, "nibble 2: opener, reply, follow-up, draft");
  eq(b.elements.get("1:s4"), 4, "the s4 element");
  eq(b.keys.get("1:s4"), "1.1", "badge opens thread 1.1");
  eq(b.cards.get(3), 2, "ledger card: opener and reply");
  eq(b.elements.get("3:src/x.ts"), 2, "ledger row");
  eq(b.cards.get(0), 1, "nibble 1: the round-2 opener");
  ok(!b.elements.has("0:"), "a whole-card target badges no element");
});

t("turnLabel words whose move it is", () => {
  eq(turnLabel(null, false).locked, false, "fresh plate is open");
  const agent = turnLabel(twoRounds, false);
  ok(agent.locked && agent.text.includes("0 of 2") && !agent.text.includes("round"), agent.text);
  ok(turnLabel(twoRounds, true).text.startsWith("sent"), "just sent");
  const reader = turnLabel({ ...twoRounds, turn: "reader" }, false);
  ok(!reader.locked && reader.text.startsWith("your turn") && !reader.text.includes("round"), reader.text);
  const done = turnLabel({ turn: "reader", rounds: [{ n: 3, comments: [] }] }, false);
  ok(!done.locked && done.text.includes("write again"), done.text);
});

t("sendLabel: plain send, or send plus the held drafts", () => {
  eq(sendLabel(0), "Send", "none held");
  eq(sendLabel(1), "Send +1", "one held");
  eq(sendLabel(3), "Send +3", "three held");
});

// --- line comments: threads on lines, drafts on a drawer selection ---

const lineRefData = (): Ref => ({ ref: "src/a.ts:16-18", path: "src/a.ts", start: 16, end: 18, at: "src/a.ts", trust: { level: "exact", line: 16, shift: 0 } });

const lineRounds: ThreadData = {
  turn: "reader",
  rounds: [
    { n: 1, comments: [
      { id: "1.1", target: "n2:s4", ref: lineRefData(), text: "this swallows the error", reply: { text: "fixed", refs: [] } },
      { id: "1.2", target: "n2:s4", text: "the whole arrow", reply: { text: "ok", refs: [] } },
    ] },
    { n: 2, comments: [
      { id: "2.1", thread: "1.1", target: "n2:s4", ref: lineRefData(), text: "still?", reply: null },
    ] },
  ],
};

t("buildThreads carries the opener's ref and keys drafts by target and lines", () => {
  const ths = buildThreads(lineRounds, [
    { key: 1, target: "n2:s4", ref: "src/a.ts:30-31", text: "other lines" },
    { key: 2, target: "n2:s4", text: "the arrow again" },
  ]);
  eq(ths.length, 4, "two sent threads, two new ones");
  eq(ths[0].ref?.ref, "src/a.ts:16-18", "the opener's ref");
  eq(ths[0].lines, "src/a.ts:16-18", "the thread's lines");
  eq(ths[0].messages.length, 3, "opener, reply, follow-up");
  eq(ths[1].ref, undefined, "a target thread has no ref");
  eq(ths[2].key, "new:n2:s4|src/a.ts:30-31", "draft on other lines opens its own thread");
  eq(ths[2].lines, "src/a.ts:30-31", "draft lines");
  eq(ths[3].key, "new:n2:s4|", "draft on the target alone");
});

t("sentThreadOn matches target and lines together", () => {
  const ths = buildThreads(lineRounds, []);
  eq(sentThreadOn(ths, "n2:s4", "src/a.ts:16-18"), "1.1", "same lines continue the thread");
  eq(sentThreadOn(ths, "n2:s4", "src/a.ts:30-31"), null, "other lines do not");
  eq(sentThreadOn(ths, "n2:s4"), "1.2", "no lines: the target thread");
  eq(sentThreadOn(ths, "n2:s4", undefined), "1.2", "undefined is no lines");
});

t("draftComments carries the ref the reader built", () => {
  eq(draftComments([{ key: 1, target: "n2:s4", ref: "src/a.ts:16-18", text: "x" }]),
    [{ target: "n2:s4", ref: { ref: "src/a.ts:16-18" }, text: "x" }], "shape");
});

t("linesLabel reads path and range out of a ref string", () => {
  eq(linesLabel("src/a.ts:16-18"), "src/a.ts:16-18", "plain");
  eq(linesLabel("diff:src/a.ts@worktree:4"), "src/a.ts:4", "worktree");
  eq(linesLabel("diff:src/b.ts@abc..def#base:10-12"), "src/b.ts:10-12", "range side");
});

t("destinationLabel names the lines and the target", () => {
  eq(destinationLabel("new", "n2:s4", "src/a.ts:16-18"), "new thread on src/a.ts:16-18 in n2:s4", "new on lines");
  eq(destinationLabel("new", "n2:s4"), "new thread on n2:s4", "new on the target");
  eq(destinationLabel("reply", "n2:s4", "src/a.ts:16-18"), "reply in n2:s4 · src/a.ts:16-18", "reply on lines");
  eq(destinationLabel("new", ""), "new thread on plate", "untargeted");
});

t("lineRef builds the ref the server verifies", () => {
  eq(lineRef("src/a.ts", { start: 16, end: 18 }), "src/a.ts:16-18", "range");
  eq(lineRef("diff:src/b.ts@abc..def#base", { start: 10, end: 10 }), "diff:src/b.ts@abc..def#base:10", "one line");
});

t("selectLine: click, shift-click, click again", () => {
  eq(selectLine(null, 16, false), { start: 16, end: 16 }, "click selects");
  eq(selectLine({ start: 16, end: 16 }, 18, true), { start: 16, end: 18 }, "shift extends down");
  eq(selectLine({ start: 16, end: 18 }, 14, true), { start: 14, end: 18 }, "shift extends up");
  eq(selectLine({ start: 16, end: 18 }, 20, false), { start: 20, end: 20 }, "plain click moves");
  eq(selectLine({ start: 16, end: 16 }, 16, false), null, "clicking the only selected line clears");
  eq(selectLine({ start: 16, end: 18 }, 16, false), { start: 16, end: 16 }, "clicking inside a range narrows to it");
});

t("drawerBadges marks a thread's first shown line, where trust resolved it", () => {
  const shifted = buildThreads({
    turn: "reader",
    rounds: [{ n: 1, comments: [
      { id: "1.1", target: "n2:s4", ref: { ...lineRefData(), trust: { level: "shifted", line: 18, shift: 2 } }, text: "a", reply: { text: "b", refs: [] } },
      { id: "1.2", target: "n2", ref: { ref: "src/other.ts:1-3", path: "src/other.ts", start: 1, end: 3, at: "src/other.ts", trust: { level: "exact", line: 1, shift: 0 } }, text: "c", reply: null },
      { id: "1.3", target: "n2:s4", ref: { ...lineRefData(), ref: "src/a.ts:12-30", start: 12, end: 30 }, text: "d", reply: null },
    ] }],
  }, []);
  const shown = [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22];
  const b = drawerBadges(shifted, "src/a.ts", shown);
  eq(b.get(18), { count: 2, key: "1.1" }, "shifted +2: badge at 18");
  eq(b.get(12), { count: 1, key: "1.3" }, "wide range: its first shown line");
  eq(b.get(16), undefined, "the original range is not marked");
  eq(b.size, 2, "the other file's thread stays out");
  const partial = drawerBadges(shifted, "src/a.ts", [25, 26]);
  eq(partial.get(25), { count: 1, key: "1.3" }, "a range starting before the shown lines badges the first shown one");
  eq(partial.size, 1, "a range outside the shown lines is skipped");
  const merged = drawerBadges(shifted, "src/a.ts", [20, 21]);
  eq(merged.get(20), { count: 3, key: "1.1" }, "two threads meeting one line sum (2 + 1), the first thread's key wins");
});

t("composerLock: nothing to write on until the first card lands", () => {
  const open = { text: "write on anything, then send", locked: false };
  const none = composerLock(0, open);
  ok(none.locked && none.text.includes("first nibble"), none.text);
  eq(composerLock(1, open), open, "with a card the turn decides");
  const agent = { text: "the agent is answering · 0 of 1", locked: true };
  eq(composerLock(3, agent), agent, "a locked turn stays locked");
});

t("railSegments: numbered, the active one marked, read ones distinct, message counts as badges", () => {
  const cards = [{ label: "1", name: "nibble 1" }, { label: "2", name: "nibble 2" }, { label: "3", name: "nibble 3" }, { label: "≡", name: "not-shown ledger" }];
  const counts = new Map<number, number>([[1, 4], [3, 2]]);
  const segs = railSegments(cards, 1, new Set([0, 1]), counts);
  eq(segs.map((s) => s.label), ["1", "2", "3", "≡"], "labels");
  eq(segs.map((s) => s.state), ["read", "on", "", ""], "the active card is on, the visited one read, the rest ahead");
  eq(segs.map((s) => s.badge), [0, 4, 0, 2], "badges carry the card's message count");
  eq(segs[1].title, "nibble 2 · 4 messages", "the title names the card and its messages");
  eq(segs[3].title, "not-shown ledger · 2 messages", "the ledger card too");
  eq(segs[0].title, "nibble 1", "no messages, no suffix");
  eq(railSegments(cards, 0, new Set(), new Map([[0, 1]]))[0].title, "nibble 1 · 1 message", "singular");
  eq(railSegments([], 0, new Set(), new Map()), [], "an empty strip has no segments");
});
