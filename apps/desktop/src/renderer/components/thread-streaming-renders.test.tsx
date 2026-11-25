import { act, cleanup, screen } from "@testing-library/react";
import { atom, createStore, useAtomValue } from "jotai";
import type { ComponentProps } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { PalotMessage, PalotSession, SessionRequestSnapshot } from "../../shared";
import { useSessionRequests } from "../hooks/use-session-requests";
import { useSessionTranscript } from "../hooks/use-session-transcript";
import { createRendererQueryClient } from "../lib/query-client";
import { recordStreamingCommit } from "../lib/streaming-latency";
import { renderWithRouter, seedCatalog } from "../test-utils/render-with-router";
import { Thread } from "./thread";

const composerRenders = vi.hoisted(
  () => [] as Array<ComponentProps<typeof import("./composer").Composer>>,
);

vi.mock("../hooks/use-session-transcript", async (original) => ({
  ...(await original<typeof import("../hooks/use-session-transcript")>()),
  useSessionTranscript: vi.fn(),
}));

vi.mock("../hooks/use-session-requests", async (original) => ({
  ...(await original<typeof import("../hooks/use-session-requests")>()),
  useSessionRequests: vi.fn(),
}));

vi.mock("../lib/streaming-latency", async (original) => ({
  ...(await original<typeof import("../lib/streaming-latency")>()),
  recordStreamingCommit: vi.fn(),
}));

vi.mock("./composer", async (original) => {
  const actual = await original<typeof import("./composer")>();
  // Not memoised, so it renders whenever its parent passes it props.
  function Composer(props: ComponentProps<typeof actual.Composer>) {
    composerRenders.push(props);
    return <actual.Composer {...props} />;
  }
  return { ...actual, Composer };
});

afterEach(() => {
  cleanup();
  composerRenders.length = 0;
  window.localStorage.clear();
});

const session: PalotSession = {
  id: "streaming-session",
  parentID: null,
  projectID: "project",
  title: "Streaming reply",
  agent: null,
  model: null,
  location: { directory: "/repo" },
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
  cost: null,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
};

const requests: SessionRequestSnapshot = {
  permissions: [],
  forms: [],
  inbox: [
    {
      id: "queued-input",
      sessionID: session.id,
      time: { created: 3 },
      type: "user",
      delivery: "queue",
      payload: { text: "Run the tests after this" },
    },
  ],
  errors: [],
};

const prompt: PalotMessage = {
  id: "prompt",
  type: "user",
  createdAt: 1,
  completedAt: null,
  text: "Explain the change",
  agent: null,
  model: null,
  tokens: null,
  finish: null,
  content: [{ type: "text", text: "Explain the change" }],
  data: {},
};

// OpenCode's inbox event adds the waiting prompt to the transcript after the running reply.
const queued: PalotMessage = {
  id: "queued-input",
  type: "user",
  optimistic: true,
  delivery: "queue",
  createdAt: 3,
  completedAt: 3,
  text: "Run the tests after this",
  agent: null,
  model: null,
  tokens: null,
  finish: null,
  content: [{ type: "text", text: "Run the tests after this" }],
  data: {},
};

function reply(text: string): PalotMessage {
  return {
    id: "reply",
    type: "assistant",
    createdAt: 2,
    completedAt: null,
    text,
    agent: null,
    model: null,
    tokens: null,
    finish: null,
    content: [{ id: "reply-text", type: "text", text }],
    data: {},
  };
}

it("streams text into the reply without re-rendering the composer", async () => {
  const transcript = atom<ReturnType<typeof useSessionTranscript>>({
    connectionID: "disconnected",
    messages: [prompt, reply("The change"), queued],
    error: null,
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetchNextPageError: false,
    isFetchingNextPage: false,
    isHydrating: false,
    isPending: false,
  });
  vi.mocked(useSessionTranscript).mockImplementation(() => useAtomValue(transcript));
  vi.mocked(useSessionRequests).mockReturnValue({ data: requests } as ReturnType<
    typeof useSessionRequests
  >);
  const store = createStore();
  const queryClient = createRendererQueryClient();
  seedCatalog(queryClient, { sessions: [session] });
  renderWithRouter(<Thread sessionID={session.id} />, store, "/new", queryClient);
  await screen.findByRole("textbox", { name: "Message Palot" });
  const pendingInputs = composerRenders.at(-1)!.pendingInputs;
  expect(pendingInputs?.map((input) => input.detail)).toEqual(["Run the tests after this"]);
  // The waiting prompt does not end the running turn.
  expect(composerRenders.at(-1)!.isWorking).toBe(true);
  composerRenders.length = 0;
  vi.mocked(recordStreamingCommit).mockClear();

  for (const text of ["The change moves", "The change moves the parser"]) {
    act(() =>
      store.set(transcript, (current) => ({
        ...current,
        messages: [prompt, reply(text), queued],
      })),
    );
  }

  // The thread committed both chunks; the composer saw neither.
  expect(recordStreamingCommit).toHaveBeenCalledTimes(2);
  expect(composerRenders).toEqual([]);

  // A change to the requests still reaches the composer.
  vi.mocked(useSessionRequests).mockReturnValue({
    data: { ...requests, inbox: [] },
  } as unknown as ReturnType<typeof useSessionRequests>);
  act(() =>
    store.set(transcript, (current) => ({ ...current, messages: [prompt, reply("Done.")] })),
  );
  expect(composerRenders.at(-1)?.pendingInputs).toEqual([]);
});
