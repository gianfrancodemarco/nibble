// Compile-time check that `npm run gen` ran and the schemas round-tripped:
// the generated Visual union must cover the four protocol-v1 kinds and
// narrow by `kind`.

t("generated Visual union covers the four v1 kinds", () => {
  const kinds: Array<Visual["kind"]> = ["map", "sequence", "timeline", "compare"];
  eq(kinds.length, 4);
});

t("Visual narrows by kind", () => {
  const v: Visual = {
    kind: "map",
    title: "t",
    nodes: [{ id: "a", label: "A" }],
    edges: [{ from: "a", to: "a" }],
  };
  if (v.kind === "map") eq(v.nodes[0].id, "a");
  else throw new Error("did not narrow to map");
});
