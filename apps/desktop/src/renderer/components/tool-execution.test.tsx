import { Provider, createStore } from "jotai";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { JsonValue, PalotMessageContent } from "../../shared";
import { projectToolExecution, type ReadExecution } from "../lib/tool-executions";
import { MarkdownWorkspaceProvider } from "./markdown-content";
import {
  normalizeReadExecutions,
  ReadToolExecutionGroup,
  StandaloneShellExecution,
  ToolExecution,
} from "./tool-execution";

describe("ToolExecution", () => {
  it("shows Python separately from combined output and preserves the exact raw command", async () => {
    const code = "import json\nprint(json.dumps({'ok': True}))\n";
    const command = `python3 - <<'PY'\n${code}PY\nprintf 'validated\\n'`;
    const copy = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("palot", { writeClipboardText: copy });
    const result = render(
      <ToolExecution
        index={0}
        defaultOpen
        part={{
          type: "tool",
          id: "python-mixed",
          name: "shell",
          state: {
            status: "completed",
            input: { command },
            metadata: { exit: 0 },
            content: [{ type: "text", text: '\u001b[32m{"ok": true}\u001b[0m\nvalidated' }],
          },
        }}
      />,
    );
    expect(screen.getByRole("button", { name: /Ran shell commands with Python/ })).toBeTruthy();
    expect(screen.getByLabelText("Python script").textContent).toBe(code);
    expect(screen.getByLabelText("Shell commands").textContent).toContain("printf");
    expect(screen.getByText("Combined output")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Command output" }).textContent).toContain(
      '"ok": true',
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy Python script" }));
    await waitFor(() => expect(copy).toHaveBeenLastCalledWith(code));
    fireEvent.click(screen.getByRole("button", { name: "Raw command" }));
    expect(screen.getByRole("region", { name: "Raw command" }).textContent).toBe(command);
    expect(screen.queryByLabelText("Python script")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Copy raw command" }));
    await waitFor(() => expect(copy).toHaveBeenLastCalledWith(command));
    fireEvent.click(screen.getByRole("button", { name: "Show script" }));
    expect(screen.getByLabelText("Python script").textContent).toBe(code);
    vi.unstubAllGlobals();
    result.unmount();
  });

  it("falls back for incomplete Python input and projects it once the heredoc closes", () => {
    const part = (command: string): PalotMessageContent => ({
      type: "tool",
      id: "python-streaming",
      name: "shell",
      state: { status: "running", input: { command } },
    });
    const command = "python3 - <<'PY'\nprint(42)\n";
    const result = render(<ToolExecution index={0} defaultOpen part={part(command)} />);
    expect(screen.queryByLabelText("Python script")).toBeNull();
    expect(screen.getByRole("button", { name: "Copy command and output" })).toBeTruthy();
    result.rerender(<ToolExecution index={0} defaultOpen part={part(`${command}PY`)} />);
    expect(screen.getByRole("button", { name: /Running Python script/ })).toBeTruthy();
    expect(screen.getByLabelText("Python script").textContent).toBe("print(42)\n");
    result.unmount();
  });

  it("opens a generating patch and keeps it open when the tool settles", () => {
    const part = (status: string): PalotMessageContent => ({
      type: "tool",
      id: "live-patch",
      name: "patch",
      state: {
        status,
        input: { patchText: "*** Begin Patch\n*** Add File: example.ts\n+hello\n*** End Patch" },
      },
    });
    const result = render(<ToolExecution part={part("streaming")} index={0} />);
    expect(
      screen
        .getByRole("button", { name: /Generating patch for example.ts/ })
        .getAttribute("aria-expanded"),
    ).toBe("true");
    expect(screen.getByRole("region", { name: "Proposed changes for example.ts" })).toBeTruthy();

    result.rerender(<ToolExecution part={part("running")} index={0} />);
    expect(
      screen.getByRole("button", { name: /Patching example.ts/ }).getAttribute("aria-expanded"),
    ).toBe("true");
    result.rerender(<ToolExecution part={part("completed")} index={0} />);
    expect(
      screen.getByRole("button", { name: /Updated example.ts/ }).getAttribute("aria-expanded"),
    ).toBe("true");
    expect(screen.getByRole("region", { name: "Proposed changes for example.ts" })).toBeTruthy();
    result.unmount();
  });

  it("does not reopen a patch the user collapsed as more lines arrive", () => {
    const part = (text: string): PalotMessageContent => ({
      type: "tool",
      id: "collapsed-live-patch",
      name: "patch",
      state: { status: "streaming", input: { patchText: text } },
    });
    const first = "*** Begin Patch\n*** Add File: example.ts\n+first\n";
    const result = render(<ToolExecution part={part(first)} index={0} />);
    fireEvent.click(screen.getByRole("button", { name: /Generating patch for example.ts/ }));
    result.rerender(<ToolExecution part={part(`${first}+second\n`)} index={0} />);
    expect(
      screen
        .getByRole("button", { name: /Generating patch for example.ts/ })
        .getAttribute("aria-expanded"),
    ).toBe("false");
    result.unmount();
  });

  it("renders successful standalone shell results collapsed with compact metadata", () => {
    const result = render(
      <StandaloneShellExecution
        index={0}
        part={{
          type: "tool",
          id: "standalone-shell",
          name: "shell",
          time: { created: 1_000, completed: 2_500 },
          state: {
            status: "completed",
            input: { command: "rg TODO apps/desktop/src/renderer" },
            content: [{ type: "text", text: "All tests passed" }],
            metadata: { exit: 0, standalone: true, truncated: true },
          },
        }}
      />,
    );

    const trigger = screen.getByRole("button", {
      name: /Command completed rg TODO apps\/desktop\/src\/renderer exit 0 · output truncated/i,
    });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByLabelText("Command output")).toBeNull();
    result.unmount();
  });

  it("opens failed standalone shell results by default", () => {
    const result = render(
      <StandaloneShellExecution
        index={0}
        part={{
          type: "tool",
          id: "failed-standalone-shell",
          name: "shell",
          time: { created: 1_000, completed: 2_500 },
          state: {
            status: "error",
            input: { command: "bun test" },
            error: { message: "Tests failed" },
            metadata: { exit: 1, standalone: true },
          },
        }}
      />,
    );

    expect(
      screen
        .getByRole("button", { name: /Command failed bun test exit 1 Failed/i })
        .getAttribute("aria-expanded"),
    ).toBe("true");
    expect(screen.getByLabelText("Command output")).toBeTruthy();
    result.unmount();
  });

  it("uses the file-read icon for skill reads", () => {
    const result = render(
      <ToolExecution
        index={0}
        part={{
          type: "tool",
          id: "skill-read",
          name: "skill",
          state: { status: "completed", input: { id: "palot-design" } },
        }}
      />,
    );

    expect(result.container.querySelector(".lucide-file-search")).toBeTruthy();
    expect(result.container.querySelector(".lucide-brain-circuit")).toBeNull();
  });

  it("opens read and write targets without toggling their tool cards", () => {
    const openFile = vi.fn();
    const read: PalotMessageContent = {
      type: "tool",
      id: "read-target",
      name: "read",
      state: {
        status: "completed",
        input: { path: "src/read-target.ts", offset: 10, limit: 2 },
        content: [{ type: "text", text: "Read file src/read-target.ts, lines 10-11\n10: value" }],
      },
    };
    const write: PalotMessageContent = {
      type: "tool",
      id: "write-target",
      name: "write",
      state: {
        status: "completed",
        input: { path: "src/write-target.ts", content: "export {}" },
      },
    };
    const patch: PalotMessageContent = {
      type: "tool",
      id: "patch-target",
      name: "patch",
      state: {
        status: "completed",
        input: {
          patchText: [
            "*** Begin Patch",
            "*** Update File: src/patch-target.ts",
            "*** End Patch",
          ].join("\n"),
        },
      },
    };

    render(
      <MarkdownWorkspaceProvider onOpenFile={openFile}>
        <ToolExecution part={read} index={0} />
        <ToolExecution part={write} index={1} />
        <ToolExecution part={patch} index={2} />
      </MarkdownWorkspaceProvider>,
    );

    const readTarget = screen.getByRole("link", { name: "read-target.ts" });
    fireEvent.click(readTarget);
    expect(openFile).toHaveBeenNthCalledWith(1, { path: "src/read-target.ts", line: 10 });
    expect(
      screen.getByRole("button", { name: /Read read-target\.ts/ }).getAttribute("aria-expanded"),
    ).toBe("false");

    fireEvent.keyDown(screen.getByRole("link", { name: "write-target.ts" }), { key: "Enter" });
    expect(openFile).toHaveBeenNthCalledWith(2, { path: "src/write-target.ts" });

    fireEvent.click(screen.getByRole("link", { name: "patch-target.ts" }));
    expect(openFile).toHaveBeenNthCalledWith(3, { path: "src/patch-target.ts" });
  });

  it("shows the failure reason for a patch alongside its intended files", () => {
    const result = render(
      <ToolExecution
        index={0}
        part={{
          type: "tool",
          id: "patch-failed",
          name: "patch",
          state: {
            status: "error",
            input: {
              patchText: [
                "*** Begin Patch",
                "*** Update File: src/a.ts",
                "*** Update File: src/b.ts",
                "*** End Patch",
              ].join("\n"),
            },
            metadata: {},
            error: { message: "patch verification failed: expected lines were not found" },
          },
        }}
      />,
    );

    fireEvent.click(within(result.container).getByRole("button"));
    expect(
      screen.getByText("patch verification failed: expected lines were not found"),
    ).toBeTruthy();
    expect(screen.getByText("a.ts").getAttribute("title")).toBe("src/a.ts");
    expect(screen.getByText("b.ts").getAttribute("title")).toBe("src/b.ts");
    expect(within(result.container).getByText("src/a.ts")).toBeTruthy();
    expect(within(result.container).getByText("src/b.ts")).toBeTruthy();
    expect(within(result.container).getAllByText("No changed lines")).toHaveLength(2);
  });

  it("renders repeated ranges from the same file as one tool card", () => {
    const reads: PalotMessageContent[] = [
      {
        type: "tool",
        id: "read-second",
        name: "read",
        state: {
          status: "completed",
          input: { path: "src/a.ts", offset: 20, limit: 2 },
          content: [{ type: "text", text: "Read file src/a.ts, lines 20-21\n20: later\n21: end" }],
        },
      },
      {
        type: "tool",
        id: "read-first",
        name: "read",
        state: {
          status: "completed",
          input: { path: "src/a.ts", offset: 1, limit: 2 },
          content: [{ type: "text", text: "Read file src/a.ts, lines 1-2\n1: first\n2: second" }],
        },
      },
    ];

    render(
      <ReadToolExecutionGroup
        entries={reads.map((part, index) => ({ part, index }))}
        defaultOpen
      />,
    );

    expect(screen.getAllByRole("button", { name: /Read a.ts/ })).toHaveLength(1);
    expect(screen.getByText("1–2, 20–21")).toBeTruthy();
    expect(screen.getAllByText(/^Lines /).map((element) => element.textContent)).toEqual([
      "Lines 1–2",
      "Lines 20–21",
    ]);
  });

  it("merges overlapping read ranges and keeps the latest value for duplicate lines", () => {
    const reads: PalotMessageContent[] = [
      {
        type: "tool",
        id: "read-lower",
        name: "read",
        state: {
          status: "completed",
          input: { path: "src/a.ts", offset: 3, limit: 3 },
          content: [
            { type: "text", text: "Read file src/a.ts, lines 3-5\n3: stale\n4: fourth\n5: fifth" },
          ],
        },
      },
      {
        type: "tool",
        id: "read-upper",
        name: "read",
        state: {
          status: "completed",
          input: { path: "src/a.ts", offset: 1, limit: 3 },
          content: [
            { type: "text", text: "Read file src/a.ts, lines 1-3\n1: first\n2: second\n3: latest" },
          ],
        },
      },
    ];

    const result = render(
      <ReadToolExecutionGroup
        entries={reads.map((part, index) => ({ part, index }))}
        defaultOpen
      />,
    );
    const card = within(result.container);

    expect(card.getByText("1–5")).toBeTruthy();
    expect(card.getAllByText(/^Lines /).map((element) => element.textContent)).toEqual([
      "Lines 1–5",
    ]);
    const normalized = normalizeReadExecutions(
      reads.map((part, index) => projectToolExecution(part, index) as ReadExecution),
    );
    expect(normalized).toMatchObject([
      {
        range: { start: 1, end: 5 },
        lines: [
          { number: 1, text: "first" },
          { number: 2, text: "second" },
          { number: 3, text: "latest" },
          { number: 4, text: "fourth" },
          { number: 5, text: "fifth" },
        ],
      },
    ]);
  });

  it("preserves a single projected read's duration and disclosure", () => {
    const part: PalotMessageContent = {
      type: "tool",
      id: "read",
      name: "read",
      time: { created: 1_000, ran: 1_100, completed: 1_350 },
      state: {
        status: "completed",
        input: { path: "src/a.ts" },
        content: [{ type: "text", text: "Read file src/a.ts, lines 1-2\n1: first\n2: second" }],
      },
    };

    const result = render(<ReadToolExecutionGroup entries={[{ part, index: 0 }]} />);
    const card = within(result.container);

    const trigger = card.getByRole("button", {
      name: "Read a.ts lines 1–2 Completed in 250 ms",
    });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(card.getByLabelText("File contents for src/a.ts")).toBeTruthy();
  });

  it("sums the duration of merged read projections", () => {
    const reads: PalotMessageContent[] = [
      {
        type: "tool",
        id: "read-first",
        name: "read",
        time: { created: 1_000, completed: 1_100 },
        state: {
          status: "completed",
          input: { path: "src/a.ts", offset: 1, limit: 1 },
          content: [{ type: "text", text: "Read file src/a.ts, lines 1-1\n1: first" }],
        },
      },
      {
        type: "tool",
        id: "read-second",
        name: "read",
        time: { created: 1_200, completed: 1_400 },
        state: {
          status: "completed",
          input: { path: "src/a.ts", offset: 3, limit: 1 },
          content: [{ type: "text", text: "Read file src/a.ts, lines 3-3\n3: third" }],
        },
      },
    ];

    render(<ReadToolExecutionGroup entries={reads.map((part, index) => ({ part, index }))} />);

    expect(screen.getByLabelText("Completed in 300 ms").textContent).toBe("300 ms");
  });

  it("shows completed tool duration instead of a checkmark", () => {
    const part: PalotMessageContent = {
      type: "tool",
      id: "timed-shell",
      name: "shell",
      time: { created: 1_000, ran: 1_250, completed: 2_500 },
      state: {
        status: "completed",
        input: { command: "bun run check" },
      },
    };

    const { container } = render(
      <Provider>
        <ToolExecution part={part} index={0} />
      </Provider>,
    );

    expect(screen.getByLabelText("Completed in 1.3 s").textContent).toBe("1.3 s");
    expect(container.querySelector(".lucide-check")).toBeNull();
  });

  it("does not format raw input until a collapsed tool is opened", () => {
    const toJSON = vi.fn(() => ({ nested: "value" }));
    const part: PalotMessageContent = {
      type: "tool",
      id: "lazy-details",
      name: "custom_tool",
      state: {
        status: "completed",
        input: { payload: { toJSON } } as unknown as JsonValue,
      },
    };

    const result = render(
      <Provider>
        <ToolExecution part={part} index={0} />
      </Provider>,
    );
    const trigger = within(result.container).getByRole("button", { name: /Called Custom tool/i });

    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(toJSON).not.toHaveBeenCalled();
    expect(within(result.container).queryByLabelText("JSON output")).toBeNull();

    fireEvent.click(trigger);

    expect(toJSON).toHaveBeenCalledTimes(1);
    expect(within(result.container).getByLabelText("JSON output").textContent).toContain(
      '"nested": "value"',
    );
  });

  it("renders image attachments returned by generic tools", () => {
    const part: PalotMessageContent = {
      type: "tool",
      id: "generated-image",
      name: "image_generation",
      state: {
        status: "completed",
        input: {},
        content: [
          {
            type: "file",
            uri: "data:image/png;base64,AAAA",
            mime: "image/png",
          },
        ],
      },
    };

    render(
      <Provider>
        <ToolExecution part={part} index={0} defaultOpen />
      </Provider>,
    );

    expect(screen.getByRole("img", { name: "Image generation image" }).getAttribute("src")).toBe(
      "data:image/png;base64,AAAA",
    );
    expect(screen.getByRole("button", { name: "Generated image" })).toBeTruthy();
  });

  it("renders pending image edits without parameter-heavy fallback titles", () => {
    const prompt = "Use the attached image as a palette reference".repeat(8);
    const part: PalotMessageContent = {
      type: "tool",
      id: "generated-image-pending",
      name: "image_gen",
      state: {
        status: "pending",
        input: {
          prompt,
          referenced_image_paths: ["one.png", "two.png"],
          output_format: "png",
          quality: "high",
        },
      },
    };

    render(
      <Provider>
        <ToolExecution part={part} index={0} />
      </Provider>,
    );

    const trigger = screen.getByRole("button", { name: /Editing image Pending 2 references/ });
    expect(trigger.textContent).not.toContain(prompt);
  });

  it("reuses measured detail height without remounting offscreen output", () => {
    const originalIntersectionObserver = globalThis.IntersectionObserver;
    const rect = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue(new DOMRect(0, 0, 100, 123));
    class OffscreenIntersectionObserver implements IntersectionObserver {
      readonly root = null;
      readonly rootMargin = "0px";
      readonly scrollMargin = "0px";
      readonly thresholds = [0];
      disconnect() {}
      observe() {}
      takeRecords() {
        return [];
      }
      unobserve() {}
    }
    Object.defineProperty(globalThis, "IntersectionObserver", {
      configurable: true,
      value: OffscreenIntersectionObserver,
    });
    const part: PalotMessageContent = {
      type: "tool",
      id: "deferred-shell-details",
      name: "shell",
      state: {
        status: "completed",
        input: { command: "printf test" },
        content: [{ type: "text", text: "test" }],
      },
    };

    try {
      const first = render(
        <Provider>
          <ToolExecution part={part} index={0} defaultOpen />
        </Provider>,
      );
      expect(first.getByLabelText("Command output")).toBeTruthy();
      first.unmount();

      const second = render(
        <Provider>
          <ToolExecution part={part} index={0} defaultOpen />
        </Provider>,
      );
      expect(second.queryByLabelText("Command output")).toBeNull();
      expect(second.container.querySelector('[style="height: 123px;"]')).toBeTruthy();
      second.unmount();
    } finally {
      rect.mockRestore();
      Object.defineProperty(globalThis, "IntersectionObserver", {
        configurable: true,
        value: originalIntersectionObserver,
      });
    }
  });

  it("shows elapsed time beside active tool spinners after one second", () => {
    vi.useFakeTimers();
    vi.setSystemTime(2_500);
    try {
      const store = createStore();
      const running: PalotMessageContent = {
        type: "tool",
        id: "running-shell",
        name: "shell",
        time: { created: 1_000, ran: 2_000 },
        state: { status: "running", input: { command: "bun run test" } },
      };
      const result = render(
        <Provider store={store}>
          <ToolExecution part={running} index={0} />
        </Provider>,
      );

      expect(within(result.container).getByText("Running")).toBeTruthy();
      expect(within(result.container).queryByText("0s")).toBeNull();

      act(() => vi.advanceTimersByTime(1_000));
      expect(within(result.container).getByText("1s")).toBeTruthy();

      result.rerender(
        <Provider store={store}>
          <ToolExecution
            part={{
              ...running,
              time: { created: 1_000 },
              state: { status: "pending", input: { command: "bun run test" } },
            }}
            index={0}
          />
        </Provider>,
      );
      expect(within(result.container).getByText("Pending")).toBeTruthy();
      expect(within(result.container).getByText("2s")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses a useful command label before streamed input arrives", () => {
    const store = createStore();
    const part: PalotMessageContent = {
      type: "tool",
      id: "shell-pending-input",
      name: "shell",
      state: { status: "running", input: "" },
    };
    const result = render(
      <Provider store={store}>
        <ToolExecution part={part} index={0} />
      </Provider>,
    );

    expect(within(result.container).getByText("Running command")).toBeTruthy();

    result.rerender(
      <Provider store={store}>
        <ToolExecution
          part={{ ...part, state: { status: "running", input: { command: "bun run test" } } }}
          index={0}
        />
      </Provider>,
    );

    expect(within(result.container).getByText("Running bun run test")).toBeTruthy();
  });

  it("keeps expanded output aligned with the tool row at minimum widths", () => {
    const store = createStore();
    const command = "printf '%s\\n' a-very-long-command-that-must-use-the-full-available-width";
    const part: PalotMessageContent = {
      type: "tool",
      id: "shell-1",
      name: "shell",
      state: {
        status: "completed",
        input: { command },
        content: [{ type: "text", text: "wrapped output" }],
      },
    };

    const { container } = render(
      <Provider store={store}>
        <div style={{ width: 240 }}>
          <ToolExecution part={part} index={0} defaultOpen />
        </div>
      </Provider>,
    );

    const root = container.querySelector('[data-slot="collapsible"]');
    const panel = screen.getByText(`$ ${command}`).closest('[data-slot="collapsible-content"]');
    const panelContent = panel?.querySelector('[data-slot="collapsible-content-inner"]');
    expect(root?.classList.contains("min-w-0")).toBe(true);
    expect(panel?.classList.contains("min-w-0")).toBe(true);
    expect(panel?.classList.contains("pt-1")).toBe(false);
    expect(panelContent?.classList.contains("pt-1")).toBe(true);
    expect(panelContent?.className).not.toMatch(/(?:^|\s)pl-/);
    expect(screen.getByRole("button", { name: "Copy command and output" })).toBeTruthy();
  });

  it("updates untouched mounted tool disclosures when the projected default changes", async () => {
    const store = createStore();
    const part: PalotMessageContent = {
      type: "tool",
      id: "shell-1",
      name: "shell",
      state: {
        status: "completed",
        input: { command: "echo compact" },
        content: [{ type: "text", text: "output" }],
      },
    };
    const { container, rerender } = render(
      <Provider store={store}>
        <ToolExecution part={part} index={0} />
      </Provider>,
    );

    const trigger = within(container).getByRole("button", { name: /echo compact/i });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    rerender(
      <Provider store={store}>
        <ToolExecution part={part} index={0} defaultOpen />
      </Provider>,
    );
    await waitFor(() => expect(trigger.getAttribute("aria-expanded")).toBe("true"));
  });

  it("preserves a manual collapse when a running execution later fails", () => {
    const store = createStore();
    const running: PalotMessageContent = {
      type: "tool",
      id: "shell-1",
      name: "shell",
      state: { status: "running", input: { command: "bun run test" } },
    };
    const failed: PalotMessageContent = {
      ...running,
      state: {
        status: "error",
        input: { command: "bun run test" },
        error: "Tests failed",
      },
    };
    const result = render(
      <Provider store={store}>
        <ToolExecution part={running} index={0} defaultOpen />
      </Provider>,
    );
    const trigger = within(result.container).getByRole("button", { name: /bun run test/i });

    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    result.rerender(
      <Provider store={store}>
        <ToolExecution part={failed} index={0} defaultOpen />
      </Provider>,
    );

    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("keeps long shell output in a bounded scroll area", () => {
    const store = createStore();
    const running = (output: string): PalotMessageContent => ({
      type: "tool",
      id: "shell-1",
      name: "shell",
      state: {
        status: "running",
        input: { command: "bun run test" },
        metadata: { output },
      },
    });
    const { container, rerender } = render(
      <Provider store={store}>
        <ToolExecution part={running("first")} index={0} defaultOpen />
      </Provider>,
    );
    const frame = within(container).getByLabelText("Command output");
    Object.defineProperties(frame, {
      scrollHeight: { configurable: true, value: 300 },
      clientHeight: { configurable: true, value: 100 },
    });

    rerender(
      <Provider store={store}>
        <ToolExecution part={running("first\nsecond")} index={0} defaultOpen />
      </Provider>,
    );
    expect(frame.classList.contains("overflow-y-auto")).toBe(true);
    expect(frame.classList.contains("overscroll-y-contain")).toBe(false);
    expect(frame.classList.contains("max-h-72")).toBe(true);
    expect(frame.textContent).toContain("first\nsecond");
    expect(within(container).queryByRole("button", { name: "Show full output" })).toBeNull();
  });

  it("renders streamed output alongside the final shell error", () => {
    const store = createStore();
    const part: PalotMessageContent = {
      type: "tool",
      id: "shell-1",
      name: "shell",
      state: {
        status: "error",
        input: { command: "bun run test" },
        metadata: { output: "failed assertion", exit: 1 },
        error: "Command exited with code 1",
      },
    };

    const result = render(
      <Provider store={store}>
        <ToolExecution part={part} index={0} />
      </Provider>,
    );

    fireEvent.click(within(result.container).getByRole("button", { name: /bun run test/i }));
    expect(screen.getByText("failed assertion")).toBeTruthy();
    expect(screen.getByText("Command exited with code 1")).toBeTruthy();
  });

  it("shows the webfetch URL and renders markdown output", () => {
    const store = createStore();
    const part: PalotMessageContent = {
      type: "tool",
      id: "webfetch-1",
      name: "webfetch",
      state: {
        status: "completed",
        input: { url: "https://opencode.ai/v2/docs/", format: "markdown" },
        content: [{ type: "text", text: "# OpenCode V2\n\n**Current documentation.**" }],
      },
    };

    const { container } = render(
      <Provider store={store}>
        <ToolExecution part={part} index={0} defaultOpen />
      </Provider>,
    );

    expect(
      screen.getByRole("button", { name: /Fetched https:\/\/opencode\.ai\/v2\/docs\// }),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: "OpenCode V2" })).toBeTruthy();
    expect(container.querySelector("strong")?.textContent).toBe("Current documentation.");
  });

  it("does not highlight fetched HTML until the collapsed tool is opened", () => {
    const part: PalotMessageContent = {
      type: "tool",
      id: "webfetch-html",
      name: "webfetch",
      state: {
        status: "completed",
        input: { url: "https://example.com", format: "html" },
        content: [{ type: "text", text: "<main><h1>Hello</h1></main>" }],
      },
    };

    const { container } = render(
      <Provider>
        <ToolExecution part={part} index={0} />
      </Provider>,
    );

    expect(within(container).queryByLabelText("HTML output")).toBeNull();
    expect(container.querySelector(".tool-highlight")).toBeNull();

    fireEvent.click(
      within(container).getByRole("button", { name: /Fetched https:\/\/example.com/ }),
    );

    expect(within(container).getByLabelText("HTML output").textContent).toContain("Hello");
    expect(container.querySelector(".tool-highlight")).toBeTruthy();
  });

  it("renders search matches as highlighted file snippets in a scroll area", () => {
    const part: PalotMessageContent = {
      type: "tool",
      id: "grep-1",
      name: "grep",
      state: {
        status: "completed",
        input: { pattern: "value", path: "src" },
        content: [
          {
            type: "text",
            text: "Found 2 matches\nsrc/a.ts:\n  Line 2: const value = true;\n  Line 20: return value;",
          },
        ],
      },
    };

    const { container } = render(
      <Provider>
        <ToolExecution part={part} index={0} defaultOpen />
      </Provider>,
    );

    const output = within(container).getByLabelText("Search results for value");
    expect(output.classList.contains("overflow-y-auto")).toBe(true);
    expect(output.textContent).toContain("src/a.ts");
  });

  it("does not load remote images from fetched markdown", () => {
    const store = createStore();
    const part: PalotMessageContent = {
      type: "tool",
      id: "webfetch-image",
      name: "webfetch",
      state: {
        status: "completed",
        input: { url: "https://example.com", format: "markdown" },
        content: [{ type: "text", text: "![Tracking pixel](https://example.com/pixel.png)" }],
      },
    };

    const { container } = render(
      <Provider store={store}>
        <ToolExecution part={part} index={0} defaultOpen />
      </Provider>,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("[Image: Tracking pixel]")).toBeTruthy();
  });

  it("previews image read results in a lightbox", async () => {
    const store = createStore();
    const part: PalotMessageContent = {
      type: "tool",
      id: "read-image",
      name: "read",
      state: {
        status: "completed",
        input: { path: "screenshots/palot.png" },
        content: [
          { type: "text", text: "Image read successfully" },
          {
            type: "file",
            uri: "data:image/png;base64,AAAA",
            mime: "image/png",
            name: "palot.png",
          },
        ],
      },
    };

    render(
      <Provider store={store}>
        <ToolExecution part={part} index={0} defaultOpen />
      </Provider>,
    );

    const trigger = screen.getByRole("button", { name: "Open preview of palot.png" });
    expect(screen.getByRole("img", { name: "palot.png" }).getAttribute("src")).toBe(
      "data:image/png;base64,AAAA",
    );
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByRole("button", { name: "Zoom out" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close image preview" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("shows a failed webfetch error", () => {
    const store = createStore();
    const part: PalotMessageContent = {
      type: "tool",
      id: "webfetch-error",
      name: "webfetch",
      state: {
        status: "error",
        input: { url: "https://example.com", format: "markdown" },
        error: "Connection refused",
      },
    };

    render(
      <Provider store={store}>
        <ToolExecution part={part} index={0} />
      </Provider>,
    );

    expect(
      screen.getByRole("button", { name: /Failed to fetch https:\/\/example\.com/ }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Failed to fetch https:\/\/example\.com/ }));
    expect(screen.getByText("Connection refused")).toBeTruthy();
  });

  it("renders a readable fallback title from the tool name and input", () => {
    const part: PalotMessageContent = {
      type: "tool",
      id: "linear-1",
      name: "Linear.search_documentation",
      state: {
        status: "completed",
        input: { query: "fallback tool projection", page: 2 },
        content: [{ type: "text", text: "Search result" }],
      },
    };

    render(
      <Provider>
        <ToolExecution part={part} index={0} />
      </Provider>,
    );

    expect(
      screen.getByRole("button", {
        name: /Called Linear search documentation: fallback tool projection page=2/i,
      }),
    ).toBeTruthy();
  });

  it("renders execute orchestration without dumping the script into the title", () => {
    const store = createStore();
    const code = "return await tools.fixtures.add({ a: 1, b: 2 })";
    const part: PalotMessageContent = {
      type: "tool",
      id: "execute-1",
      name: "execute",
      state: {
        status: "completed",
        input: { code },
        content: [{ type: "text", text: '{"sum":3,"ok":true,"value":null}' }],
        metadata: {
          toolCalls: [
            { tool: "fixtures.add", status: "completed", input: { a: 1, b: 2 } },
            { tool: "bad.tool", status: "error", input: { reason: "test" } },
          ],
        },
      },
    };

    render(
      <Provider store={store}>
        <ToolExecution part={part} index={0} defaultOpen />
      </Provider>,
    );

    const trigger = screen.getByRole("button", {
      name: /Orchestrated Fixtures add and Bad tool 1 failed/i,
    });
    expect(trigger.textContent).not.toContain(code);
    expect(screen.getByText("Fixtures add")).toBeTruthy();
    expect(screen.getByText("Bad tool")).toBeTruthy();
    expect(
      screen.getByText((_, element) => element?.tagName === "CODE" && element.textContent === code),
    ).toBeTruthy();
    const result = screen.getByLabelText("JSON result");
    expect(result.textContent).toBe('{\n  "sum": 3,\n  "ok": true,\n  "value": null\n}');
    expect(result.querySelector(".tool-highlight")).toBeTruthy();
  });

  it("renders code-bearing MCP tools with script and structured result sections", () => {
    const code = "async () => spec.paths";
    const part: PalotMessageContent = {
      type: "tool",
      id: "cloudflare-search-1",
      name: "cloudflare_search",
      state: {
        status: "completed",
        input: { code },
        content: [{ type: "text", text: '{"required":["queryId","timeframe"]}' }],
      },
    };

    const result = render(
      <Provider>
        <ToolExecution part={part} index={0} defaultOpen />
      </Provider>,
    );
    const card = within(result.container);

    const trigger = card.getByRole("button", { name: /Ran Cloudflare search/i });
    expect(trigger.textContent).not.toContain(code);
    expect(card.getByText("Script")).toBeTruthy();
    expect(card.getByLabelText("JSON result")).toBeTruthy();
  });
});
