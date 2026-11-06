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

// --- blast-radius ring layout ---

function ringFixture(): MapVisual {
  // 12 nodes — the budget — across all three rings, dependents grouped,
  // one standard-only dependent, edges crossing rings.
  const nodes: MapNode[] = [
    { id: "pool", label: "db/pool.ts", ring: "changed", focus: true },
    { id: "dbcfg", label: "database.yaml", ring: "changed" },
    { id: "orders", label: "orders-api", ring: "dependent", group: "callers" },
    { id: "billing", label: "billing worker", ring: "dependent", group: "callers" },
    { id: "retry", label: "retry helper", ring: "dependent", group: "callers", level: "standard" },
    { id: "pooltest", label: "pool.test.ts", ring: "dependent", group: "tests" },
    { id: "e2e", label: "checkout e2e", ring: "dependent", group: "tests" },
    { id: "chart", label: "helm chart", ring: "dependent", group: "configs" },
    { id: "auth", label: "auth-api", ring: "rest" },
    { id: "search", label: "search", ring: "rest" },
    { id: "docs", label: "runbook", ring: "rest" },
    { id: "metrics", label: "metrics", ring: "rest" },
  ];
  return {
    kind: "map",
    title: "blast radius",
    nodes: nodes as MapVisual["nodes"],
    edges: [
      { from: "orders", to: "pool", label: "getPool" },
      { from: "billing", to: "pool" },
      { from: "retry", to: "pool", level: "standard" },
      { from: "pooltest", to: "pool", style: "weak" },
      { from: "chart", to: "dbcfg", style: "weak" },
      { from: "pool", to: "dbcfg" },
      { from: "auth", to: "docs", style: "weak" },
    ],
  };
}

function zone(l: MapLayout, ring: string): RingZone {
  const z = l.zones?.find((x) => x.ring === ring);
  if (!z) throw new Error(`no ${ring} zone`);
  return z;
}

function inside(b: LaidOutNode, z: RingZone): boolean {
  return b.x >= z.x && b.y >= z.y && b.x + b.w <= z.x + z.w && b.y + b.h <= z.y + z.h;
}

function outside(b: LaidOutNode, z: RingZone): boolean {
  return b.x + b.w <= z.x || z.x + z.w <= b.x || b.y + b.h <= z.y || z.y + z.h <= b.y;
}

t("isRinged detects fully ringed maps only", () => {
  ok(isRinged(ringFixture()), "fully ringed");
  ok(!isRinged(mapFixture()), "unringed");
});

t("unringed maps still route to the tiered layout", () => {
  eq(mapLayoutOf(mapFixture()), layoutMap(mapFixture()), "same layout");
  ok(!mapLayoutOf(mapFixture()).zones, "no zones on a tiered map");
});

t("ring layout nests three named zones inside-out", () => {
  const l = layoutRingMap(ringFixture());
  eq(l.zones?.map((z) => z.ring).sort(), ["changed", "dependent", "rest"], "all three zones");
  const c = zone(l, "changed");
  const d = zone(l, "dependent");
  const r = zone(l, "rest");
  ok(c.x > d.x && c.y > d.y && c.x + c.w < d.x + d.w && c.y + c.h < d.y + d.h, "changed inside dependent");
  ok(d.x > r.x && d.y > r.y && d.x + d.w < r.x + r.w && d.y + d.h < r.y + r.h, "dependent inside rest");
});

t("every node sits in its ring's band", () => {
  const v = ringFixture();
  const l = layoutRingMap(v);
  const c = zone(l, "changed");
  const d = zone(l, "dependent");
  const r = zone(l, "rest");
  for (const n of v.nodes) {
    const b = box(l, n.id);
    if (n.ring === "changed") {
      ok(inside(b, c), `${n.id} in the changed zone`);
    } else if (n.ring === "dependent") {
      ok(inside(b, d) && outside(b, c), `${n.id} in the dependent band`);
    } else {
      ok(inside(b, r) && outside(b, d), `${n.id} in the rest band`);
    }
  }
});

