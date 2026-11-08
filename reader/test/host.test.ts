// Host seam logic: joining data-anchor ids to nibble refs, and the
// selection → comment-target state machine.

t("anchored ids map to their ref index, first anchor wins", () => {
  const m = anchorRefIndex([
    { anchor: "cache" },
    {},
    { anchor: "db" },
    { anchor: "cache" },
  ]);
  eq(m.get("cache"), 0, "cache");
  eq(m.get("db"), 2, "db");
  ok(!m.has("undefined"), "unanchored refs contribute nothing");
  eq(m.size, 2, "size");
});

t("selecting an element, toggling it, moving to another", () => {
  let sel = nextSelection(null, 0, "cache");
  eq(sel, { card: 0, id: "cache" }, "select");
  sel = nextSelection(sel, 0, "db");
  eq(sel, { card: 0, id: "db" }, "move");
  sel = nextSelection(sel, 0, "db");
  eq(sel, null, "toggle clears");
  sel = nextSelection({ card: 0, id: "db" }, 2, "db");
  eq(sel, { card: 2, id: "db" }, "another card is a fresh selection");
});

t("comment target is n<N>:<id> only for a selection on the active card", () => {
  eq(commentTarget(2, { card: 1, id: "cache" }, 1), "n2:cache", "selected");
  eq(commentTarget(2, null, 1), "n2", "no selection");
  eq(commentTarget(2, { card: 0, id: "cache" }, 1), "n2", "other card's selection");
});

// --- visited dependents: per-session state the host owns ---

function visitedCtx(n: number): RenderCtx {
  const refs = [{ anchor: "caller-api" }];
  return { n, anchored: anchorRefIndex(refs), refs, visited: hostVisited };
}

t("selecting an element marks it visited, and clearing keeps it", () => {
  let sel = selectAndVisit(null, 0, "pricing-tests");
  eq(sel, { card: 0, id: "pricing-tests" }, "selected");
  sel = selectAndVisit(sel, 0, "pricing-tests"); // toggle clears the selection
  eq(sel, null, "selection cleared");
  ok(hostVisited.has("pricing-tests"), "stays visited after the selection clears");
});

t("opening an element's code marks it visited", () => {
  const ctx = visitedCtx(1);
  eq(openAndVisit(ctx, "caller-api"), { n: 1, ref: 0 }, "resolves the drawer ref");
  ok(hostVisited.has("caller-api"), "visited");
  eq(openAndVisit(ctx, "unanchored"), null, "no code, no activation");
  ok(!hostVisited.has("unanchored"), "an id without code is not visited by the chip path");
});

t("visited is one per-session set, shared across renders and nibbles", () => {
  markVisited("shared-dep");
  // two fresh render contexts, as after a dial redraw and on another nibble
  ok(visitedCtx(1).visited!.has("shared-dep"), "first render sees it");
  ok(visitedCtx(7).visited!.has("shared-dep"), "another nibble's render sees it");
  ok(!markVisited("shared-dep"), "marking again reports no change");
  ok(markVisited("fresh-dep"), "a new id reports a change");
});

t("the review POST body carries no visited information", () => {
  markVisited("looked-at");
  const body = reviewBody([{ target: "n2:cache", text: "nice" }]);
  eq(JSON.parse(body), { comments: [{ target: "n2:cache", text: "nice" }] }, "comments only");
  ok(!body.includes("visited"), "no visited key anywhere");
  eq(JSON.parse(reviewBody([])), { comments: [] }, "no comments means done");
});

t("the drawer's highlighter is per-language: one line, two readings", () => {
  const line = "return price // hot path";
  const go = highlightLines("internal/pool.go", [line])[0];
  const py = highlightLines("internal/pool.py", [line])[0];
  ok(go !== py, "a .go path and a .py path highlight the same line differently");
  ok(go.includes("hljs-comment"), "go reads // as a comment: " + go);
  ok(!py.includes("hljs-comment"), "python does not: " + py);
  eq(highlightLines("x.go", [""])[0], " ", "empty line keeps its height");
});
