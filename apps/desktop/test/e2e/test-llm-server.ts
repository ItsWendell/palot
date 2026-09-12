/**
 * OpenAI-compatible test LLM adapted from OpenCode's MIT-licensed test server.
 * Upstream details live in test/e2e/UPSTREAM.md.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { setTimeout as sleep } from "node:timers/promises";

export type ModelRequest = {
  url: string;
  body: Record<string, unknown>;
  route: string | null;
};

type ModelEmission = {
  at: number;
  payload: unknown;
};

type ToolCall = { name: string; input: unknown; inputChunks?: string[] };

type Step =
  | {
      type: "text";
      chunks: string[];
      reasoningChunks: string[];
      delayMs: number;
      outputTokens: number;
      burst?: { size: number; intervalMs: number };
    }
  | {
      type: "tool";
      calls: ToolCall[];
      preambleChunks: string[];
      reasoningChunks: string[];
      delayMs: number;
    }
  | { type: "http-error"; status: number; body: unknown };

export interface TestLLMScript {
  text(value: string): void;
  textChunks(chunks: string[], delayMs: number): void;
  /** Individual text deltas in groups, with a pause after every group (including the last). */
  textBursts(chunks: string[], burstSize: number, intervalMs: number): void;
  textChunksWithUsage(chunks: string[], delayMs: number, outputTokens: number): void;
  reasoningAndTextChunks(reasoningChunks: string[], chunks: string[], delayMs: number): void;
  tool(name: string, input: unknown): void;
  /** Chunks concatenate to one JSON-encoded tool input, not individual JSON values. */
  toolInputChunks(name: string, chunks: string[], delayMs: number): void;
  toolWithText(name: string, input: unknown, preambleChunks: string[], delayMs: number): void;
  toolsWithText(
    calls: Array<{ name: string; input: unknown }>,
    preambleChunks: string[],
    delayMs: number,
  ): void;
  toolsWithReasoningAndText(
    calls: Array<{ name: string; input: unknown }>,
    reasoningChunks: string[],
    preambleChunks: string[],
    delayMs: number,
  ): void;
  error(status: number, body: unknown): void;
}

type Waiter = {
  count: number;
  resolve(): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
};

type Fixture = {
  body: string;
  contentType: string;
};

type ResponseTool = {
  callID: string;
  itemID: string;
  name: string;
  input: string;
  inputChunks: string[];
  outputIndex: number;
};

function chunk(input: { delta?: Record<string, unknown>; finish?: string; outputTokens?: number }) {
  return {
    id: "chatcmpl-palot-test",
    object: "chat.completion.chunk",
    choices: [
      {
        delta: input.delta ?? {},
        ...(input.finish ? { finish_reason: input.finish } : {}),
      },
    ],
    ...(input.outputTokens === undefined
      ? {}
      : {
          usage: {
            prompt_tokens: 0,
            completion_tokens: input.outputTokens,
            total_tokens: input.outputTokens,
            completion_tokens_details: { reasoning_tokens: 0 },
          },
        }),
  };
}

function responseCreated(model: string) {
  return {
    type: "response.created",
    sequence_number: 1,
    response: {
      id: "resp_palot_test",
      created_at: Math.floor(Date.now() / 1_000),
      model,
      service_tier: null,
    },
  };
}

function responseMessage(itemID: string, sequence: number) {
  return {
    type: "response.output_item.added",
    sequence_number: sequence,
    output_index: 0,
    item: { type: "message", id: itemID },
  };
}

function responseText(itemID: string, text: string, sequence: number) {
  return {
    type: "response.output_text.delta",
    sequence_number: sequence,
    item_id: itemID,
    delta: text,
    logprobs: null,
  };
}

function responseMessageDone(itemID: string, sequence: number) {
  return {
    type: "response.output_item.done",
    sequence_number: sequence,
    output_index: 0,
    item: { type: "message", id: itemID },
  };
}

function responseReasoning(itemID: string, sequence: number) {
  return {
    type: "response.output_item.added",
    sequence_number: sequence,
    output_index: 0,
    item: { type: "reasoning", id: itemID, encrypted_content: null },
  };
}

