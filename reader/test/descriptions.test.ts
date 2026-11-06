// Levelled descriptions: which variant the dial shows.

t("descriptionAt picks the variant for the dial level", () => {
  const both = { overview: "the skim", standard: "the full story" };
  eq(descriptionAt(both, "overview"), "the skim");
  eq(descriptionAt(both, "standard"), "the full story");
});

t("descriptionAt falls back downward only", () => {
  const skimOnly = { overview: "the skim" };
  eq(descriptionAt(skimOnly, "standard"), "the skim", "standard falls back to overview");
  eq(descriptionAt(skimOnly, "overview"), "the skim");
});

t("descriptionAt is null when there is nothing to show", () => {
  eq(descriptionAt(undefined, "overview"), null);
  eq(descriptionAt(undefined, "standard"), null);
});
