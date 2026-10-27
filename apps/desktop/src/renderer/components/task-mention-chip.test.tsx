import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PalotSession, OpenCodeRuntimeStatus } from "../../shared";
import { runtimeAtom } from "../atoms/workspace";
import { openCodeReconciler } from "../lib/open-code-reconciler";
import { createRendererQueryClient } from "../lib/query-client";
import { EMPTY_SESSION_REQUEST_SNAPSHOT } from "../lib/session-request-reducer";
import { MarkdownContent, MarkdownWorkspaceProvider } from "./markdown-content";

afterEach(cleanup);
const id = "ses_0123456789abcdefghijklmnop";
const runtime = {
  connectionID: "owner",
  profileID: "profile",
  connected: false,
} as OpenCodeRuntimeStatus;
const task: PalotSession = {
  id,
  parentID: null,
  title: "Original title",
  projectID: "project",
  agent: null,
  model: null,
  location: { directory: "/repo" },
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
  cost: null,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
};

describe("task reference chips", () => {
  it("uses live titles and activity, gives descendant requests priority, and keeps the scoped opener", async () => {
    const store = createStore();
    store.set(runtimeAtom, runtime);
    const client = createRendererQueryClient();
    const reconciler = openCodeReconciler(client);
    reconciler.upsertPalotSessions("owner", [task, { ...task, id: "child", parentID: id }]);
    reconciler.upsertPalotSessions("other", [{ ...task, title: "Wrong connection" }]);
    const open = vi.fn();
    render(
      <QueryClientProvider client={client}>
        <Provider store={store}>
          <MarkdownWorkspaceProvider onOpenFile={vi.fn()} onOpenSession={open}>
            <MarkdownContent value={`See @session:${id}.`} />
          </MarkdownWorkspaceProvider>
        </Provider>
      </QueryClientProvider>,
    );
    await screen.findByText("Original title");
    expect(screen.getByLabelText("Idle")).toBeTruthy();
    act(() => {
      reconciler.upsertPalotSessions("owner", [{ ...task, title: "Renamed task", updatedAt: 2 }]);
      reconciler.updateActivity("owner", (current) => ({ ...current, activeIDs: new Set([id]) }));
    });
    await screen.findByText("Renamed task");
    await screen.findByLabelText("Running");
    act(() =>
      reconciler.setRequests("owner", "child", {
        ...EMPTY_SESSION_REQUEST_SNAPSHOT,
        forms: [
          {
            id: "form",
            sessionID: "child",
            title: "Confirm",
            fields: [{ key: "answer", type: "string", title: "Continue?" }],
          },
        ],
      }),
    );
    await screen.findByLabelText("Needs input");
    fireEvent.click(screen.getByText("Renamed task"));
    expect(open).toHaveBeenCalledWith(id);
    act(() => store.set(runtimeAtom, { ...runtime, connectionID: "other" }));
    await waitFor(() => expect(screen.queryByText("Renamed task")).toBeNull());
    expect(screen.queryByText("Wrong connection")).toBeNull();
    expect(screen.getByRole("button", { name: `@session:${id}` })).toBeTruthy();
  });

  it("links explicit mentions in prose and standalone code, but not fenced output, existing links, or partial streaming tokens", () => {
    const open = vi.fn();
    const content = (value: string, streaming = false) => (
      <MarkdownWorkspaceProvider onOpenFile={vi.fn()} onOpenSession={open}>
        <MarkdownContent value={value} streaming={streaming} />
      </MarkdownWorkspaceProvider>
    );
    const view = render(
      content(
        `@session:${id}, \`@session:${id}\` **@session:${id}**\n\n\`\`\`text\n@session:${id}\n\`\`\`\n\n[@session:${id}](https://example.com)`,
      ),
    );
    expect(screen.getAllByRole("button", { name: `@session:${id}` })).toHaveLength(3);
    view.rerender(content(`@session:${id}`, true));
    expect(screen.queryByRole("button", { name: `@session:${id}` })).toBeNull();
    view.rerender(content(`@session:${id}. `, true));
    expect(screen.getByRole("button", { name: `@session:${id}` })).toBeTruthy();
    view.rerender(content(`\`@session:${id}`, true));
    expect(screen.queryByRole("button", { name: `@session:${id}` })).toBeNull();
  });
});
