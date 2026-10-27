import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PalotEvent, PalotEventBatch } from "../../shared";
import { createRendererQueryClient } from "../lib/query-client";
import * as client from "../services/opencode-client";
import { palot } from "../services/palot";
import { isGlobalFormEvent, isMcpElicitation, useMcpElicitations } from "./use-mcp-elicitations";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, "palot");
});

const elicitation = {
  id: "frm_e1",
  sessionID: "global",
  title: "GitHub needs a repository",
  metadata: { kind: "mcp-elicitation" },
  fields: [{ key: "repo", type: "string", title: "Repository" }],
};

function event(type: string, data: unknown): PalotEvent {
  return {
    id: `${type}-1`,
    type,
    created: 1,
    createdAt: 1,
    receiveSequence: 1,
    data,
  } as PalotEvent;
}

describe("MCP elicitations", () => {
  it("recognizes location-wide elicitations and their events", () => {
    expect(isMcpElicitation(elicitation as never)).toBe(true);
    expect(isMcpElicitation({ ...elicitation, sessionID: "ses_1" } as never)).toBe(false);
    expect(isMcpElicitation({ ...elicitation, metadata: { kind: "question" } } as never)).toBe(
      false,
    );
    expect(isGlobalFormEvent(event("form.created", { form: elicitation }))).toBe(true);
    expect(isGlobalFormEvent(event("form.replied", { sessionID: "global", id: "frm_e1" }))).toBe(
      true,
    );
    expect(isGlobalFormEvent(event("form.cancelled", { sessionID: "ses_1", id: "f" }))).toBe(false);
  });

  it("lists the location's elicitations as forms and refreshes on global form events", async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce({
        data: [elicitation, { ...elicitation, id: "frm_q", sessionID: "ses_1" }],
      })
      .mockResolvedValueOnce({ data: [] });
    vi.spyOn(client, "openCodeClient").mockReturnValue({ form: { list } } as never);
    let listener: ((batch: PalotEventBatch) => void) | undefined;
    vi.spyOn(palot, "subscribe").mockImplementation((next) => {
      listener = next;
      return () => undefined;
    });
    const queryClient = createRendererQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useMcpElicitations("connection", "/repo"), { wrapper });

    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(list).toHaveBeenCalledWith({ location: { directory: "/repo" } }, expect.anything());
    expect(result.current[0]).toMatchObject({
      id: "frm_e1",
      type: "form",
      sessionID: "global",
      locationDirectory: "/repo",
      title: "GitHub needs a repository",
    });

    act(() =>
      listener?.({
        connectionID: "connection",
        events: [event("form.replied", { sessionID: "global", id: "frm_e1" })],
      } as PalotEventBatch),
    );
    await waitFor(() => expect(result.current).toHaveLength(0));
  });

  it("settles a location-wide form through its directory", async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    const cancel = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(client, "openCodeClient").mockReturnValue({
      session: { form: { reply, cancel } },
    } as never);
    Object.defineProperty(window, "palot", {
      configurable: true,
      value: { runtimeStatus: vi.fn() },
    });
    await palot.replyForm({
      sessionID: "global",
      formID: "frm_e1",
      answer: { repo: "a/b" },
      locationDirectory: "/my repo",
    });
    expect(reply).toHaveBeenCalledWith(
      { sessionID: "global", formID: "frm_e1", answer: { repo: "a/b" } },
      { headers: { "x-opencode-directory": "%2Fmy%20repo" } },
    );
    // Session-owned forms ignore the directory and send no extra options.
    await palot.cancelForm({ sessionID: "ses_1", formID: "f", locationDirectory: "/repo" });
    expect(cancel).toHaveBeenCalledWith({ sessionID: "ses_1", formID: "f" });
  });
});
