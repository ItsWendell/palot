import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider, createStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  IDLE_VOICE_CALL_SNAPSHOT,
  type JsonValue,
  type PalotMessage,
  type PalotSession,
  type VoiceCallSnapshot,
} from "../../../shared";
import type { SessionGoal } from "../../lib/session-goal";
import { palot } from "../../services/palot";
import { latestPlan } from "../transcript/plan";
import { ComposerDock, ComposerPanel, Composer as ComposerSurface } from "../ui/composer";
import {
  STANDING_SETTLED_MS,
  composerOpenTabAtom,
  useStandingSlots,
  useStandingTabs,
} from "./composer-standing";

const state = vi.hoisted(() => ({
  goal: null as SessionGoal | null,
  voice: null as VoiceCallSnapshot | null,
  end: vi.fn(),
  toggleMicrophone: vi.fn(),
}));
vi.mock("../../hooks/use-session-goal", () => ({ useSessionGoal: () => state.goal }));
vi.mock("../../hooks/use-voice-call", () => ({
  useVoiceCall: () => ({
    snapshot: state.voice ?? IDLE_VOICE_CALL_SNAPSHOT,
    transcript: [],
    lastError: null,
  }),
  useVoiceLevels: () => ({ input: 0, output: 0 }),
}));
vi.mock("../../services/voice-call", () => ({
  voiceCall: {
    end: state.end,
    toggleMicrophone: state.toggleMicrophone,
    toggleOutput: vi.fn(),
  },
}));
vi.mock("@palot/orbits", () => ({ ThinkingOrb: () => <span data-testid="orb" /> }));

const goal = (overrides: Partial<SessionGoal> = {}): SessionGoal => ({
  id: "goal-1",
  objective: "Make the integration tests pass",
  status: "active",
  reason: "Two tests still fail.",
  rounds: 3,
  maxRounds: 50,
  updatedAt: Date.now(),
  ...overrides,
});

const baseSession = {
  id: "s1",
  parentID: null,
  projectID: "p1",
  title: "Task",
  agent: null,
  model: null,
  location: { directory: "/repo" },
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
  cost: null,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
} as PalotSession;

function planMessage(todos: Array<[string, string]>): PalotMessage {
  return {
    id: "assistant-plan",
    type: "assistant",
    createdAt: 1,
    completedAt: 1,
    text: null,
    agent: "build",
    model: null,
    tokens: null,
    finish: "tool-calls",
    content: [
      {
        type: "tool",
        id: "todo-1",
        name: "todowrite",
        state: {
          status: "completed",
          input: {
            todos: todos.map(([content, status], index) => ({ id: `${index}`, content, status })),
          },
        } as JsonValue,
      },
    ],
    data: null,
  };
}

/** The thread's tabs fed into the card's tab row and panel slot. */
function Harness({
  session = baseSession,
  messages = [],
  requestOpen = false,
}: {
  session?: PalotSession;
  messages?: PalotMessage[];
  requestOpen?: boolean;
}) {
  const tabs = useStandingTabs({
    session,
    messages,
    plan: latestPlan(messages),
  });
  const slots = useStandingSlots(session.id, tabs, requestOpen);
  return (
    <ComposerDock>
      {slots.tabs}
      <ComposerSurface>
        <ComposerPanel
          open={Boolean(slots.panel)}
          aria-label={slots.panel?.label}
          onOpenChange={(open) => {
            if (!open) slots.panel?.onClose?.();
          }}
        >
          {slots.panel ? <div key={slots.panel.key}>{slots.panel.content}</div> : null}
        </ComposerPanel>
        <textarea aria-label="Message Palot" />
      </ComposerSurface>
    </ComposerDock>
  );
}

function renderHarness(props: Parameters<typeof Harness>[0] = {}) {
  const store = createStore();
  const client = new QueryClient();
  const wrap = (next: Parameters<typeof Harness>[0]) => (
    <QueryClientProvider client={client}>
      <Provider store={store}>
        <Harness {...next} />
      </Provider>
    </QueryClientProvider>
  );
  const view = render(wrap(props));
  return {
    ...view,
    store,
    rerenderWith: (next: Parameters<typeof Harness>[0]) => view.rerender(wrap(next)),
  };
}

// The tab row measures its tabs; give the layout-free DOM a wide row so none fold.
const clientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get() {
      return (this as HTMLElement).dataset.slot === "composer-tabs" ? 2_000 : 0;
    },
  });
});

afterEach(() => {
  if (clientWidth) Object.defineProperty(HTMLElement.prototype, "clientWidth", clientWidth);
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  state.goal = null;
  state.voice = null;
});

