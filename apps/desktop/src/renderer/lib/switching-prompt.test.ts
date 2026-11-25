import { describe, expect, it } from "vitest";
import { SWITCHING_SOURCES, buildSwitchingPrompt, switchingTaskTitle } from "./switching-prompt";

describe("switching prompt", () => {
  it("names the agent and lists only that agent's hints", () => {
    const prompt = buildSwitchingPrompt({ source: "codex" });
    expect(prompt).toContain("from Codex.");
    expect(prompt).toContain("Where Codex usually keeps these");
    expect(prompt).toContain("~/.codex/config.toml");
    expect(prompt).not.toContain("~/.claude/settings.json");
    expect(prompt).not.toContain("~/.cursor/mcp.json");
  });

  it("gives every agent its own hints", () => {
    const prompts = SWITCHING_SOURCES.map(({ id }) => buildSwitchingPrompt({ source: id }));
    expect(new Set(prompts).size).toBe(SWITCHING_SOURCES.length);
    for (const source of SWITCHING_SOURCES) {
      const prompt = buildSwitchingPrompt({ source: source.id });
      for (const hint of source.hints) expect(prompt).toContain(hint);
    }
  });

  it("reads naturally for another agent", () => {
    const prompt = buildSwitchingPrompt({ source: "other" });
    expect(prompt).toContain("from another agent.");
    expect(prompt).toContain("Where agents usually keep these");
    expect(switchingTaskTitle("other")).toBe("Switch from another agent");
    expect(switchingTaskTitle("claude-code")).toBe("Switch from Claude Code");
  });

  it("scopes project-level changes to the chosen folder", () => {
    const inFolder = buildSwitchingPrompt({ source: "pi", directory: "/home/me/app" });
    expect(inFolder).toContain("This task runs in `/home/me/app`");
    const anywhere = buildSwitchingPrompt({ source: "pi" });
    expect(anywhere).not.toContain("This task runs in");
    expect(anywhere).toContain("Start with my user-level setup.");
  });

  it("surveys before proposing, waits for an OK, and keeps the safety rules", () => {
    const prompt = buildSwitchingPrompt({ source: "claude-code" });
    const order = [
      "Look first, change nothing",
      "Propose a plan and wait",
      "wait for my OK before changing anything",
      "back it up next to it with a timestamp",
      "Summarise",
      "how to undo it",
    ].map((text) => prompt.indexOf(text));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual(order.toSorted((a, b) => a - b));
    expect(prompt).toContain("{env:NAME}");
    expect(prompt).toContain("don't import transcripts");
  });
});
