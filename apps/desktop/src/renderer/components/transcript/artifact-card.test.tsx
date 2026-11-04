import type { ArtifactInfo, OpenCodeClient } from "@opencode/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider, createStore } from "jotai";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JsonValue, PalotMessageContent } from "../../../shared";
import { experimentalBrowserAtom } from "../../atoms/ui";
import { runtimeAtom } from "../../atoms/workspace";
import { createRendererQueryClient } from "../../lib/query-client";
import {
  resetOpenCodeClientForTest,
  setOpenCodeClientForTest,
} from "../../services/opencode-client";
import { palot } from "../../services/palot";
import { ToolExecution } from "../tool-execution";
import { TranscriptArtifactContext } from "./artifact-context";

vi.mock("../../hooks/use-browser-session", () => ({
  useBrowserSession: () => ({ bindingID: "binding-1", state: { tabs: [], focusedTabID: null } }),
}));

const ID = "art_019a3b2c4d5eAbCdEfGhIjKlMn";
const view = `/api/experimental/artifacts/${ID}/view/`;
const scope = {
  connectionID: "connection-1",
  sessionID: "ses_1",
  location: { directory: "/repo" },
};

afterEach(() => {
  cleanup();
  resetOpenCodeClientForTest();
  vi.restoreAllMocks();
});

function artifact(overrides: Partial<ArtifactInfo> = {}): ArtifactInfo {
  return {
    id: ID,
    provider: "local",
    sessionID: "ses_1",
    title: "Flamegraph report",
    entry: "index.html",
    url: view,
    time: { created: Date.now() - 5 * 60_000, updated: Date.now() - 5 * 60_000 },
    ...overrides,
  } as ArtifactInfo;
}

function codeMode(
  id: string,
  call: { tool: string; input: Record<string, JsonValue> },
  status: "running" | "completed",
  returned?: ArtifactInfo,
  completed = Date.now(),
): PalotMessageContent {
  return {
    type: "tool",
    id,
    name: "execute",
    time: { created: completed - 1_000, ...(status === "completed" ? { completed } : {}) },
    state: {
      status,
      input: { code: `return await tools.${call.tool}(...)` },
      ...(status === "completed"
        ? { content: [{ type: "text", text: returned ? JSON.stringify(returned) : "null" }] }
        : {}),
      metadata: { toolCalls: [{ ...call, status }] },
    },
  };
}

function setup(list: () => readonly ArtifactInfo[], browserEnabled = true) {
  const listArtifacts = vi.fn(async () => ({ location: scope.location, data: list() }));
  setOpenCodeClientForTest({
    experimental: { artifacts: { list: listArtifacts } },
  } as unknown as OpenCodeClient);
  const store = createStore();
  store.set(runtimeAtom, {
    connectionID: "connection-1",
    profileID: "local-default",
    phase: "connected",
    connected: true,
    contractVersion: "2.2.5",
    version: "2.2.5",
    binaryPath: null,
    pid: null,
    managed: false,
    lastConnectedAt: 1,
    error: null,
    versionMismatch: null,
  });
  store.set(experimentalBrowserAtom, browserEnabled);
  const client = createRendererQueryClient();
  const wrap = (children: ReactNode) => (
    <QueryClientProvider client={client}>
      <Provider store={store}>
        <TranscriptArtifactContext.Provider value={scope}>
          {children}
        </TranscriptArtifactContext.Provider>
      </Provider>
    </QueryClientProvider>
  );
  return { listArtifacts, wrap, user: userEvent.setup() };
}

const create = { tool: "opencode.artifact_create", input: { title: "Flamegraph report" } };

