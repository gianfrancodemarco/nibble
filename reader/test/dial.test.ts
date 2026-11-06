// The detail dial: pure level filtering per kind, and selection survival.

function dialMapFixture(): MapVisual {
  return {
    kind: "map",
    title: "why checkout slows down",
    nodes: [
      { id: "api", label: "checkout-api", tier: "service" },
      { id: "cache", label: "price cache", tier: "data", focus: true },
      { id: "warmer", label: "cache warmer", tier: "service", level: "standard" },
    ] as MapVisual["nodes"],
    edges: [
      { from: "api", to: "cache", label: "getPrice" },
      { from: "warmer", to: "cache", label: "refresh", level: "standard" },
    ],
  };
}

function dialSeqFixture(): SequenceVisual {
  return {
    kind: "sequence",
    title: "one getPrice call",
    actors: [
      { id: "api", label: "api" },
      { id: "cache", label: "cache" },
    ] as SequenceVisual["actors"],
    steps: [
      { from: "api", to: "cache", label: "getPrice" },
      { id: "s2", from: "cache", to: "cache", label: "store", level: "standard" },
      { from: "cache", to: "api", label: "price" },
      { id: "s4", from: "cache", to: "api", label: "metrics", level: "standard" },
      { from: "api", to: "cache", label: "retry" },
    ] as SequenceVisual["steps"],
  };
}

function dialTlFixture(): TimelineVisual {
  return {
    kind: "timeline",
    title: "the hourly spike",
    lanes: [
      { id: "req", label: "requests" },
      { id: "gc", label: "cache expiry", level: "standard" },
    ] as TimelineVisual["lanes"],
    events: [
      { id: "spike", lane: "req", at: 10, label: "p99 4.2s" },
      { id: "expiry", lane: "gc", at: 0, label: "keys expire", level: "standard" },
      { id: "calm", lane: "req", at: 20, label: "back to 80ms", level: "standard" },
    ],
  };
}

t("dial defaults to standard and toggles", () => {
  eq(DIAL_DEFAULT, "standard");
  eq(dialToggle("standard"), "overview");
  eq(dialToggle("overview"), "standard");
});

t("map overview hides standard-only elements without moving the rest", () => {
  const v = dialMapFixture();
  const std = mapDrawnBoxes(v, "standard");
  const ovw = mapDrawnBoxes(v, "overview");
  eq(std.map((n) => n.id).sort(), ["api", "cache", "warmer"], "standard draws all");
  eq(ovw.map((n) => n.id).sort(), ["api", "cache"], "overview hides warmer");
  for (const b of ovw) {
    const full = std.find((n) => n.id === b.id);
    eq(b, full, `box ${b.id} moved between levels`);
  }
  eq(mapDrawnEdgeIdx(v, "standard"), [0, 1], "standard draws both edges");
  eq(mapDrawnEdgeIdx(v, "overview"), [0], "overview hides the standard edge");
});

t("sequence stepping visits only drawn steps at overview", () => {
  const v = dialSeqFixture();
  eq(seqDrawnSteps(v, "standard"), [0, 1, 2, 3, 4]);
  eq(seqDrawnSteps(v, "overview"), [0, 2, 4]);
  // advancing over the drawn subset clamps at its length, not the full total
  const drawn = seqDrawnSteps(v, "overview");
  let shown = 0;
  const visited: number[] = [];
  for (let i = 0; i < 9; i++) {
    shown = seqAdvance(shown, 1, drawn.length);
    visited.push(drawn[shown - 1]);
  }
  eq(shown, 3, "clamps at the drawn count");
  eq(visited.slice(0, 3), [0, 2, 4], "visits overview steps in order");
});

t("timeline drawn events honour event and lane levels", () => {
  const v = dialTlFixture();
  const std = tlDrawnEvents(v, v.events ?? [], "standard").map((e) => e.id);
  const ovw = tlDrawnEvents(v, v.events ?? [], "overview").map((e) => e.id);
  eq(std, ["spike", "expiry", "calm"]);
  eq(ovw, ["spike"], "hides the standard event and the standard lane's event");
});

t("timeline lanes filter by level", () => {
  const v = dialTlFixture();
  eq(tlDrawnLanes(v, "standard").map((l) => l.id), ["req", "gc"]);
  eq(tlDrawnLanes(v, "overview").map((l) => l.id), ["req"]);
});

t("anchorDrawnAt knows which ids survive the dial", () => {
  const m = dialMapFixture();
  ok(anchorDrawnAt(m, "cache", "overview"), "overview node drawn at overview");
  ok(!anchorDrawnAt(m, "warmer", "overview"), "standard node hidden at overview");
  ok(anchorDrawnAt(m, "warmer", "standard"), "standard node drawn at standard");
  const s = dialSeqFixture();
  ok(anchorDrawnAt(s, "api", "overview"), "actors always drawn");
  ok(!anchorDrawnAt(s, "s2", "overview"), "standard step hidden at overview");
  const tl = dialTlFixture();
  ok(!anchorDrawnAt(tl, "gc", "overview"), "standard lane hidden at overview");
  ok(!anchorDrawnAt(tl, "calm", "overview"), "standard event hidden at overview");
  ok(anchorDrawnAt(tl, "spike", "overview"), "overview event drawn");
});

t("two dial turns round-trip, dropping selections the overview hides", () => {
  // the shell's d-key handler: toggle, then re-derive the selection
  const m = dialMapFixture();
  const visualOf = (c: number) => (c === 0 ? m : null);
  let level = DIAL_DEFAULT;
  let sel: VisualSelection | null = { card: 0, id: "warmer" };
  level = dialToggle(level);
  sel = selectionAfterDial(sel, visualOf, level);
  eq(level, "overview");
  eq(sel, null, "hidden selection cleared on the way down");
  level = dialToggle(level);
  sel = selectionAfterDial(sel, visualOf, level);
  eq(level, "standard", "second press returns to standard");
  eq(sel, null, "a cleared selection stays cleared");
  // a selection the overview keeps survives both turns
  let kept: VisualSelection | null = { card: 0, id: "api" };
  kept = selectionAfterDial(kept, visualOf, dialToggle("standard"));
  eq(kept, { card: 0, id: "api" });
});

t("selection survives the dial only while its element is drawn", () => {
  const m = dialMapFixture();
  const sel = { card: 0, id: "warmer" };
  eq(selectionAfterDial(sel, (c) => (c === 0 ? m : null), "overview"), null, "hidden element clears");
  eq(selectionAfterDial(sel, (c) => (c === 0 ? m : null), "standard"), sel, "drawn element persists");
  const kept = { card: 0, id: "cache" };
  eq(selectionAfterDial(kept, (c) => (c === 0 ? m : null), "overview"), kept);
  // a cleared selection falls back to the plain nibble target
  eq(commentTarget(3, null, 0), "n3");
});