describe("standing context tabs", () => {
  it("shows no tabs for a task without standing context", () => {
    renderHarness();
    expect(screen.queryByRole("toolbar", { name: "Task context" })).toBeNull();
  });

  it("names a running goal's round on its tab and pauses it from the panel", async () => {
    const run = vi.spyOn(palot, "runCommand").mockResolvedValue(undefined);
    state.goal = goal();
    renderHarness();
    const tab = screen.getByRole("button", { name: /Goal · round 3 of 50/ });
    await userEvent.click(tab);
    const panel = screen.getByRole("region", { name: "Goal" });
    expect(panel.textContent).toContain("Pursuing goal · round 3 of 50");
    expect(panel.textContent).toContain("Make the integration tests pass");
    expect(panel.textContent).toContain("Reviewer: Two tests still fail.");
    await userEvent.click(within(panel).getByRole("button", { name: "Pause goal" }));
    await waitFor(() =>
      expect(run).toHaveBeenCalledWith(
        { sessionID: "s1", command: "goal", arguments: "pause" },
        undefined,
      ),
    );
  });

  it("marks a paused goal with the warning tone, says why, and resumes it", async () => {
    const run = vi.spyOn(palot, "runCommand").mockResolvedValue(undefined);
    state.goal = goal({ status: "paused", reason: "Not making progress" });
    renderHarness();
    const tab = screen.getByRole("button", { name: "Goal · paused" });
    expect(tab.getAttribute("data-tone")).toBe("warning");
    await userEvent.click(tab);
    const panel = screen.getByRole("region", { name: "Goal" });
    expect(panel.textContent).toContain("Paused: Not making progress");
    await userEvent.click(within(panel).getByRole("button", { name: "Resume goal" }));
    await waitFor(() =>
      expect(run).toHaveBeenCalledWith(
        { sessionID: "s1", command: "goal", arguments: "resume" },
        undefined,
      ),
    );
  });

  it("edits the objective in place by setting the goal again", async () => {
    const run = vi.spyOn(palot, "runCommand").mockResolvedValue(undefined);
    state.goal = goal({ status: "paused", reason: "Paused by the user" });
    renderHarness();
    await userEvent.click(screen.getByRole("button", { name: "Goal · paused" }));
    const panel = screen.getByRole("region", { name: "Goal" });
    await userEvent.click(within(panel).getByRole("button", { name: "Edit goal" }));
    const field = within(panel).getByRole("textbox", { name: "Goal objective" });
    expect(panel.textContent).toContain("restarts from round 1");

    // A control word would pause or clear instead of setting an objective.
    await userEvent.clear(field);
    await userEvent.type(field, "clear");
    expect(within(panel).getByRole("button", { name: "Save goal" })).toHaveProperty(
      "disabled",
      true,
    );

    await userEvent.clear(field);
    await userEvent.type(field, "Make the e2e suite pass too");
    await userEvent.click(within(panel).getByRole("button", { name: "Save goal" }));
    await waitFor(() =>
      expect(run).toHaveBeenCalledWith(
        { sessionID: "s1", command: "goal", arguments: "Make the e2e suite pass too" },
        undefined,
      ),
    );
    await waitFor(() => expect(within(panel).queryByRole("textbox")).toBeNull());
  });

  it("keeps the editor open with the text when OpenCode refuses the new objective", async () => {
    vi.spyOn(palot, "runCommand").mockRejectedValue(new Error("No goal plugin"));
    state.goal = goal();
    renderHarness();
    await userEvent.click(screen.getByRole("button", { name: /Goal · round 3 of 50/ }));
    const panel = screen.getByRole("region", { name: "Goal" });
    await userEvent.click(within(panel).getByRole("button", { name: "Edit goal" }));
    const field = within(panel).getByRole("textbox", { name: "Goal objective" });
    await userEvent.type(field, " and the lint");
    await userEvent.keyboard("{Control>}{Enter}{/Control}");
    await waitFor(() =>
      expect(
        (within(panel).getByRole("textbox", { name: "Goal objective" }) as HTMLTextAreaElement)
          .value,
      ).toBe("Make the integration tests pass and the lint"),
    );
    await userEvent.keyboard("{Escape}");
    expect(within(panel).queryByRole("textbox")).toBeNull();
  });

  it("shows a met goal briefly, then the tab leaves", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    state.goal = goal({ status: "complete", reason: "All 42 tests pass." });
    renderHarness();
    expect(screen.getByRole("button", { name: "Goal met" })).toBeTruthy();
    act(() => vi.advanceTimersByTime(STANDING_SETTLED_MS + 10));
    expect(screen.queryByRole("button", { name: "Goal met" })).toBeNull();
  });

  it("keeps a met goal's tab while its panel is open, and dismisses the goal", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const run = vi.spyOn(palot, "runCommand").mockResolvedValue(undefined);
    state.goal = goal({ status: "complete", reason: "All 42 tests pass." });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderHarness();
    await user.click(screen.getByRole("button", { name: "Goal met" }));
    act(() => vi.advanceTimersByTime(STANDING_SETTLED_MS + 10));
    const panel = screen.getByRole("region", { name: "Goal" });
    expect(panel.textContent).toContain("Reviewer: All 42 tests pass.");
    await user.click(within(panel).getByRole("button", { name: "Dismiss goal" }));
    await waitFor(() =>
      expect(run).toHaveBeenCalledWith(
        { sessionID: "s1", command: "goal", arguments: "clear" },
        undefined,
      ),
    );
  });

  it("labels the plan with its progress and current step, and lists the steps", async () => {
    renderHarness({
      messages: [
        planMessage([
          ["Read the reducer", "completed"],
          ["Write tests", "in_progress"],
          ["Run checks", "pending"],
        ]),
      ],
    });
    const tab = screen.getByRole("button", { name: /Plan · 1\/3/ });
    expect(tab.textContent).toContain("Write tests");
    await userEvent.click(tab);
    const panel = screen.getByRole("region", { name: "Plan" });
    expect(
      within(panel)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Read the reducer", "Write tests", "Run checks"]);
    expect(within(panel).getByRole("img", { name: "In progress" })).toBeTruthy();
  });

  it("keeps one panel open at a time and closes it with Escape", async () => {
    state.goal = goal();
    const user = userEvent.setup();
    renderHarness({ messages: [planMessage([["Write tests", "in_progress"]])] });
    await user.click(screen.getByRole("button", { name: /Goal/ }));
    expect(screen.getByRole("region", { name: "Goal" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Plan/ }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Goal" })).toBeNull());
    fireEvent.keyDown(screen.getByRole("region", { name: "Plan" }), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("region", { name: "Plan" })).toBeNull());
  });

  it("stages undo with the files and runs Restore", async () => {
    const clear = vi.spyOn(palot, "clearSessionRevert").mockResolvedValue(null as never);
    renderHarness({
      session: {
        ...baseSession,
        revert: {
          messageID: "m1",
          files: [
            { file: "src/a.ts", additions: 3, deletions: 1 },
            { file: "src/b.ts", additions: 0, deletions: 2 },
          ],
        },
      } as PalotSession,
      messages: [
        {
          id: "m1",
          type: "user",
          createdAt: 1,
          text: "x",
          content: [],
          data: null,
        } as unknown as PalotMessage,
      ],
    });
    await userEvent.click(screen.getByRole("button", { name: "Undo staged · 2 files" }));
    const panel = screen.getByRole("region", { name: "Undo staged" });
    expect(panel.textContent).toContain("1 message and 2 changed files");
    expect(within(panel).getByRole("list", { name: "Staged files" }).textContent).toContain(
      "src/a.ts",
    );
    await userEvent.click(within(panel).getByRole("button", { name: /Restore/ }));
    await waitFor(() => expect(clear).toHaveBeenCalledWith("s1"));
  });

  it("shows a live voice chat in this task and ends it from the panel", async () => {
    state.voice = {
      ...IDLE_VOICE_CALL_SNAPSHOT,
      phase: "active",
      activity: "listening",
      sessionID: "s1",
    } as VoiceCallSnapshot;
    renderHarness();
    const tab = screen.getByRole("button", { name: "Voice · live" });
    expect(tab.getAttribute("data-tone")).toBe("live");
    await userEvent.click(tab);
    const panel = screen.getByRole("region", { name: "Voice chat" });
    await userEvent.click(within(panel).getByRole("button", { name: "Mute microphone" }));
    expect(state.toggleMicrophone).toHaveBeenCalled();
    await userEvent.click(within(panel).getByRole("button", { name: /End/ }));
    expect(state.end).toHaveBeenCalled();
  });

  it("leaves a voice chat in another task out", () => {
    state.voice = {
      ...IDLE_VOICE_CALL_SNAPSHOT,
      phase: "active",
      sessionID: "other",
    } as VoiceCallSnapshot;
    renderHarness();
    expect(screen.queryByRole("button", { name: "Voice · live" })).toBeNull();
  });

  it("keeps the tabs in view but unusable while a request owns the panel slot", async () => {
    state.goal = goal();
    const { store, rerenderWith } = renderHarness();
    await userEvent.click(screen.getByRole("button", { name: /Goal/ }));
    expect(screen.getByRole("region", { name: "Goal" })).toBeTruthy();
    rerenderWith({ requestOpen: true });
    await waitFor(() => expect(screen.queryByRole("region", { name: "Goal" })).toBeNull());
    const tab = screen.getByRole("button", { name: /Goal/ });
    expect(tab.hasAttribute("disabled")).toBe(true);
    // The choice survives the request: the panel returns once it closes.
    expect(store.get(composerOpenTabAtom("s1"))).toBe("goal");
  });
});
