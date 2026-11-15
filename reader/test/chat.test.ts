// The chat's pure seams: threads from rounds, drafts, targets → cards and
// elements, badge counts, the turn's wording.

const chatRef = (): Ref => ({ ref: "src/a.ts:1-2", path: "src/a.ts", start: 1, end: 2, trust: { level: "exact", line: 1, shift: 0 } });

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
