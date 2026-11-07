// The ledger card's pure seam: grouping, labels, comment targets, card count.

const lh = (over: Partial<LedgerHunkData> = {}): LedgerHunkData => ({
  path: "src/b.ts", side: "head", start: 4, end: 9, added: 5, removed: 2, ...over,
});

t("ledgerFileRows groups by file and side, preserving order, sums and coverage", () => {
  const hunks = [
    lh({ path: "src/b.ts", start: 4, end: 9 }),
    lh({ path: "src/c.ts", start: 1, end: 2, covered: true }),
    lh({ path: "src/b.ts", start: 30, end: 31, added: 2, removed: 1, covered: true }),
    lh({ path: "src/b.ts", side: "base", start: 12, end: 14, added: 0, removed: 3 }),
  ];
  const rows = ledgerFileRows(hunks);
  eq(rows.map((r) => r.path), ["src/b.ts", "src/c.ts", "src/b.ts"], "file order, base split out");
  eq(rows.map((r) => r.side), ["head", "head", "base"]);
  eq(rows[0].hunks.length, 2, "both head hunks on one row");
  eq(rows[0].added, 7, "added summed");
  eq(rows[0].removed, 3, "removed summed");
  eq(rows.map((r) => r.coveredCount), [1, 1, 0], "covered hunks counted per row");
  eq(rows[2].hunks[0].start, 12);
});

t("ledgerBadge: shown when fully covered, a count when partly, none otherwise", () => {
  const full = ledgerFileRows([lh({ covered: true })])[0];
  const part = ledgerFileRows([lh({ covered: true }), lh({ start: 30, end: 31 }), lh({ start: 40, end: 41 })])[0];
  const none = ledgerFileRows([lh()])[0];
  eq(ledgerBadge(full), "shown");
  eq(ledgerBadge(part), "1/3 shown");
  eq(ledgerBadge(none), "");
});

t("ledgerTree nests rows by directory, collapsing single-child chains", () => {
  const rows = ledgerFileRows([
    lh({ path: "README.md", start: 1, end: 1 }),
    lh({ path: "src/cache/b.ts" }),
    lh({ path: "src/cache/c.ts", start: 1, end: 2 }),
    lh({ path: "docs/guide/deep/one.md", start: 1, end: 1 }),
  ]);
  const root = ledgerTree(rows);
  eq(root.files.map((f) => f.name), ["README.md"], "root files");
  eq(root.dirs.map((d) => d.name), ["src/cache", "docs/guide/deep"], "single-child chains collapse");
  eq(root.dirs[0].files.map((f) => f.name), ["b.ts", "c.ts"]);
  eq(root.dirs[0].files[0].row.path, "src/cache/b.ts", "the row keeps its full path");
  eq(root.dirs[1].files.map((f) => f.name), ["one.md"]);
});

t("fileRowId is the path, with #base for deleted-lines rows", () => {
  const rows = ledgerFileRows([lh(), lh({ side: "base", start: 12, end: 14 })]);
  eq(fileRowId(rows[0]), "src/b.ts");
  eq(fileRowId(rows[1]), "src/b.ts#base");
});

t("ledgerFileLabel says side, uncovered ranges and summed counts; binary named; long lists elided", () => {
  eq(ledgerFileLabel(ledgerFileRows([lh()])[0]), "head 4–9 · +5 −2");
  eq(ledgerFileLabel(ledgerFileRows([lh(), lh({ start: 30, end: 31, added: 2, removed: 1 })])[0]),
    "head 4–9, 30–31 · +7 −3");
  eq(ledgerFileLabel(ledgerFileRows([lh({ covered: true }), lh({ start: 30, end: 31, added: 2, removed: 1 })])[0]),
    "head 30–31 · +7 −3", "covered ranges stay out of the label");
  eq(ledgerFileLabel(ledgerFileRows([lh({ covered: true })])[0]),
    "head · +5 −2", "a fully covered row lists no ranges");
  eq(ledgerFileLabel(ledgerFileRows([lh({ side: "base", start: 20, end: 22, added: 0, removed: 3 })])[0]),
    "base 20–22 · +0 −3");
  eq(ledgerFileLabel(ledgerFileRows([lh({ start: 7, end: 7, added: 1, removed: 0 })])[0]),
    "head 7 · +1 −0");
  eq(ledgerFileLabel(ledgerFileRows([lh({ binary: true, added: 0, removed: 0 })])[0]), "head · binary");
  const many = ledgerFileRows([1, 11, 21, 31, 41].map((n) => lh({ start: n, end: n })))[0];
  eq(ledgerFileLabel(many), "head 1, 11, 21 +2 more · +25 −10");
});

t("ledgerCommentTarget: the card as a whole, or one file row by its id", () => {
  eq(ledgerCommentTarget(null, 3), "ledger");
  eq(ledgerCommentTarget({ card: 3, id: "src/b.ts" }, 3), "ledger:src/b.ts");
  eq(ledgerCommentTarget({ card: 3, id: "src/b.ts#base" }, 3), "ledger:src/b.ts#base");
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
  ok(ledgerFullyCovered({ shown: 6, total: 6, hunks: [lh({ covered: true })] }), "6 of 6");
  ok(!ledgerFullyCovered({ shown: 4, total: 6, hunks: [lh(), lh()] }), "4 of 6");
  ok(ledgerFullyCovered({ shown: 0, total: 0, hunks: [] }), "an empty diff was fully shown");
});
