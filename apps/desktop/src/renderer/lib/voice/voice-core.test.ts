import { describe, expect, it } from "vitest";
import type { PalotMessage } from "../../../shared";
import type { TranscriptTurn } from "../turn-projection";
import type { PendingRequestView } from "../view-models";
import { parseVoiceServerEvent, splitForAppend } from "./voice-protocol";
import { formatVoiceDelegationPrompt, speakableText } from "./voice-prompts";
import { VoiceAgentRelay } from "./voice-relay";
import { VoiceTranscript } from "./voice-transcript";

/**
 * OpenCode's timeline shows a prompt as a Voice message only when it matches
 * `parseVoiceDelegation` (anomalyco/opencode packages/app/src/session/timeline/
 * voice-delegation.ts). This mirrors that external contract.
 */
function parseOpenCodeVoiceDelegation(text: string) {
  if (!text.startsWith("Voice delegation.") && !text.startsWith("Voice delegation (continued)."))
    return;
  const newline = text.indexOf("\n");
  if (newline === -1) return;
  try {
    const body = JSON.parse(text.slice(newline + 1)) as { instruction?: unknown; voice?: unknown };
    const instruction = typeof body.instruction === "string" ? body.instruction.trim() : "";
    if (!instruction) return;
    return {
      instruction,
      framing: typeof body.voice === "string" ? body.voice.trim() || undefined : undefined,
    };
  } catch {
    return;
  }
}

function message(text: string): PalotMessage {
  return {
    id: "assistant",
    type: "assistant",
    createdAt: 1,
    completedAt: 2,
    text,
    agent: null,
    model: null,
    tokens: null,
    finish: "stop",
    content: [{ type: "text", text }],
    data: null,
  };
}

function turn(input: Partial<TranscriptTurn> & { reply?: string }): TranscriptTurn {
  const { reply, ...rest } = input;
  return {
    id: "turn",
    user: null,
    users: [],
    activity: [],
    blockingRequests: [],
    final:
      reply === undefined
        ? null
        : { message: message(reply), part: { type: "text", text: reply }, index: 0 },
    postFinal: [],
    tokensPerSecond: null,
    status: "working",
    startedAt: 1,
    finalStartedAt: null,
    workCompletedAt: null,
    completedAt: null,
    canCollapse: false,
    shouldAutoCollapse: false,
    ...rest,
  };
}

function permission(id: string, title: string): PendingRequestView {
  return {
    id,
    type: "permission",
    title,
    resources: [],
    savePatterns: [],
    questions: [],
    fields: [],
  };
}

describe("parseVoiceServerEvent", () => {
  it("reads GPT-Live transcript, delegation and close events", () => {
    expect(
      parseVoiceServerEvent(
        JSON.stringify({
          type: "session.input_transcript.delta",
          delta: "fix it",
          start_ms: 10,
          end_ms: 40,
        }),
      ),
    ).toEqual({ type: "transcript", speaker: "user", delta: "fix it", startMs: 10, endMs: 40 });
    expect(
      parseVoiceServerEvent(
        JSON.stringify({
          type: "session.delegation.created",
          offset_ms: 900,
          delegation: { id: "item_1", type: "delegation", target: "client" },
        }),
      ),
    ).toEqual({ type: "delegation", delegationID: "item_1", offsetMs: 900 });
    expect(
      parseVoiceServerEvent(
        JSON.stringify({ type: "session.closed", reason: "expired", usage: { seconds: 61 } }),
      ),
    ).toEqual({ type: "session.closed", reason: "expired", seconds: 61 });
  });

  it("ignores Responses-targeted delegations and malformed input", () => {
    expect(
      parseVoiceServerEvent(
        JSON.stringify({
          type: "session.delegation.created",
          delegation: { id: "x", target: "responses" },
        }),
      ),
    ).toBeUndefined();
    expect(parseVoiceServerEvent("{not json")).toBeUndefined();
    expect(
      parseVoiceServerEvent(JSON.stringify({ type: "session.input_transcript.delta" })),
    ).toBeUndefined();
  });
});

describe("splitForAppend", () => {
  it("keeps every chunk within the append budget and loses no words", () => {
    const text = Array.from(
      { length: 300 },
      (_, index) => `Sentence ${index} explains a change.`,
    ).join(" ");
    const chunks = splitForAppend(text, 200);
    expect(chunks.every((chunk) => chunk.length <= 200)).toBe(true);
    expect(chunks.join(" ").replace(/\s+/g, " ")).toBe(text);
  });
});

describe("VoiceTranscript", () => {
  it("hands each delegation only what was said since the previous one", () => {
    const transcript = new VoiceTranscript();
    transcript.add({ speaker: "user", text: "check the ", startMs: 0, endMs: 300 });
    transcript.add({ speaker: "user", text: "upload test", startMs: 300, endMs: 700 });
    transcript.add({ speaker: "assistant", text: "On it.", startMs: 900, endMs: 1200 });
    expect(transcript.takeDelegationWindow()).toEqual({
      instruction: "check the upload test",
      transcriptDelta: ["user: check the upload test", "assistant: On it."],
      voice: "On it.",
    });

    transcript.add({ speaker: "user", text: "and open a PR", startMs: 5000, endMs: 5600 });
    expect(transcript.takeDelegationWindow()).toMatchObject({
      instruction: "and open a PR",
      transcriptDelta: ["user: and open a PR"],
    });
  });

  it("keeps a fragment that arrives late for the next delegation", () => {
    const transcript = new VoiceTranscript();
    transcript.add({ speaker: "user", text: "run the tests", startMs: 1000, endMs: 1500 });
    transcript.takeDelegationWindow();
    transcript.add({ speaker: "user", text: " please", startMs: 1500, endMs: 1700 });
    expect(transcript.hasPendingUserSpeech()).toBe(true);
    expect(transcript.takeDelegationWindow().instruction).toBe("please");
  });
});