function responseReasoningPart(itemID: string, sequence: number) {
  return {
    type: "response.reasoning_summary_part.added",
    sequence_number: sequence,
    item_id: itemID,
    summary_index: 0,
  };
}

function responseReasoningText(itemID: string, text: string, sequence: number) {
  return {
    type: "response.reasoning_summary_text.delta",
    sequence_number: sequence,
    item_id: itemID,
    summary_index: 0,
    delta: text,
  };
}

function responseReasoningPartDone(itemID: string, sequence: number) {
  return {
    type: "response.reasoning_summary_part.done",
    sequence_number: sequence,
    item_id: itemID,
    summary_index: 0,
  };
}

function responseReasoningDone(itemID: string, sequence: number) {
  return {
    type: "response.output_item.done",
    sequence_number: sequence,
    output_index: 0,
    item: { type: "reasoning", id: itemID, encrypted_content: null },
  };
}

function responseToolAdded(tool: ResponseTool, sequence: number) {
  return {
    type: "response.output_item.added",
    sequence_number: sequence,
    output_index: tool.outputIndex,
    item: {
      type: "function_call",
      id: tool.itemID,
      call_id: tool.callID,
      name: tool.name,
      arguments: "",
      status: "in_progress",
    },
  };
}

function responseToolArguments(tool: ResponseTool, delta: string, sequence: number) {
  return {
    type: "response.function_call_arguments.delta",
    sequence_number: sequence,
    output_index: tool.outputIndex,
    item_id: tool.itemID,
    delta,
  };
}

function responseToolDone(tool: ResponseTool, sequence: number) {
  return {
    type: "response.output_item.done",
    sequence_number: sequence,
    output_index: tool.outputIndex,
    item: {
      type: "function_call",
      id: tool.itemID,
      call_id: tool.callID,
      name: tool.name,
      arguments: tool.input,
      status: "completed",
    },
  };
}

function responseCompleted(sequence: number, outputTokens = 0) {
  return {
    type: "response.completed",
    sequence_number: sequence,
    response: {
      id: "resp_palot_test",
      incomplete_details: null,
      service_tier: null,
      usage: {
        input_tokens: 0,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens: outputTokens,
        output_tokens_details: { reasoning_tokens: 0 },
        total_tokens: outputTokens,
      },
    },
  };
}

function modelFrom(body: Record<string, unknown>): string {
  return typeof body.model === "string" ? body.model : "test-model";
}

function reasoningResponses(itemID: string, chunks: string[], nextSequence: () => number) {
  if (chunks.length === 0) return [];
  return [
    responseReasoning(itemID, nextSequence()),
    responseReasoningPart(itemID, nextSequence()),
    ...chunks.map((text) => responseReasoningText(itemID, text, nextSequence())),
    responseReasoningPartDone(itemID, nextSequence()),
    responseReasoningDone(itemID, nextSequence()),
  ];
}

function textResponses(
  body: Record<string, unknown>,
  chunks: string[],
  reasoningChunks: string[] = [],
  outputTokens = 0,
): unknown[] {
  const itemID = "msg_palot_test";
  const reasoningID = "rs_palot_test";
  let sequence = 1;
  const nextSequence = () => ++sequence;
  return [
    responseCreated(modelFrom(body)),
    ...reasoningResponses(reasoningID, reasoningChunks, nextSequence),
    responseMessage(itemID, nextSequence()),
    ...chunks.map((text) => responseText(itemID, text, nextSequence())),
    responseMessageDone(itemID, nextSequence()),
    responseCompleted(nextSequence(), outputTokens),
  ];
}