t("ring layout keeps declaration order within a band", () => {
  const v = ringFixture();
  const l = layoutRingMap(v);
  const declared = (ring: string) => v.nodes.filter((n) => n.ring === ring).map((n) => n.id);
  const reading = (ids: string[]) =>
    ids
      .map((id) => ({ id, b: box(l, id) }))
      .sort((p, q) => p.b.y - q.b.y || p.b.x - q.b.x)
      .map((p) => p.id);
  for (const ring of ["changed", "dependent", "rest"]) {
    eq(reading(declared(ring)), declared(ring), `${ring} reading order`);
  }
});

t("ring layout nodes never overlap at the 12-node budget", () => {
  const l = layoutRingMap(ringFixture());
  for (const a of l.nodes) {
    for (const b of l.nodes) {
      if (a.id === b.id) continue;
      const apart =
        a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
      ok(apart, `${a.id} overlaps ${b.id}`);
    }
  }
});

t("ring layout is deterministic", () => {
  eq(layoutRingMap(ringFixture()), layoutRingMap(ringFixture()));
});

t("badges mark exactly the unvisited dependents", () => {
  const v = ringFixture();
  const deps = ["orders", "billing", "retry", "pooltest", "e2e", "chart"];
  eq(mapUnvisitedIds(v, new Set()), deps, "all dependents start unvisited");
  eq(
    mapUnvisitedIds(v, new Set(["orders", "pooltest"])),
    ["billing", "retry", "e2e", "chart"],
    "visited dependents lose the badge",
  );
  eq(
    mapUnvisitedIds(v, new Set(["pool", "auth", "docs"])),
    deps,
    "changed and rest ids never badge, visited or not",
  );
  eq(mapUnvisitedIds(mapFixture(), new Set()), [], "unringed maps badge nothing");
});

t("the unvisited count follows visits and reads done at zero", () => {
  const v = ringFixture();
  eq(unvisitedCounter(v, new Set()), "6 of 6 unvisited", "fresh");
  eq(unvisitedCounter(v, new Set(["orders", "billing", "retry"])), "3 of 6 unvisited", "half-way");
  eq(
    unvisitedCounter(v, new Set(["orders", "billing", "retry", "pooltest", "e2e", "chart"])),
    "all visited ✓",
    "done",
  );
  eq(unvisitedCounter(mapFixture(), new Set()), null, "no counter on an unringed map");
});

t("visiting re-badges in place: boxes never move", () => {
  const v = ringFixture();
  const before = layoutRingMap(v).nodes;
  // badge state is derived from the visited set alone; layout takes no part
  mapUnvisitedIds(v, new Set(["orders"]));
  eq(layoutRingMap(v).nodes, before, "layout unchanged by visits");
});

t("badge state is level-independent: a fresh render at any dial level badges the same ids", () => {
  const v = ringFixture();
  const visited = new Set(["billing"]);
  const unvisited = mapUnvisitedIds(v, visited);
  ok(unvisited.includes("retry"), "the standard-only dependent still counts");
  ok(!unvisited.includes("billing"), "visited stays visited across levels");
  // layout (hence badge anchoring) is computed from the full document at
  // every level, so the drawn subset never changes badge decisions
  const std = mapDrawnBoxes(v, "standard").map((b) => b.id);
  for (const id of unvisited) ok(std.includes(id), `${id} anchored at standard`);
});

t("the dial hides ringed nodes without moving the rest", () => {
  const v = ringFixture();
  const std = mapDrawnBoxes(v, "standard");
  const ovw = mapDrawnBoxes(v, "overview");
  ok(!ovw.some((b) => b.id === "retry"), "overview hides the standard-only dependent");
  for (const b of ovw) {
    eq(b, std.find((n) => n.id === b.id), `box ${b.id} moved between levels`);
  }
});
