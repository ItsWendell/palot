import { describe, expect, it } from "vitest";
import { terminalOutput } from "./terminal-output";

describe("terminalOutput", () => {
  it("preserves plain log text and converts carriage returns to newlines", () => {
    expect(terminalOutput(null)).toEqual({ output: null, terminal: null });
    expect(terminalOutput("")).toEqual({ output: "", terminal: null });
    expect(terminalOutput("one\rtwo\r\nthree")).toEqual({
      output: "one\ntwo\nthree",
      terminal: null,
    });
  });

  it.each(["\u001b[", "\u009b"])("hides every partial CSI in cumulative output (%s)", (csi) => {
    const sequence = `${csi}38;2;10;20;30m`;
    for (let length = 1; length <= sequence.length; length += 1) {
      expect(terminalOutput(`ready ${sequence.slice(0, length)}`).output).toBe("ready ");
    }
    expect(terminalOutput(`ready ${sequence}next${csi}0m`)).toEqual({
      output: "ready next",
      terminal: [{ text: "ready " }, { text: "next", color: "rgb(10, 20, 30)" }],
    });
  });

  it.each(["\u0007", "\u001b\\", "\u009c"])("strips OSC metadata with %j terminators", (end) => {
    expect(terminalOutput(`before\u001b]0;window title${end}after`).output).toBe("beforeafter");
    expect(terminalOutput(`\u009d8;;https://example.com${end}link\u009d8;;${end}`).output).toBe(
      "link",
    );
  });

  it("hides an incomplete OSC including a split string terminator", () => {
    const sequence = "\u001b]8;;https://example.com\u001b\\";
    for (let length = 1; length <= sequence.length; length += 1) {
      expect(terminalOutput(`ready ${sequence.slice(0, length)}`).output).toBe("ready ");
    }
    expect(terminalOutput(`ready ${sequence}label\u001b]8;;\u0007`).output).toBe("ready label");
  });

  it("retains extended colors, all supported decorations, and resets", () => {
    expect(terminalOutput("\u001b[38;5;196;48;2;10;20;30;1;2;3;4;9mstyled\u001b[0m plain")).toEqual(
      {
        output: "styled plain",
        terminal: [
          {
            text: "styled",
            color: "rgb(255, 0, 0)",
            backgroundColor: "rgb(10, 20, 30)",
            bold: true,
            dim: true,
            italic: true,
            underline: true,
            strikethrough: true,
          },
          { text: " plain" },
        ],
      },
    );
  });

  it("projects a log rather than executing cursor commands", () => {
    expect(terminalOutput("one\u001b[2J\u001b[H\rtwo").output).toBe("one\ntwo");
  });

  it("keeps a full command buffer styled but bounds huge output and dense runs", () => {
    expect(terminalOutput(`\u001b[31m${"x".repeat(256 * 1024 - 5)}`).terminal).not.toBeNull();
    const huge = "x".repeat(300_000);
    expect(terminalOutput(`\u001b[31m${huge}\u001b]title`).output).toBe(huge);
    expect(terminalOutput(`\u001b[31m${huge}`).terminal).toBeNull();
    expect(terminalOutput("\u001b[31mx\u001b[0my".repeat(3000))).toEqual({
      output: "xy".repeat(3000),
      terminal: null,
    });
  });
});
