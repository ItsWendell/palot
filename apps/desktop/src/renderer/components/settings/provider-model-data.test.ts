import { describe, expect, it } from "vitest";
import type { PalotConfigSource, PalotIntegration, PalotModel } from "../../../shared";
import {
  configuredDefaultModel,
  connectedProviderEntries,
  formatModelCost,
  moveToProviderTop,
  providerPolicy,
} from "./provider-model-data";

function source(patch: Partial<PalotConfigSource>): PalotConfigSource {
  return {
    type: "document",
    path: null,
    summary: null,
    formatters: [],
    languageServers: [],
    permissions: [],
    ...patch,
  };
}

const model: PalotModel = {
  id: "m",
  modelID: "m",
  providerID: "p",
  name: "M",
  family: null,
  variants: [],
  inputLimit: null,
  contextLimit: 1000,
  outputLimit: 100,
  releasedAt: 0,
  capabilities: { tools: false, input: ["text"], output: ["text"] },
  status: "active",
};

describe("provider policy", () => {
  it("lets user-global config outrank project config, last matching statement first", () => {
    const sources = [
      source({
        path: "/home/me/.config/opencode/opencode.json",
        providerPolicies: [
          { resource: "*", effect: "deny" },
          { resource: "open*", effect: "allow" },
        ],
      }),
      source({
        path: "/repo/opencode.json",
        providerPolicies: [{ resource: "openai", effect: "deny" }],
      }),
    ];
    expect(providerPolicy(sources, "openai")).toEqual({
      resource: "open*",
      effect: "allow",
      path: "/home/me/.config/opencode/opencode.json",
    });
    expect(providerPolicy(sources, "anthropic")?.effect).toBe("deny");
    expect(providerPolicy([source({})], "openai")).toBeNull();
  });
});

describe("connected provider entries", () => {
  const integration = (patch: Partial<PalotIntegration>): PalotIntegration => ({
    id: "x",
    name: "X",
    methods: [],
    connections: [],
    ...patch,
  });

  it("derives the source from the active connection, config, or a plugin", () => {
    const entries = connectedProviderEntries({
      integrations: [
        integration({
          id: "openai",
          name: "OpenAI",
          connections: [
            { type: "credential", id: "c1", label: "Work", active: true, method: "oauth" },
            { type: "env", id: null, label: "OPENAI_API_KEY", active: false },
          ],
        }),
        integration({
          id: "groq",
          name: "Groq",
          connections: [{ type: "env", id: null, label: "GROQ_API_KEY", active: true }],
        }),
        integration({ id: "local", name: "Local" }),
        integration({ id: "unused", name: "Unused" }),
      ],
      providers: [
        provider("openai"),
        provider("groq"),
        provider("local"),
        provider("zen", { integrationID: "opencode" }),
        provider("orphan"),
      ],
      configSources: [source({ providerIDs: ["local"] })],
    });
    expect(entries.map((entry) => [entry.id, entry.source])).toEqual([
      ["openai", "account"],
      ["groq", "env"],
      ["local", "config"],
      ["orphan", "integration"],
      ["zen", "integration"],
    ]);
  });

  it("keeps a connected provider that a deny policy removed from the catalog", () => {
    const [entry] = connectedProviderEntries({
      integrations: [
        integration({
          id: "openrouter",
          name: "OpenRouter",
          connections: [{ type: "credential", id: "c", label: "Key", active: true, method: "key" }],
        }),
      ],
      providers: [],
      configSources: [
        source({
          path: "/repo/opencode.json",
          providerPolicies: [{ resource: "openrouter", effect: "deny" }],
        }),
      ],
    });
    expect(entry).toMatchObject({
      source: "api-key",
      blocked: { resource: "openrouter", path: "/repo/opencode.json" },
    });
  });
});

describe("model presentation", () => {
  it("formats the base price, free models, tiers, and unknown prices", () => {
    expect(
      formatModelCost({
        ...model,
        cost: [
          { contextOver: null, input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
          { contextOver: 200_000, input: 6, output: 22.5, cacheRead: 0.6, cacheWrite: 7.5 },
        ],
      }),
    ).toEqual({ label: "$3 in · $15 out per M", note: "tiered above 200K tokens" });
    expect(
      formatModelCost({
        ...model,
        cost: [{ contextOver: null, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }],
      }),
    ).toEqual({ label: "Free", note: null });
    expect(
      formatModelCost({
        ...model,
        cost: [{ contextOver: null, input: 0.075, output: 0.3, cacheRead: 0, cacheWrite: 0 }],
      })?.label,
    ).toBe("$0.075 in · $0.30 out per M");
    expect(formatModelCost({ ...model, cost: [] })).toBeNull();
  });

  it("moves a model to its provider's first slot without moving other providers", () => {
    const order = ["a/1", "b/1", "a/2", "b/2", "a/3"];
    expect(moveToProviderTop(order, "a/3", "a")).toEqual(["a/3", "a/1", "b/1", "a/2", "b/2"]);
    expect(moveToProviderTop(order, "b/2", "b")).toEqual(["a/1", "b/2", "b/1", "a/2", "a/3"]);
    expect(moveToProviderTop(order, "a/1", "a")).toEqual(order);
  });

  it("reads OpenCode's default model from the latest config document that sets one", () => {
    expect(
      configuredDefaultModel([
        source({ path: "/global.json", summary: { model: "openai/gpt-5" } }),
        source({ path: "/repo/opencode.json", summary: { model: "anthropic/claude-sonnet" } }),
        source({ path: "/repo/.opencode/opencode.json", summary: {} }),
      ]),
    ).toEqual({
      value: "anthropic/claude-sonnet",
      providerID: "anthropic",
      modelID: "claude-sonnet",
      path: "/repo/opencode.json",
    });
    expect(configuredDefaultModel([source({ summary: {} })])).toBeNull();
  });
});

function provider(id: string, patch: { integrationID?: string } = {}) {
  return {
    id,
    name: id,
    integrationID: patch.integrationID ?? null,
    package: "",
    disabled: false,
  };
}
