// @vitest-environment node
import { Window } from "happy-dom";
import { expect, it } from "vitest";
import type { SessionMessageInfo } from "@opencode/client";
import { guestRows } from "./projection";
import html from "./page.html?raw";
import javascript from "./page.js?raw";

it("renders guest text literally without interpreting HTML or loading remote assets", async () => {
  const window = new Window({
    url: "http://127.0.0.1:1234/g/test/",
    settings: {
      enableJavaScriptEvaluation: true,
      disableCSSFileLoading: true,
      disableJavaScriptFileLoading: true,
    },
  });
  const callbacks = new Map<string, (event: { data: string }) => void>();
  Object.assign(window, {
    EventSource: class {
      addEventListener(name: string, callback: (event: { data: string }) => void) {
        callbacks.set(name, callback);
      }
      close() {}
    },
  });
  window.document.body.innerHTML = html;
  try {
    window.eval(javascript);
    const attack = '<img src="https://example.com" onerror="alert(1)"><script>alert(2)</script>&';
    callbacks.get("snapshot")!({
      data: JSON.stringify({
        title: attack,
        status: "idle",
        rows: [{ role: "assistant", text: attack }],
      }),
    });
    expect(window.document.querySelector("h1")!.textContent).toBe(attack);
    expect(window.document.querySelector("#transcript")!.textContent).toContain(attack);
    expect(window.document.querySelector("#transcript img, #transcript script")).toBe(null);
    callbacks.get("revoked")!({ data: "{}" });
    expect(window.document.querySelector("#transcript")!.textContent).toBe("");
    expect(window.document.querySelector("button")!.disabled).toBe(true);
  } finally {
    await window.happyDOM.abort();
    window.close();
  }
});

it("allows only visible message text and simple tool labels, omitting reasoning, files and raw output", () => {
  const messages = [
    {
      id: "u",
      type: "user",
      time: { created: 1 },
      text: "Hello",
      files: [{ uri: "file:///secret" }],
      metadata: { secret: "hidden" },
    },
    {
      id: "a",
      type: "assistant",
      time: { created: 2 },
      content: [
        { id: "t", type: "text", text: "World" },
        { id: "r", type: "reasoning", text: "private thinking" },
        {
          id: "tool",
          type: "tool",
          name: "read",
          state: {
            status: "completed",
            input: { path: "/private" },
            content: [{ type: "text", text: "raw file contents" }],
          },
        },
      ],
    },
  ] as unknown as SessionMessageInfo[];
  expect(guestRows(messages)).toEqual([
    { id: "u", role: "user", text: "Hello" },
    { id: "a:0", role: "assistant", text: "World" },
    { id: "a:2", role: "tool", text: "read · completed" },
  ]);
});