function toolResponses(
  body: Record<string, unknown>,
  calls: Array<ToolCall & { id: string; index: number }>,
  preambleChunks: string[],
  reasoningChunks: string[],
): unknown[] {
  const messageID = "msg_palot_test";
  const reasoningID = "rs_palot_test";
  const tools = calls.map<ResponseTool>((call) => ({
    callID: call.id,
    itemID: `fc_palot_${call.id}`,
    name: call.name,
    input: call.inputChunks?.join("") ?? JSON.stringify(call.input),
    inputChunks: call.inputChunks ?? [JSON.stringify(call.input)],
    outputIndex: call.index + 1,
  }));
  let sequence = 1;
  const nextSequence = () => ++sequence;
  return [
    responseCreated(modelFrom(body)),
    ...reasoningResponses(reasoningID, reasoningChunks, nextSequence),
    ...(preambleChunks.length > 0
      ? [
          responseMessage(messageID, nextSequence()),
          ...preambleChunks.map((text) => responseText(messageID, text, nextSequence())),
          responseMessageDone(messageID, nextSequence()),
        ]
      : []),
    ...tools.map((tool) => responseToolAdded(tool, nextSequence())),
    ...tools.flatMap((tool) =>
      tool.inputChunks.map((delta) => responseToolArguments(tool, delta, nextSequence())),
    ),
    ...tools.map((tool) => responseToolDone(tool, nextSequence())),
    responseCompleted(nextSequence()),
  ];
}

async function sse(
  response: ServerResponse,
  lines: unknown[],
  delayMs: number,
  signal: AbortSignal,
  onWrite?: (line: unknown) => void,
  burst?: { size: number; intervalMs: number; contentStart: number; contentCount: number },
): Promise<void> {
  response.writeHead(200, {
    "cache-control": "no-cache",
    connection: "keep-alive",
    "content-type": "text/event-stream",
  });
  for (const [index, line] of lines.entries()) {
    signal.throwIfAborted();
    response.write(`data: ${JSON.stringify(line)}\n\n`);
    onWrite?.(line);
    // Only content deltas advance the burst, never role/created/completion envelopes.
    const contentCount = burst ? index - burst.contentStart + 1 : 0;
    const waitMs = burst
      ? contentCount > 0 &&
        contentCount <= burst.contentCount &&
        (contentCount % burst.size === 0 || contentCount === burst.contentCount)
        ? burst.intervalMs
        : 0
      : delayMs;
    if (waitMs > 0) await sleep(waitMs, undefined, { signal });
  }
  response.end("data: [DONE]\n\n");
}

export function isTitleRequest(body: Record<string, unknown>): boolean {
  const messages = Array.isArray(body.messages)
    ? body.messages
    : Array.isArray(body.input)
      ? body.input
      : [];
  const instructions: unknown[] = [body.instructions];
  for (const message of messages) {
    if (message && (message.role === "system" || message.role === "developer")) {
      instructions.push(message.content);
    }
  }
  return instructions.some((content) => {
    const parts = Array.isArray(content) ? content.map((part) => part?.text) : [content];
    return parts.some(
      (text) => typeof text === "string" && text.startsWith("You are a title generator."),
    );
  });
}

export class TestLLMServer {
  readonly requests: ModelRequest[] = [];
  readonly emissions: ModelEmission[] = [];
  #server: Server | null = null;
  #abort = new AbortController();
  #active = new Set<Promise<void>>();
  #closing: Promise<void> | null = null;
  #steps: Step[] = [];
  #routes = new Map<string, Step[]>();
  #fixtures = new Map<string, Fixture>();
  #waiters: Waiter[] = [];
  #toolID = 0;
  #scriptedCalls = 0;
  url = "";

