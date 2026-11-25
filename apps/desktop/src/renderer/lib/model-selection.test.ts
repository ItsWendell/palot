import { describe, expect, it } from "vitest";
import type { PalotModel } from "../../shared";
import { resolveModelSelection, textGenerationModel } from "./model-selection";

const defaultModel: PalotModel = {
  id: "default-model",
  modelID: "default-model",
  providerID: "provider-a",
  name: "Default model",
  family: null,
  variants: [],
  inputLimit: null,
  contextLimit: 100_000,
  outputLimit: 10_000,
  releasedAt: 0,
  capabilities: { tools: true, input: ["text"], output: ["text"] },
  status: "active",
};
const sessionModel: PalotModel = {
  ...defaultModel,
  id: "session-model",
  modelID: "session-model",
  name: "Session model",
};

describe("resolveModelSelection", () => {
  it("uses an explicit session model before the project default", () => {
    const selection = resolveModelSelection(
      [defaultModel, sessionModel],
      { id: sessionModel.id, providerID: sessionModel.providerID, variant: "high" },
      defaultModel,
    );

    expect(selection.model).toBe(sessionModel);
    expect(selection.ref?.variant).toBe("high");
    expect(selection.usesDefault).toBe(false);
  });

  it("shows the location default when the session has no explicit model", () => {
    const selection = resolveModelSelection([defaultModel], null, defaultModel);

    expect(selection.model).toBe(defaultModel);
    expect(selection.ref).toEqual({ id: "default-model", providerID: "provider-a" });
    expect(selection.usesDefault).toBe(true);
  });

  it("keeps the model unselected when OpenCode has no available default", () => {
    expect(resolveModelSelection([], null, null)).toEqual({
      ref: null,
      model: null,
      usesDefault: false,
    });
  });
});

describe("textGenerationModel", () => {
  const catalog = { models: [defaultModel, sessionModel], defaultModel };

  it("uses the task's model when it has one", () => {
    const model = { id: "picked", providerID: "provider-b", variant: "high" };
    expect(
      textGenerationModel({
        sessionModel: model,
        projectDefault: { id: sessionModel.id, providerID: sessionModel.providerID },
        catalog,
      }),
    ).toBe(model);
  });

  it("falls back to the project default set in Palot while it is still available", () => {
    expect(
      textGenerationModel({
        sessionModel: null,
        projectDefault: { id: sessionModel.id, providerID: sessionModel.providerID },
        catalog,
      }),
    ).toEqual({ id: sessionModel.id, providerID: sessionModel.providerID });
  });

  it("uses OpenCode's default for the location when the project default is gone", () => {
    expect(
      textGenerationModel({
        sessionModel: null,
        projectDefault: { id: "removed", providerID: "provider-a" },
        catalog,
      }),
    ).toEqual({ id: defaultModel.id, providerID: defaultModel.providerID });
  });

  it("leaves the choice to OpenCode only when nothing is known", () => {
    expect(
      textGenerationModel({ sessionModel: null, projectDefault: undefined, catalog: null }),
    ).toBeNull();
    expect(
      textGenerationModel({
        sessionModel: null,
        projectDefault: undefined,
        catalog: { models: [], defaultModel: null },
      }),
    ).toBeNull();
  });
});
