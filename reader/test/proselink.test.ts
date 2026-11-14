// The prose ↔ visual handshake: which counterpart a hovered node lights,
// and the contract that a prose-link click takes the element-click path.

t("hoverCounterpart: a phrase lights its element, an element its phrases", () => {
  eq(hoverCounterpart("cache", null), `[data-anchor="cache"]`, "phrase → element");
  eq(hoverCounterpart(null, "cache"), `.plink[data-link-anchor="cache"]`, "element → phrases");
  eq(hoverCounterpart(null, null), null, "neither side lights nothing");
});

t("hoverCounterpart prefers the phrase when a node somehow carries both", () => {
  eq(hoverCounterpart("a", "b"), `[data-anchor="a"]`);
});

t("codeChipSelector finds the selected element's chip by its data-for tag", () => {
  eq(codeChipSelector("cache"), `[data-code][data-for="cache"]`);
  // ids share the ref-anchor charset, so the selector needs no escaping
  eq(codeChipSelector("resize_worker-2"), `[data-code][data-for="resize_worker-2"]`);
});

t("a prose-link click takes the element-click path: selection, visited, target", () => {
  // the wiring routes a .plink click through selectAndVisit, so the state
  // transitions must be exactly the element's
  let sel = selectAndVisit(null, 3, "pool");
  eq(sel, { card: 3, id: "pool" }, "selects the linked element");
  ok(hostVisited.has("pool"), "a linked phrase click counts as looking");
  eq(commentTarget(4, sel, 3), "n4:pool", "comment target follows");
  sel = selectAndVisit(sel, 3, "pool");
  eq(sel, null, "clicking the phrase again toggles the selection off");
});