  async start(): Promise<void> {
    if (this.#closing) await this.#closing;
    if (this.#server) return;
    this.#abort = new AbortController();
    const serverSignal = this.#abort.signal;
    const handle = async (
      request: IncomingMessage,
      response: ServerResponse,
      signal: AbortSignal,
    ) => {
      signal.throwIfAborted();
      if (request.method === "GET" && request.url) {
        const fixture = this.#fixtures.get(new URL(request.url, "http://localhost").pathname);
        if (fixture) {
          response.writeHead(200, { "content-type": fixture.contentType }).end(fixture.body);
          return;
        }
      }
      const pathname = request.url ? new URL(request.url, "http://localhost").pathname : "";
      if (
        request.method !== "POST" ||
        (pathname !== "/v1/chat/completions" && pathname !== "/v1/responses")
      ) {
        response.writeHead(404).end();
        return;
      }
      const body = await this.#readBody(request);
      signal.throwIfAborted();
      if (isTitleRequest(body)) {
        this.requests.push({ url: pathname, body, route: null });
        const lines =
          pathname === "/v1/responses"
            ? textResponses(body, ["E2E Title"])
            : [
                chunk({ delta: { role: "assistant" } }),
                chunk({ delta: { content: "E2E Title" } }),
                chunk({ finish: "stop" }),
              ];
        await sse(response, lines, 0, signal, (payload) =>
          this.emissions.push({ at: Date.now(), payload }),
        );
        return;
      }
      const route = this.#route(body);
      this.requests.push({ url: pathname, body, route });
      this.#scriptedCalls += 1;
      this.#notify();
      const step = route === null ? this.#steps.shift() : this.#routes.get(route)?.shift();
      if (!step) {
        response.writeHead(500, { "content-type": "application/json" }).end(
          JSON.stringify({
            error:
              route === null
                ? "Unexpected model request: no scripted response remains"
                : `Unexpected model request: route '${route}' has no scripted response remaining`,
          }),
        );
        return;
      }
      if (step.type === "http-error") {
        response
          .writeHead(step.status, { "content-type": "application/json" })
          .end(JSON.stringify(step.body));
        return;
      }
      if (step.type === "text") {
        const lines =
          pathname === "/v1/responses"
            ? textResponses(body, step.chunks, step.reasoningChunks, step.outputTokens)
            : [
                chunk({ delta: { role: "assistant" } }),
                ...step.reasoningChunks.map((reasoning) =>
                  chunk({ delta: { reasoning_content: reasoning } }),
                ),
                ...step.chunks.map((content) => chunk({ delta: { content } })),
                chunk({ finish: "stop", outputTokens: step.outputTokens }),
              ];
        await sse(
          response,
          lines,
          step.delayMs,
          signal,
          (payload) => this.emissions.push({ at: Date.now(), payload }),
          step.burst && {
            ...step.burst,
            // Burst steps are text-only: chat has one opening envelope, Responses two.
            contentStart: pathname === "/v1/responses" ? 2 : 1,
            contentCount: step.chunks.length,
          },
        );
        return;
      }
      const calls = step.calls.map((call, index) => ({
        ...call,
        id: `call-palot-${++this.#toolID}`,
        index,
      }));
      const lines =
        pathname === "/v1/responses"
          ? toolResponses(body, calls, step.preambleChunks, step.reasoningChunks)
          : [
              chunk({ delta: { role: "assistant" } }),
              ...step.reasoningChunks.map((reasoning) =>
                chunk({ delta: { reasoning_content: reasoning } }),
              ),
              ...step.preambleChunks.map((content) => chunk({ delta: { content } })),
              ...calls.flatMap((call) => [
                chunk({
                  delta: {
                    tool_calls: [
                      {
                        index: call.index,
                        id: call.id,
                        type: "function",
                        function: { name: call.name, arguments: "" },
                      },
                    ],
                  },
                }),
                ...(call.inputChunks ?? [JSON.stringify(call.input)]).map((argumentsChunk) =>
                  chunk({
                    delta: {
                      tool_calls: [
                        {
                          index: call.index,
                          function: { arguments: argumentsChunk },
                        },
                      ],
                    },
                  }),
                ),
              ]),
              chunk({ finish: "tool_calls" }),
            ];
      await sse(response, lines, step.delayMs, signal, (payload) =>
        this.emissions.push({ at: Date.now(), payload }),
      );
    };
    this.#server = createServer((request, response) => {
      const disconnected = new AbortController();
      const onClose = () => disconnected.abort();
      response.once("close", onClose);
      const signal = AbortSignal.any([serverSignal, disconnected.signal]);
      const task = handle(request, response, signal)
        .catch((error: unknown) => {
          if (!signal.aborted) response.destroy(error instanceof Error ? error : undefined);
        })
        .finally(() => {
          response.off("close", onClose);
          this.#active.delete(task);
        });
      this.#active.add(task);
    });
    await new Promise<void>((resolve, reject) => {
      this.#server?.once("error", reject);
      this.#server?.listen(0, "127.0.0.1", resolve);
    });
    const address = this.#server.address();
    if (!address || typeof address === "string")
      throw new Error("Test LLM did not bind a TCP port");
    this.url = `http://127.0.0.1:${address.port}/v1`;
  }

