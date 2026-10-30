import { describe, expect, it } from "vitest";
import { modelLabels } from "./model-labels";

const model = (providerID: string, id: string, name: string) => ({ providerID, id, name });

describe("modelLabels", () => {
  it("keeps unique names, without (latest)", () => {
    const labels = modelLabels([
      model("anthropic", "claude-sonnet-5", "Claude Sonnet 5"),
      model("openai", "gpt-6", "GPT-6 (latest)"),
    ]);
    expect(labels.get("anthropic/claude-sonnet-5")).toEqual({
      name: "Claude Sonnet 5",
      providerAmbiguous: false,
    });
    expect(labels.get("openai/gpt-6")).toEqual({ name: "GPT-6", providerAmbiguous: false });
  });

  it("marks a name two providers share, so the provider is shown", () => {
    const labels = modelLabels([
      model("anthropic", "claude-sonnet-5", "Claude Sonnet 5"),
      model("opencode", "claude-sonnet-5", "Claude Sonnet 5"),
    ]);
    expect(labels.get("anthropic/claude-sonnet-5")?.providerAmbiguous).toBe(true);
    expect(labels.get("opencode/claude-sonnet-5")?.providerAmbiguous).toBe(true);
  });

  it("tells one provider's same-named models apart by the end of their IDs", () => {
    const labels = modelLabels([
      model("google", "gemini-4-argon", "Gemini 4"),
      model("google", "gemini-4-argon-eap", "Gemini 4"),
      model("acme", "v1", "Acme"),
      model("acme", "v2", "Acme"),
    ]);
    expect(labels.get("google/gemini-4-argon")?.name).toBe("Gemini 4");
    expect(labels.get("google/gemini-4-argon-eap")?.name).toBe("Gemini 4 (eap)");
    expect(labels.get("acme/v1")?.name).toBe("Acme (v1)");
    expect(labels.get("acme/v2")?.name).toBe("Acme (v2)");
  });
});
