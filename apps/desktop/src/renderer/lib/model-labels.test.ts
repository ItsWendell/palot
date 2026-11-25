import { describe, expect, it } from "vitest";
import { modelLabels, modelMakerIcon, shortModelName } from "./model-labels";

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
      short: "Sonnet 5",
      icon: "anthropic",
    });
    expect(labels.get("openai/gpt-6")).toEqual({
      name: "GPT-6",
      providerAmbiguous: false,
      short: "GPT-6",
      icon: "openai",
    });
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
  it.each([
    ["Claude Fable 5.2", "Fable 5.2"],
    ["Claude Opus 5.5", "Opus 5.5"],
    ["GPT-6.1 Sol", "6.1 Sol"],
    ["GPT-6 Luna", "6 Luna"],
    ["GPT-5.6 Cyber", "5.6 Cyber"],
    ["Gemini 4 Argon", "4 Argon"],
    ["Gemini 3.1 Pro High", "Gemini 3.1 Pro High"],
    ["Gemini 3 Flash", "Gemini 3 Flash"],
    ["Grok 4", "Grok 4"],
    ["DeepSeek V3", "DeepSeek V3"],
    ["GPT-6", "GPT-6"],
    ["Iceman Free", "Iceman Free"],
    ["claude-sonnet-4-5", "claude-sonnet-4-5"],
  ])("shortens %s to %s for the pill", (name, short) => {
    expect(shortModelName(name)).toBe(short);
    expect(modelLabels([model("acme", "id", name)]).get("acme/id")?.short).toBe(short);
  });

  it("keeps full names when two short names would match", () => {
    const labels = modelLabels([
      model("anthropic", "claude-opus-5-5", "Claude Opus 5.5"),
      model("opencode", "claude-opus-5-5", "Claude Opus 5.5"),
    ]);
    expect(labels.get("anthropic/claude-opus-5-5")?.short).toBe("Claude Opus 5.5");
    expect(labels.get("opencode/claude-opus-5-5")?.short).toBe("Claude Opus 5.5");
  });
  it.each([
    [model("opencode", "claude-opus-5-5", "Claude Opus 5.5"), "anthropic"],
    [model("github-copilot", "gpt-6.1", "GPT-6.1 Sol"), "openai"],
    [model("openrouter", "google/gemini-3-flash", "Gemini 3 Flash"), "google"],
    [model("acme", "claude-sonnet-4-5", "claude-sonnet-4-5"), "anthropic"],
    [model("openrouter", "anthropic/claude-sonnet-4-5", "Sonnet via router"), "anthropic"],
    [model("groq", "kimi-k3", "Kimi K3"), "groq"],
    [model("acme", "iceman", "Iceman Free"), null],
  ])("gives %o the maker icon %s", (value, icon) => {
    expect(modelMakerIcon(value)).toBe(icon);
  });
});