  text(value: string): void {
    this.#script(this.#steps).text(value);
  }

  textChunks(chunks: string[], delayMs: number): void {
    this.#script(this.#steps).textChunks(chunks, delayMs);
  }

  textBursts(chunks: string[], burstSize: number, intervalMs: number): void {
    this.#script(this.#steps).textBursts(chunks, burstSize, intervalMs);
  }

  textChunksWithUsage(chunks: string[], delayMs: number, outputTokens: number): void {
    this.#script(this.#steps).textChunksWithUsage(chunks, delayMs, outputTokens);
  }

  reasoningAndTextChunks(reasoningChunks: string[], chunks: string[], delayMs: number): void {
    this.#script(this.#steps).reasoningAndTextChunks(reasoningChunks, chunks, delayMs);
  }

  tool(name: string, input: unknown): void {
    this.#script(this.#steps).tool(name, input);
  }

  toolInputChunks(name: string, chunks: string[], delayMs: number): void {
    this.#script(this.#steps).toolInputChunks(name, chunks, delayMs);
  }

  toolWithText(name: string, input: unknown, preambleChunks: string[], delayMs: number): void {
    this.#script(this.#steps).toolWithText(name, input, preambleChunks, delayMs);
  }

  toolsWithText(
    calls: Array<{ name: string; input: unknown }>,
    preambleChunks: string[],
    delayMs: number,
  ): void {
    this.#script(this.#steps).toolsWithText(calls, preambleChunks, delayMs);
  }