describe("ArtifactCard", () => {
  it("replaces an artifact-only Code Mode call with a card that opens in Palot Browser", async () => {
    const open = vi.spyOn(palot, "browserOpenArtifact").mockResolvedValue("tab-1");
    const { wrap, user } = setup(() => [artifact()]);
    render(
      wrap(<ToolExecution index={0} part={codeMode("call-1", create, "completed", artifact())} />),
    );

    const card = await screen.findByRole("group", { name: "Artifact: Flamegraph report" });
    await waitFor(() => expect(card.textContent).toContain("Published · HTML · updated 5m ago"));
    expect(screen.queryByRole("button", { name: /Orchestrated/ })).toBeNull();
    await user.click(
      within(card).getByRole("button", { name: "Open Flamegraph report in Palot Browser" }),
    );
    expect(open).toHaveBeenCalledWith("binding-1", ID);
  });

  it.each(["running", "absent"] as const)(
    "follows a later update of the same artifact in place when the update was %s",
    async (before) => {
      let current = artifact();
      const { wrap, listArtifacts } = setup(() => [current]);
      const update = { tool: "opencode.artifact_update", input: { id: ID } };
      const published = codeMode("call-1", create, "completed", artifact(), Date.now() - 60_000);
      const transcript = (status: "running" | "completed" | "absent") => (
        <>
          <ToolExecution index={0} part={published} />
          {status === "absent" ? null : (
            <ToolExecution
              index={1}
              // Finished after the list was first read, as a transcript refresh delivers it.
              part={codeMode("call-2", update, status, undefined, Date.now() + 1_000)}
            />
          )}
        </>
      );
      const view = render(wrap(transcript(before)));
      await waitFor(() => expect(listArtifacts).toHaveBeenCalledTimes(1));
      expect(
        screen.getByRole("group", { name: "Artifact: Flamegraph report" }).textContent,
      ).toContain("Published");

      current = artifact({
        title: "Flamegraph report v2",
        time: { created: 1, updated: Date.now() },
      });
      view.rerender(wrap(transcript("completed")));

      await waitFor(() => expect(listArtifacts).toHaveBeenCalledTimes(2));
      const cards = () => screen.getAllByRole("group", { name: "Artifact: Flamegraph report v2" });
      await waitFor(() => expect(cards()).toHaveLength(2));
      expect(cards().map((card) => card.textContent)).toEqual([
        expect.stringContaining("Published · HTML · updated just now"),
        expect.stringContaining("Updated · HTML · updated just now"),
      ]);
    },
  );

  it("opens another provider's page as an ordinary web page", async () => {
    const command = vi.spyOn(palot, "browserCommand").mockResolvedValue("tab-1");
    const hosted = artifact({ provider: "cloudflare", url: `https://cf.example.test/${ID}/` });
    const { wrap, user } = setup(() => [hosted]);
    render(
      wrap(<ToolExecution index={0} part={codeMode("call-1", create, "completed", hosted)} />),
    );

    const card = await screen.findByRole("group", { name: "Artifact: Flamegraph report" });
    await waitFor(() => expect(card.textContent).toContain("cloudflare"));
    await user.click(within(card).getByRole("button", { name: /^Open/ }));
    expect(command).toHaveBeenCalledWith("binding-1", {
      type: "tabs.open",
      url: `https://cf.example.test/${ID}/`,
      focus: true,
    });
  });

  it("says when the artifact was deleted since", async () => {
    const { wrap, listArtifacts } = setup(() => []);
    render(
      wrap(<ToolExecution index={0} part={codeMode("call-1", create, "completed", artifact())} />),
    );

    await waitFor(() => expect(listArtifacts).toHaveBeenCalled());
    const card = screen.getByRole("group", { name: "Artifact: Flamegraph report" });
    await waitFor(() => expect(card.textContent).toContain("no longer available"));
    expect(within(card).queryByRole("button")).toBeNull();
  });

  it("keeps the recorded call when artifacts are off for the task", async () => {
    const { wrap } = setup(() => {
      throw { _tag: "ForbiddenError", message: "Artifacts are disabled" };
    });
    render(
      wrap(<ToolExecution index={0} part={codeMode("call-1", create, "completed", artifact())} />),
    );

    const card = screen.getByRole("group", { name: "Artifact: Flamegraph report" });
    await waitFor(() => expect(card.textContent).toContain("Published · HTML"));
    expect(within(card).getByRole("button", { name: /^Open/ })).toBeTruthy();
  });
});
