// Timeline: time parsing, the shared axis, state normalization and the
// weight scale.

function tlFixture(): TimelineVisual {
  return {
    kind: "timeline",
    title: "expiry stampede",
    lanes: [
      { id: "cache", label: "price cache" },
      { id: "db", label: "postgres" },
    ],
    states: [
      {
        name: "jitter-off",
        label: "jitter off",
        default: true,
        events: [
          { id: "warm", lane: "cache", at: "11:58:00", label: "41 keys cached" },
          { id: "stampede", lane: "db", at: "12:00:00", label: "41 misses", weight: 847 },
        ],
      },
      {
        name: "jitter-on",
        label: "jitter on",
        events: [
          { lane: "cache", at: "11:58:00", label: "keys cached ± 300s" },
          { lane: "db", at: "12:00:30", label: "spread out", weight: 75 },
        ],
      },
    ],
  };
}

t("timeline at parses offsets and clock times", () => {
  eq(tlParseAt(5), 5, "number passes through");
  eq(tlParseAt("12:00:01"), 12 * 3600 + 1, "HH:MM:SS");
  ok(tlParseAt("11:58:00") < tlParseAt("12:00:00"), "clock order");
});

t("timeline axis is the union of every state's events", () => {
  const a = tlAxis(tlFixture());
  eq(a.min, tlParseAt("11:58:00"), "min from both states");
  eq(a.max, tlParseAt("12:00:30"), "max comes from the non-default state");
});

t("timeline states normalize with the default first", () => {
  const states = tlStatesOf(tlFixture());
  eq(states.defaultIndex, 0, "declared default");
  const flipped = tlFixture();
  flipped.states![0].default = undefined as unknown as boolean;
  flipped.states![1].default = true;
  eq(tlStatesOf(flipped).defaultIndex, 1, "default elsewhere");
  const bare: TimelineVisual = {
    kind: "timeline",
    title: "no states",
    lanes: [{ id: "a", label: "A" }],
    events: [{ lane: "a", at: 1, label: "x" }],
  };
  const s = tlStatesOf(bare);
  eq(s.states.length, 1, "top-level events become the only state");
  eq(s.states[0].events.length, 1, "events carried over");
  eq(s.defaultIndex, 0, "it is the default");
});

t("timeline weight maps to a sqrt radius with a floor", () => {
  const r1 = tlWeightR(undefined, 100);
  const r4 = tlWeightR(4, 100);
  const r16 = tlWeightR(16, 100);
  const r100 = tlWeightR(100, 100);
  ok(r1 > 0, "floor radius");
  ok(r4 <= r16 && r16 < r100, "monotonic");
  ok(r100 - r16 > r16 - r4, "sqrt growth, not linear in weight");
});
