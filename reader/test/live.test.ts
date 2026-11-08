// Live reading: the pure seams behind streaming — the progress label, the
// append-or-rebuild decision on a reload, and latest-wins reload tokens.

t("progressLabel: an open plate is counted and marked live", () => {
  eq(progressLabel(true, 2, 0), { text: "2 nibbles · still being written", live: true });
  eq(progressLabel(true, 1, 0), { text: "1 nibble · still being written", live: true }, "singular");
  eq(progressLabel(true, 0, 0), { text: "0 nibbles · still being written", live: true }, "empty strip");
});

t("progressLabel: a sealed plate says so, without the pulse", () => {
  eq(progressLabel(false, 3, 3), { text: "3 of 3 · sealed", live: false });
});

// Real nibbles from the explain-stampede golden plate (trimmed refs — the
// plan compares the JSON verbatim, whatever it holds).
const liveN1 = {
  title: "One `getPrice` call touches three things; the **cache** is where the trouble starts.",
  visual: {
    kind: "map",
    title: "What a getPrice call touches",
    nodes: [
      { id: "checkout", label: "checkout-api", tier: "service" },
      { id: "cache", label: "price cache", tier: "data", focus: true },
      { id: "db", label: "postgres", tier: "data" },
    ],
    edges: [{ from: "checkout", to: "cache", label: "getPrice" }, { from: "cache", to: "db", label: "miss" }],
  },
};
const liveN2 = {
  title: "Every cached price expires **on the hour**, so every miss hits Postgres in the same second.",
  visual: {
    kind: "timeline",
    title: "Every key expires on the hour",
    lanes: [{ id: "cache", label: "price cache" }, { id: "db", label: "postgres" }],
    events: [{ id: "expiry", lane: "cache", at: "12:00:00", label: "41 keys expire together" }],
  },
};
const liveN3 = {
  title: "Jittering the TTL spreads the expiries over ten minutes.",
  visual: { kind: "compare", title: "flat vs jittered TTL", before: { label: "flat" }, after: { label: "jittered" } },
};

t("arrivalPlan: growth and the seal append; nothing changed is none", () => {
  const open2 = plateShape([liveN1, liveN2], true, false, false);
  const open3 = plateShape([liveN1, liveN2, liveN3], true, false, false);
  eq(arrivalPlan(open2, open3), "append", "a nibble arrives");
  eq(arrivalPlan(open2, open2), "none", "identical reload");
  const sealed = plateShape([liveN1, liveN2, liveN3], false, false, true);
  eq(arrivalPlan(open3, sealed), "append", "seal brings the ledger card");
  const sealedNoLedger = plateShape([liveN1, liveN2, liveN3], false, false, false);
  eq(arrivalPlan(open3, sealedNoLedger), "append", "seal without a ledger still updates progress");
  eq(arrivalPlan(null, open2), "rebuild", "first paint");
});

t("latestWins: an older reload may not render after a newer one resolved", () => {
  const loads = latestWins();
  const older = loads.begin();
  const newer = loads.begin();
  ok(loads.isCurrent(newer), "the newest token renders");
  ok(!loads.isCurrent(older), "the stale token does not");
  const again = loads.begin();
  ok(loads.isCurrent(again), "a fresh token renders again");
});

t("arrivalPlan: a rewrite, a shrink or a review rebuilds", () => {
  const open2 = plateShape([liveN1, liveN2], true, false, false);
  const rewritten = plateShape([liveN1, { ...liveN2, title: "rewritten" }, liveN3], true, false, false);
  eq(arrivalPlan(open2, rewritten), "rebuild", "n2 rewritten mid-stream");
  eq(arrivalPlan(open2, plateShape([liveN1], true, false, false)), "rebuild", "shrinking reload");
  eq(arrivalPlan(open2, plateShape([liveN1, liveN2], true, true, false)), "rebuild", "review landed");
  const sealed = plateShape([liveN1, liveN2], false, false, true);
  eq(arrivalPlan(sealed, plateShape([liveN1, liveN2], false, false, false)), "rebuild", "ledger vanished");
  eq(arrivalPlan(sealed, plateShape([liveN1, liveN2, liveN3], false, false, true)), "rebuild",
    "growth after the ledger card would mis-index an append");
});
