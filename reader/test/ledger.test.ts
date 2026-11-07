// The ledger card's pure seam: grouping, labels, comment targets, card count.

const lh = (over: Partial<LedgerHunkData> = {}): LedgerHunkData => ({
  path: "src/b.ts", side: "head", start: 4, end: 9, added: 5, removed: 2, ...over,
});

t("groupLedgerHunks groups by file preserving order and ledger indexes", () => {
  const hunks = [
    lh({ path: "src/b.ts", start: 4, end: 9 }),
    lh({ path: "src/c.ts", start: 1, end: 2 }),
    lh({ path: "src/b.ts", start: 30, end: 31 }),
  ];
  const groups = groupLedgerHunks(hunks);
  eq(groups.map((g) => g.path), ["src/b.ts", "src/c.ts"], "file order");
  eq(groups[0].rows.map((r) => r.i), [0, 2], "indexes into the ledger");
  eq(groups[1].rows.map((r) => r.i), [1]);
  eq(groups[0].rows[1].hunk.start, 30);
});

t("hunkId is the path and range, single-line hunks drop the end", () => {
  eq(hunkId(lh()), "src/b.ts:4-9");
  eq(hunkId(lh({ start: 7, end: 7 })), "src/b.ts:7");
});

t("ledgerHunkLabel says side, lines and counts; binary is named", () => {
  eq(ledgerHunkLabel(lh()), "head 4–9 · +5 −2");
  eq(ledgerHunkLabel(lh({ side: "base", start: 20, end: 22, added: 0, removed: 3 })), "base 20–22 · +0 −3");
  eq(ledgerHunkLabel(lh({ start: 7, end: 7, added: 1, removed: 0 })), "head 7 · +1 −0");
  eq(ledgerHunkLabel(lh({ binary: true, added: 0, removed: 0 })), "head · binary");
});

t("ledgerCommentTarget: the card as a whole, or one hunk by its id", () => {
  eq(ledgerCommentTarget(null, 3), "ledger");
  eq(ledgerCommentTarget({ card: 3, id: "src/b.ts:4-9" }, 3), "ledger:src/b.ts:4-9");
  eq(ledgerCommentTarget({ card: 3, id: "src/b.ts:7" }, 3), "ledger:src/b.ts:7");
  // a selection on some other card does not retarget the ledger
  eq(ledgerCommentTarget({ card: 1, id: "cache" }, 3), "ledger");
});

t("nibble comment targets are untouched by the ledger card", () => {
  eq(commentTarget(2, { card: 1, id: "s4" }, 1), "n2:s4");
  eq(commentTarget(2, null, 1), "n2");
});

t("cardCount adds one card only when a ledger is present", () => {
  eq(cardCount(3, { shown: 1, total: 3, hunks: [lh()] }), 4);
  eq(cardCount(3, { shown: 3, total: 3, hunks: [] }), 4, "empty ledger still gets its card");
  eq(cardCount(3, null), 3);
  eq(cardCount(3, undefined), 3);
});

t("ledgerFullyCovered reads shown of total", () => {
  ok(ledgerFullyCovered({ shown: 6, total: 6, hunks: [] }), "6 of 6");
  ok(!ledgerFullyCovered({ shown: 4, total: 6, hunks: [lh(), lh()] }), "4 of 6");
  ok(ledgerFullyCovered({ shown: 0, total: 0, hunks: [] }), "an empty diff was fully shown");
});
