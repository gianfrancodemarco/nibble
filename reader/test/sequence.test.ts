// Sequence: step-state machine and lifeline layout.

function seqFixture(): SequenceVisual {
  return {
    kind: "sequence",
    title: "one checkout request",
    actors: [
      { id: "client", label: "browser" },
      { id: "api", label: "checkout-api" },
      { id: "cache", label: "price cache" },
      { id: "db", label: "postgres" },
    ],
    steps: [
      { id: "s1", from: "client", to: "api", label: "POST /checkout", kind: "call" },
      { id: "s2", from: "api", to: "cache", label: "getPrice(sku)", kind: "call" },
      { id: "s3", from: "cache", to: "db", label: "SELECT price", kind: "call", alt: "on miss" },
      { id: "s4", from: "db", to: "cache", label: "row", kind: "return" },
      { id: "s5", from: "api", to: "client", label: "200, total", kind: "return" },
    ],
  };
}

t("sequence stepping reveals one step at a time and clamps", () => {
  const total = 5;
  let shown = 0;
  shown = seqAdvance(shown, 1, total);
  shown = seqAdvance(shown, 1, total);
  eq(shown, 2, "two advances show two steps");
  shown = seqAdvance(shown, -1, total);
  eq(shown, 1, "step back");
  eq(seqAdvance(0, -1, total), 0, "clamped at the start");
  eq(seqAdvance(total, 1, total), total, "clamped at the end");
});

t("sequence actors are columns in declaration order", () => {
  const l = layoutSequence(seqFixture());
  const xs = l.actors.map((a) => a.x);
  eq(
    l.actors.map((a) => a.id),
    ["client", "api", "cache", "db"],
    "order",
  );
  ok(xs[0] < xs[1] && xs[1] < xs[2] && xs[2] < xs[3], "left to right");
});

t("sequence steps stack top to bottom in declared order", () => {
  const l = layoutSequence(seqFixture());
  for (let i = 1; i < l.steps.length; i++) {
    ok(l.steps[i].y > l.steps[i - 1].y, `step ${i} below step ${i - 1}`);
  }
  eq(l.steps.length, 5, "all steps laid out");
});
