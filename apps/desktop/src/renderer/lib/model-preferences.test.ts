import { describe, expect, it } from "vitest";
import type { PalotModel } from "../../shared";
import {
  applyModelPreference,
  modelPreferenceKey,
  reconcileModelOrder,
  reconcileModelPreference,
} from "./model-preferences";
import { resolveModelSelection } from "./model-selection";

const models = ["one", "two", "three"].map((id): PalotModel => ({
  id,
  modelID: id,
  providerID: "provider",
  name: id,
  family: null,
  variants: [],
  inputLimit: null,
  contextLimit: 100,
  outputLimit: 10,
  releasedAt: 0,
  capabilities: { tools: true, input: ["text"], output: ["text"] },
  status: "active",
}));

describe("model picker preferences", () => {
  it("keeps saved order, appends new catalog models, and filters hidden entries", () => {
    const preference = {
      order: ["provider/two", "missing/model", "provider/one"],
      hidden: ["provider/one"],
    };

    expect(reconcileModelOrder(models, preference)).toEqual([
      "provider/two",
      "provider/one",
      "provider/three",
    ]);
    expect(applyModelPreference(models, preference).map((model) => model.id)).toEqual([
      "two",
      "three",
    ]);
    expect(applyModelPreference(models, preference, true).map((model) => model.id)).toEqual([
      "two",
      "one",
      "three",
    ]);
  });

  it("applies only exact configured connection keys even with one matching brand", () => {
    const aliased = models.map((model) => ({
      ...model,
      providerID: "company-openai",
      canonicalProviderID: "openai",
    }));
    const preference = {
      order: ["openai/three", "company-openai/two"],
      hidden: ["openai/one", "company-openai/three"],
    };

    expect(reconcileModelOrder(aliased, preference)).toEqual([
      "company-openai/two",
      "company-openai/one",
      "company-openai/three",
    ]);
    expect(reconcileModelPreference(aliased, preference).hidden).toEqual([
      "openai/one",
      "company-openai/three",
    ]);
    expect(applyModelPreference(aliased, preference).map((model) => model.id)).toEqual([
      "two",
      "one",
    ]);
  });

  const connections = ["openai", "company-openai"].map((providerID): PalotModel => ({
    ...models[0]!,
    id: "gpt-5",
    modelID: "gpt-5",
    providerID,
    canonicalProviderID: "openai",
  }));

  it("lists and addresses each connection independently even with the same canonical model", () => {
    const listed = applyModelPreference(connections, undefined);
    expect(listed).toEqual(connections);
    const bySelection = new Map(listed.map((model) => [modelPreferenceKey(model), model]));
    expect(bySelection.get("openai/gpt-5")).toBe(connections[0]);
    expect(bySelection.get("company-openai/gpt-5")).toBe(connections[1]);
    expect(resolveModelSelection(listed, { providerID: "openai", id: "gpt-5" }, null).model).toBe(
      connections[0],
    );
    expect(
      resolveModelSelection(listed, { providerID: "company-openai", id: "gpt-5" }, null).model,
    ).toBe(connections[1]);
  });

  it.each(["openai", "company-openai"])("hides only the %s connection", (providerID) => {
    const preference = { order: [], hidden: [`${providerID}/gpt-5`] };
    expect(applyModelPreference(connections, preference)).toEqual(
      connections.filter((model) => model.providerID !== providerID),
    );
    expect(applyModelPreference(connections, preference, true)).toEqual(connections);
  });

  it("orders connections independently and never duplicates catalog or saved records", () => {
    const preference = {
      order: ["company-openai/gpt-5", "company-openai/gpt-5", "openai/gpt-5"],
      hidden: [],
    };
    expect(applyModelPreference([...connections, ...connections], preference)).toEqual([
      connections[1],
      connections[0],
    ]);
    expect(applyModelPreference([...connections, ...connections], undefined)).toEqual(connections);
  });

  it.each([1, 2])(
    "retains the missing direct connection while %i same-brand connections remain",
    (count) => {
      const direct = connections[0]!;
      const aliases = [
        connections[1]!,
        { ...connections[1]!, providerID: "personal-openai" },
      ].slice(0, count);
      const preference = { order: ["openai/gpt-5"], hidden: ["openai/gpt-5"] };
      expect(applyModelPreference([direct, ...aliases], preference)).toEqual(aliases);
      const partial = reconcileModelPreference(aliases, preference);
      expect(partial.hidden).toEqual(["openai/gpt-5"]);
      expect(partial.order).not.toContain("openai/gpt-5");
      expect(applyModelPreference(aliases, preference)).toEqual(aliases);
      const unrelated = models[0]!;
      const edited = { ...partial, hidden: [...partial.hidden, "provider/one"] };
      expect(applyModelPreference([direct, ...aliases, unrelated], edited)).toEqual(aliases);
    },
  );

  it("keeps hidden preferences through a partial catalog and later provider recovery", () => {
    const unavailable = connections[1]!;
    const available = models[0]!;
    const preference = { order: [], hidden: ["company-openai/gpt-5"] };
    const partial = reconcileModelPreference([available], preference);
    const edited = { ...partial, hidden: [...partial.hidden, "provider/one"] };

    expect(applyModelPreference([available, unavailable], edited)).toEqual([]);
    expect(applyModelPreference([available, unavailable], edited, true)).toEqual([
      available,
      unavailable,
    ]);
  });

  it("ignores absent order keys and deduplicates exact live keys", () => {
    const catalog = [connections[1]!, { ...connections[1]!, id: "gpt-4.1" }];
    const preference = {
      order: ["openai/gpt-5", "company-openai/gpt-4.1", "company-openai/gpt-4.1"],
      hidden: [],
    };
    expect(applyModelPreference(catalog, preference)).toEqual([catalog[1], catalog[0]]);
  });
});
