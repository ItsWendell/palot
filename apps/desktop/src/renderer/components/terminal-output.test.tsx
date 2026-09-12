import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { terminalOutput } from "../lib/terminal-output";
import { TerminalOutput } from "./terminal-output";

describe("TerminalOutput", () => {
  it("renders plain and styled HTML-looking text literally without creating links", () => {
    const text = '<img src=x onerror="alert(1)"> &lt;b&gt; https://example.com';
    const result = render(<TerminalOutput {...terminalOutput(text)} />);
    expect(result.container.textContent).toBe(text);
    expect(result.container.children).toHaveLength(0);
    result.rerender(
      <TerminalOutput
        {...terminalOutput(
          `\u001b[31m${text}\u001b[0m\u001b]8;;https://example.com\u0007link\u001b]8;;\u0007`,
        )}
      />,
    );
    expect(result.container.textContent).toBe(`${text}link`);
    expect(result.container.querySelector("img, a, b")).toBeNull();
    expect(result.container.querySelector("span")?.style.color).toBe("rgb(187, 0, 0)");
    result.unmount();
  });

  it("applies decorations and colors as React styles, then resets them", () => {
    const result = render(
      <TerminalOutput
        {...terminalOutput("\u001b[38;2;10;20;30;48;5;196;1;2;3;4;9mstyled\u001b[0m plain")}
      />,
    );
    const spans = result.container.querySelectorAll("span");
    expect(spans[0]?.style.color).toBe("rgb(10, 20, 30)");
    expect(spans[0]?.style.backgroundColor).toBe("rgb(255, 0, 0)");
    expect(spans[0]?.style.fontWeight).toBe("700");
    expect(spans[0]?.style.opacity).toBe("0.65");
    expect(spans[0]?.style.fontStyle).toBe("italic");
    expect(spans[0]?.style.textDecoration).toBe("underline line-through");
    expect(spans[1]?.getAttribute("style")).toBeNull();
    result.rerender(<TerminalOutput {...terminalOutput(null)} />);
    expect(result.container.textContent).toBe("");
    result.unmount();
  });
});
