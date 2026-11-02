// Anchors → drawer and selection → comment wiring, end to end on the pure
// side: activation resolves to the exact (n, ref index) the drawer needs,
// and pinning uses the selection's target.

function wiringCtx(): RenderCtx {
  const refs = [{ anchor: "cache", path: "src/cache/prices.ts" }, {}];
  return { n: 1, anchored: anchorRefIndex(refs), refs };
}

t("activating an anchored element yields the drawer's (n, ref)", () => {
  const ctx = wiringCtx();
  eq(codeActivation(ctx, "cache"), { n: 1, ref: 0 }, "anchored");
  eq(codeActivation(ctx, "db"), null, "unanchored carries no code");
});

t("pinning uses the selected element's target, then falls back", () => {
  let sel = nextSelection(null, 0, "cache");
  eq(commentTarget(1, sel, 0), "n1:cache", "selected on the active card");
  sel = nextSelection(sel, 0, "cache"); // toggle clears
  eq(commentTarget(1, sel, 0), "n1", "cleared selection falls back");
});