describe("formatVoiceDelegationPrompt", () => {
  it("produces prompts OpenCode renders as Voice messages", () => {
    const window = {
      instruction: 'check the "upload" test',
      transcriptDelta: ['user: check the "upload" test'],
      voice: "Checking the upload test.",
    };
    expect(
      parseOpenCodeVoiceDelegation(
        formatVoiceDelegationPrompt({ window, continued: false, context: 'Session "Uploads"' }),
      ),
    ).toEqual({ instruction: 'check the "upload" test', framing: "Checking the upload test." });
    expect(
      parseOpenCodeVoiceDelegation(
        formatVoiceDelegationPrompt({ window: { ...window, voice: undefined }, continued: true }),
      ),
    ).toEqual({ instruction: 'check the "upload" test', framing: undefined });
  });
});

describe("speakableText", () => {
  it("drops code and markdown syntax that shouldn't be read aloud", () => {
    const spoken = speakableText(
      "## Fixed\nThe **upload** test was flaky; see [the PR](https://example.com/1).\n```ts\nawait upload()\n```\n- Run `bun test`",
    );
    expect(spoken).not.toContain("await upload()");
    expect(spoken).not.toContain("https://");
    expect(spoken).not.toMatch(/[#*`]/);
    expect(spoken).toContain("The upload test was flaky; see the PR.");
    expect(spoken).toContain("Run bun test");
  });
});

describe("VoiceAgentRelay", () => {
  it("speaks the reply only once work delegated during the call has finished", () => {
    let now = 1_000;
    const relay = new VoiceAgentRelay(() => now);
    const earlier = turn({
      id: "old",
      status: "completed",
      completedAt: 500,
      reply: "Old answer.",
    });
    expect(relay.update({ turns: [earlier], requests: [], busy: false }).outputs).toEqual([]);

    now = 2_000;
    relay.delegated("item_1");
    // The prompt hasn't been admitted yet: the latest turn is still the old one.
    expect(relay.update({ turns: [earlier], requests: [], busy: false }).outputs).toEqual([]);

    now = 3_000;
    const working = turn({ id: "new", status: "working", startedAt: 2_100 });
    expect(relay.update({ turns: [earlier, working], requests: [], busy: true }).status).toBe(
      "Working",
    );

    now = 9_000;
    const done = turn({
      id: "new",
      status: "completed",
      startedAt: 2_100,
      completedAt: 8_900,
      reply: "Fixed the flaky test.",
    });
    const result = relay.update({ turns: [earlier, done], requests: [], busy: false });
    expect(result.outputs).toEqual([
      {
        kind: "commentary",
        delegationID: "item_1",
        content: "The backend finished: Fixed the flaky test.",
      },
    ]);
    expect(relay.awaiting).toBe(false);
    expect(relay.update({ turns: [earlier, done], requests: [], busy: false }).outputs).toEqual([]);
  });

  it("announces each new approval request once and waits on it", () => {
    const relay = new VoiceAgentRelay(() => 1_000);
    const before = permission("p0", "Edit old.ts");
    const first = relay.update({ turns: [], requests: [before], busy: false });
    expect(first.outputs.map((output) => output.kind)).toEqual(["thinking"]);

    relay.delegated("item_2");
    const asked = permission("p1", "Run bun test");
    const update = relay.update({ turns: [turn({})], requests: [before, asked], busy: true });
    expect(update.status).toBe("Waiting for your approval");
    expect(update.outputs.filter((output) => output.kind === "commentary")).toHaveLength(1);
    expect(update.outputs[0]?.content).toContain("Run bun test");
    expect(
      relay.update({ turns: [turn({})], requests: [before, asked], busy: true }).outputs,
    ).toEqual([]);
  });

  it("keeps progress notes sparse and silent", () => {
    let now = 0;
    const relay = new VoiceAgentRelay(() => now);
    relay.update({ turns: [], requests: [], busy: false });
    relay.delegated("item_3");
    const running = (title: string) =>
      turn({
        activity: [
          { id: "g", kind: "tools", title, status: "running", entries: [], currentAction: title },
        ],
      });
    now = 10_000;
    expect(
      relay.update({ turns: [running("Running 'bun test'")], requests: [], busy: true }).outputs,
    ).toEqual([
      {
        kind: "thinking",
        delegationID: "item_3",
        content: "Backend progress: Running 'bun test'.",
      },
    ]);
    now = 12_000;
    expect(
      relay.update({ turns: [running("Editing 'a.ts'")], requests: [], busy: true }).outputs,
    ).toEqual([]);
    now = 19_000;
    expect(
      relay.update({ turns: [running("Editing 'a.ts'")], requests: [], busy: true }).outputs,
    ).toHaveLength(1);
  });

  it("reports failures without reading the reply as a success", () => {
    const relay = new VoiceAgentRelay(() => 1_000);
    relay.update({ turns: [], requests: [], busy: false });
    relay.delegated("item_4");
    const failed = turn({ status: "failed", completedAt: 2_000, reply: "Tests are still red." });
    const [output] = relay.update({ turns: [failed], requests: [], busy: false }).outputs;
    expect(output?.content).toMatch(/^The backend's work failed\./);
  });
});
