import { createStore } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PalotAgent, PalotModel } from "../../shared";
import {
  rememberSelection,
  resolveAgentModel,
  selectionMemoriesAtom,
  selectionScope,
} from "./selection-memory";

const model = { id: "model", providerID: "provider", variants: ["low", "high"] } as PalotModel;
const agent = {
  id: "build",
  model: { id: "model", providerID: "provider", variant: "low" },
} as PalotAgent;
const input = {
  agent: "build",
  agents: [agent],
  models: [model],
  projectDefault: null,
  catalogDefault: model,
};
beforeEach(() => window.localStorage.clear());

describe("selection memory", () => {
  it("falls back from an unavailable remembered model to the target agent's configuration", () => {
    const memory = rememberSelection(undefined, "build", {
      id: "removed",
      providerID: "provider",
      variant: "high",
    });
    expect(resolveAgentModel({ ...input, memory })).toEqual({
      id: "model",
      providerID: "provider",
      variant: "low",
    });
  });

  it("drops a removed variant instead of sending a stale reasoning choice", () => {
    const memory = rememberSelection(undefined, "build", {
      id: "model",
      providerID: "provider",
      variant: "retired",
    });
    expect(resolveAgentModel({ ...input, memory })).toEqual({
      id: "model",
      providerID: "provider",
    });
  });

  it("keeps explicit Auto instead of resurrecting a configured variant", () => {
    const memory = rememberSelection(undefined, "build", { id: "model", providerID: "provider" });
    expect(resolveAgentModel({ ...input, memory })).toEqual({
      id: "model",
      providerID: "provider",
    });
  });

  it("reloads successful selections from storage without mixing profiles or projects", async () => {
    const store = createStore();
    store.set(selectionMemoriesAtom, {
      [selectionScope("local", "repo")]: rememberSelection(undefined, "build", {
        id: "model",
        providerID: "provider",
        variant: "high",
      }),
      [selectionScope("remote", "repo")]: rememberSelection(undefined, "plan", {
        id: "other",
        providerID: "remote",
      }),
      [selectionScope("local", "another-repo")]: rememberSelection(undefined, "review"),
    });
    vi.resetModules();
    const reloaded = await import("./selection-memory");
    const saved = createStore().get(reloaded.selectionMemoriesAtom);
    expect(saved[selectionScope("local", "repo")]?.agent).toBe("build");
    expect(saved[selectionScope("remote", "repo")]?.agent).toBe("plan");
    expect(saved[selectionScope("local", "another-repo")]?.agent).toBe("review");
    expect(resolveAgentModel({ ...input, memory: saved[selectionScope("local", "repo")] })).toEqual(
      { id: "model", providerID: "provider", variant: "high" },
    );
  });
});
