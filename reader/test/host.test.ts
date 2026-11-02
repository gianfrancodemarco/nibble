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
