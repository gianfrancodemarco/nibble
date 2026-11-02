// Map layout: pure geometry computed from the declarative document.

function mapFixture(): MapVisual {
  // 12 nodes — the protocol budget — across tiers, with a group and a focus.
  const nodes: MapNode[] = [
    { id: "cdn", label: "cdn", tier: "edge" },
    { id: "lb", label: "load balancer", tier: "edge" },
    { id: "api", label: "checkout-api", tier: "service", focus: true },
    { id: "auth", label: "auth", tier: "service", group: "platform" },
    { id: "rate", label: "rate limiter", tier: "service" },
    { id: "flags", label: "feature flags", tier: "service", group: "platform" },
    { id: "worker", label: "worker" },
    { id: "cache", label: "price cache", tier: "data" },
    { id: "db", label: "postgres", tier: "data" },
    { id: "queue", label: "queue", tier: "data" },
    { id: "blob", label: "blob store", tier: "data" },
    { id: "metrics", label: "metrics", tier: "data" },
  ];
  return {
    kind: "map",
    title: "twelve nodes",
    nodes: nodes as MapVisual["nodes"],
    edges: [
      { from: "cdn", to: "lb" },
      { from: "lb", to: "api", style: "flow" },
      { from: "api", to: "cache", style: "miss" },
      { from: "cache", to: "db" },
      { from: "api", to: "queue", style: "weak" },
    ],
  };
}

function box(l: MapLayout, id: string): LaidOutNode {
  const b = l.nodes.find((n) => n.id === id);
  if (!b) throw new Error(`no laid out node ${id}`);
  return b;
}

t("map tiers become columns, untiered nodes sit in the middle", () => {
  const l = layoutMap(mapFixture());
  ok(box(l, "cdn").x < box(l, "api").x, "edge left of service");
  ok(box(l, "api").x < box(l, "db").x, "service left of data");
  eq(box(l, "worker").x, box(l, "api").x, "untiered shares the service column");
});

t("map layout is deterministic", () => {
  const a = layoutMap(mapFixture());
  const b = layoutMap(mapFixture());
  eq(a, b);
});

t("map group members are vertically adjacent", () => {
  const l = layoutMap(mapFixture());
  const col = l.nodes
    .filter((n) => n.x === box(l, "auth").x)
    .sort((p, q) => p.y - q.y)
    .map((n) => n.id);
  const i = col.indexOf("auth");
  const j = col.indexOf("flags");
  eq(Math.abs(i - j), 1, `platform group split up in column ${col.join(",")}`);
});

t("map nodes never overlap at the 12-node budget", () => {
  const l = layoutMap(mapFixture());
  for (const a of l.nodes) {
    for (const b of l.nodes) {
      if (a.id === b.id) continue;
      const apart =
        a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
      ok(apart, `${a.id} overlaps ${b.id}`);
    }
  }
});