  toolsWithReasoningAndText(
    calls: Array<{ name: string; input: unknown }>,
    reasoningChunks: string[],
    preambleChunks: string[],
    delayMs: number,
  ): void {
    this.#script(this.#steps).toolsWithReasoningAndText(
      calls,
      reasoningChunks,
      preambleChunks,
      delayMs,
    );
  }

  error(status: number, body: unknown): void {
    this.#script(this.#steps).error(status, body);
  }

  route(marker: string, arrange: (script: TestLLMScript) => void): void {
    if (!marker.trim()) throw new Error("Test LLM route marker must not be empty");
    if (this.#routes.has(marker)) throw new Error(`Test LLM route '${marker}' is already defined`);
    const steps: Step[] = [];
    arrange(this.#script(steps));
    if (steps.length === 0) throw new Error(`Test LLM route '${marker}' has no scripted responses`);
    this.#routes.set(marker, steps);
  }

  fixture(path: string, body: string, contentType = "text/plain; charset=utf-8"): string {
    const normalized = path.startsWith("/") ? path : `/${path}`;
    this.#fixtures.set(normalized, { body, contentType });
    return new URL(normalized, this.url).toString();
  }

  scriptedCalls(): number {
    return this.#scriptedCalls;
  }

  async waitForCalls(count: number, timeoutMs = 30_000): Promise<void> {
    if (this.#scriptedCalls >= count) return;
    await new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        count,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.#waiters = this.#waiters.filter((entry) => entry !== waiter);
          reject(
            new Error(
              `Timed out waiting for ${count} scripted model requests; received ${this.#scriptedCalls}`,
            ),
          );
        }, timeoutMs),
      };
      this.#waiters.push(waiter);
    });
  }

  pendingResponses(): number {
    return (
      this.#steps.length +
      [...this.#routes.values()].reduce((total, steps) => total + steps.length, 0)
    );
  }

  close(): Promise<void> {
    return (this.#closing ??= this.#close().finally(() => {
      this.#closing = null;
    }));
  }

  async #close(): Promise<void> {
    for (const waiter of this.#waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error("Test LLM stopped before the expected requests arrived"));
    }
    this.#waiters = [];
    this.#abort.abort();
    const stopped = new Promise<void>(
      (resolve) => this.#server?.close(() => resolve()) ?? resolve(),
    );
    this.#server?.closeAllConnections();
    await stopped;
    await Promise.all(this.#active);
    this.#server = null;
  }

  #notify(): void {
    const ready = this.#waiters.filter((waiter) => this.#scriptedCalls >= waiter.count);
    this.#waiters = this.#waiters.filter((waiter) => this.#scriptedCalls < waiter.count);
    for (const waiter of ready) {
      clearTimeout(waiter.timer);
      waiter.resolve();
    }
  }

  #route(body: Record<string, unknown>): string | null {
    const serialized = JSON.stringify(body);
    const matches = [...this.#routes.keys()].filter((marker) => serialized.includes(marker));
    if (matches.length > 1) {
      throw new Error(`Model request matched multiple scripted routes: ${matches.join(", ")}`);
    }
    return matches[0] ?? null;
  }

  #script(steps: Step[]): TestLLMScript {
    return {
      text(value) {
        steps.push({
          type: "text",
          chunks: [value],
          reasoningChunks: [],
          delayMs: 0,
          outputTokens: 0,
        });
      },
      textChunks(chunks, delayMs) {
        steps.push({ type: "text", chunks, reasoningChunks: [], delayMs, outputTokens: 0 });
      },
      textBursts(chunks, burstSize, intervalMs) {
        if (!Number.isSafeInteger(burstSize) || burstSize <= 0) {
          throw new RangeError("Test LLM burst size must be a positive safe integer");
        }
        // Node clamps overflowing timer delays to 1ms, which would silently erase pacing.
        if (!Number.isFinite(intervalMs) || intervalMs < 0 || intervalMs > 2_147_483_647) {
          throw new RangeError("Test LLM burst interval must be between 0 and 2147483647ms");
        }
        steps.push({
          type: "text",
          chunks: [...chunks],
          reasoningChunks: [],
          delayMs: 0,
          outputTokens: 0,
          burst: { size: burstSize, intervalMs },
        });
      },
      textChunksWithUsage(chunks, delayMs, outputTokens) {
        steps.push({ type: "text", chunks, reasoningChunks: [], delayMs, outputTokens });
      },
      reasoningAndTextChunks(reasoningChunks, chunks, delayMs) {
        steps.push({ type: "text", chunks, reasoningChunks, delayMs, outputTokens: 0 });
      },
      tool(name, input) {
        steps.push({
          type: "tool",
          calls: [{ name, input }],
          preambleChunks: [],
          reasoningChunks: [],
          delayMs: 0,
        });
      },
      toolInputChunks(name, chunks, delayMs) {
        // Fail during arrangement, before starting a real OpenCode turn.
        const input = JSON.parse(chunks.join("")) as unknown;
        steps.push({
          type: "tool",
          calls: [{ name, input, inputChunks: [...chunks] }],
          preambleChunks: [],
          reasoningChunks: [],
          delayMs,
        });
      },
      toolWithText(name, input, preambleChunks, delayMs) {
        steps.push({
          type: "tool",
          calls: [{ name, input }],
          preambleChunks,
          reasoningChunks: [],
          delayMs,
        });
      },
      toolsWithText(calls, preambleChunks, delayMs) {
        steps.push({ type: "tool", calls, preambleChunks, reasoningChunks: [], delayMs });
      },
      toolsWithReasoningAndText(calls, reasoningChunks, preambleChunks, delayMs) {
        steps.push({ type: "tool", calls, preambleChunks, reasoningChunks, delayMs });
      },
      error(status, body) {
        steps.push({ type: "http-error", status, body });
      },
    };
  }

  async #readBody(request: import("node:http").IncomingMessage): Promise<Record<string, unknown>> {
    let value = "";
    for await (const chunk of request) value += String(chunk);
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
}
