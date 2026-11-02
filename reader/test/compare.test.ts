// Compare: metric alignment across sides, content-kind detection, and the
// anchored-ref join for ref sides.

t("compare metric rows align across sides by name", () => {
  const rows = cmpMetricRows(
    { label: "today", content: { metrics: [{ name: "p99", value: 4.2, unit: "s" }, { name: "receipts delayed", value: 0, unit: "min" }] } },
    { label: "with queue", content: { metrics: [{ name: "p99", value: 0.26, unit: "s" }, { name: "retries", value: 1 }] } },
  );
  eq(rows.map((r) => r.name), ["p99", "receipts delayed", "retries"], "union keeps before order first");
  eq(rows[0].before?.value, 4.2, "p99 before");
  eq(rows[0].after?.value, 0.26, "p99 after");
  eq(rows[1].after, undefined, "before-only metric");
  eq(rows[2].before, undefined, "after-only metric");
});

t("compare content kind is detected per side", () => {
  eq(cmpContentKind({ label: "l", content: { ref: "src/a.ts:1" } }), "ref");
  eq(cmpContentKind({ label: "l", content: { map: { kind: "map" } } }), "map");
  eq(cmpContentKind({ label: "l", content: { metrics: [{ name: "x", value: 1 }] } }), "metrics");
});

t("compare ref sides resolve through the side-id anchor", () => {
  const anchored = anchorRefIndex([{ anchor: "after" }, { anchor: "cache" }]);
  eq(anchored.get("after"), 0, "after side carries code");
  eq(anchored.get("before"), undefined, "before side has none");
});
