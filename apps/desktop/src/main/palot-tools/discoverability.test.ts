// @vitest-environment node
import { describe, expect, it } from "vitest";
import { discoveryCases, distractorCatalog, palotCatalog } from "../../../test/tool-eval/catalog";
import { rank } from "../../../test/tool-eval/rank";

describe("Code Mode discoverability with a crowded MCP catalog", () => {
  const catalog = [...palotCatalog(), ...distractorCatalog];
  // The lexical ranker keeps stop words. Natural prompts need a 20-result search;
  // verb-specific settling must also remain on the first page (tested below).
  it.each(discoveryCases)("%s finds %s in the top 20", (query, expected) => {
    const results = rank(catalog, query)
      .slice(0, 20)
      .map((tool) => tool.path);
    expect(results).toContain(`palot.${expected}`);
  });
  it("keeps settling discoverable by name, not incidental description matches", () => {
    const results = rank(catalog, "settle this session")
      .slice(0, 3)
      .map((tool) => tool.path);
    expect(results).toContain("palot.settle_task");
  });
});
