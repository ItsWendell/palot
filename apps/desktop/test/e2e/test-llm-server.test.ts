// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { TestLLMServer } from "./test-llm-server";

// Observe actual abortable waits without replacing the HTTP server or its clock.
vi.mock("node:timers/promises", { spy: true });

const servers: TestLLMServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  vi.clearAllMocks();
});

describe.each(["chat/completions", "responses"] as const)("text bursts on %s", (endpoint) => {
  it.each([
    { burstSize: 1, intervalMs: 20, count: 3 },
    { burstSize: 16, intervalMs: 320, count: 35 },
    { burstSize: 16, intervalMs: 0, count: 3 },
    { burstSize: 16, intervalMs: 20, count: 0 },
  ])(
    "preserves individual deltas and content-only pacing: %j",
    async ({ burstSize, intervalMs, count }) => {
      const server = new TestLLMServer();
      servers.push(server);
      await server.start();
      const chunks = Array.from({ length: count }, (_, index) =>
        index === 1 ? "" : `chunk ${index}: "quoted" 🌲\n`,
      );
      const expected = [...chunks];
      if (endpoint === "responses") {
        server.route("[BURSTS]", (script) => script.textBursts(chunks, burstSize, intervalMs));
      } else {
        server.textBursts(chunks, burstSize, intervalMs);
      }
      chunks.fill("mutated");
      chunks.push("not scripted");
      const response = await fetch(`${server.url}/${endpoint}`, {
        method: "POST",
        body: JSON.stringify({
          model: "test-model",
          [endpoint === "responses" ? "input" : "messages"]: [
            { role: "user", content: "[BURSTS]" },
          ],
        }),
      });
      expect(response.headers.get("content-type")).toBe("text/event-stream");
      const body = await response.text();
      expect(body.endsWith("data: [DONE]\n\n")).toBe(true);
      const events = body
        .split("\n\n")
        .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
        .map((line) => JSON.parse(line.slice(6)));
      const deltas: string[] = events.flatMap((event) => {
        const value =
          endpoint === "responses"
            ? event.type === "response.output_text.delta"
              ? event.delta
              : undefined
            : event.choices[0].delta.content;
        return typeof value === "string" ? [value] : [];
      });
      expect(deltas).toEqual(expected);
      expect(deltas.join("")).toBe(expected.join(""));
      expect(server.emissions.map((emission) => emission.payload)).toEqual(events);
      const openingEnvelopes = endpoint === "responses" ? 2 : 1;
      expect(events).toHaveLength(count + (endpoint === "responses" ? 4 : 2));
      if (endpoint === "responses") {
        expect(events.at(-1).type).toBe("response.completed");
        expect(events.map((event) => event.sequence_number)).toEqual(
          Array.from({ length: events.length }, (_, index) => index + 1),
        );
      } else {
        expect(events.at(-1).choices[0].finish_reason).toBe("stop");
      }
      const waits = vi.mocked(sleep).mock.calls;
      expect(waits).toHaveLength(intervalMs > 0 ? Math.ceil(count / burstSize) : 0);
      expect(waits.every(([delay, , options]) => delay === intervalMs && options?.signal)).toBe(
        true,
      );
      // Lower bounds only: a loaded CI machine may delay writes arbitrarily. Together
      // with the exact wait count, these prove the envelopes do not shift the groups.
      for (let end = Math.min(burstSize, count); end > 0; end = Math.min(end + burstSize, count)) {
        const last = server.emissions[openingEnvelopes + end - 1]!;
        const next = server.emissions[openingEnvelopes + end]!;
        expect(next.at - last.at).toBeGreaterThanOrEqual(intervalMs * 0.75);
        if (end === count) break;
      }
      expect(server.pendingResponses()).toBe(0);
    },
  );

  it.each(["server close", "client abort"] as const)(
    "cancels a pending burst interval on %s",
    async (mode) => {
      const server = new TestLLMServer();
      servers.push(server);
      await server.start();
      server.textBursts(["first", "second", "never emitted"], 2, 60_000);
      server.text("next response");
      const abort = new AbortController();
      const response = await fetch(`${server.url}/${endpoint}`, {
        method: "POST",
        body: JSON.stringify({ model: "test-model", messages: [], input: [] }),
        signal: abort.signal,
      });
      const drained = response.text().catch(() => undefined);
      const openingEnvelopes = endpoint === "responses" ? 2 : 1;
      expect(server.emissions).toHaveLength(openingEnvelopes + 2);
      const wait = vi.mocked(sleep).mock.results[0]!.value;
      const cancelled = expect(wait).rejects.toMatchObject({ name: "AbortError" });
      if (mode === "server close") await server.close();
      else abort.abort();
      await cancelled;
      await drained;
      expect(server.emissions).toHaveLength(openingEnvelopes + 2);
      expect(server.pendingResponses()).toBe(1);
      if (mode === "server close") await server.start();
      const next = await fetch(`${server.url}/${endpoint}`, {
        method: "POST",
        body: JSON.stringify({ model: "test-model", messages: [], input: [] }),
      });
      expect(await next.text()).toContain("next response");
      expect(server.pendingResponses()).toBe(0);
    },
  );
});

describe("text burst validation", () => {
  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid burst size %s before queuing",
    (size) => {
      const server = new TestLLMServer();
      expect(() => server.textBursts(["text"], size, 20)).toThrow(RangeError);
      expect(server.pendingResponses()).toBe(0);
    },
  );

  it.each([-1, NaN, Infinity, 2_147_483_648])(
    "rejects invalid interval %s before queuing",
    (interval) => {
      const server = new TestLLMServer();
      expect(() =>
        server.route("[BAD]", (script) => script.textBursts(["text"], 16, interval)),
      ).toThrow(RangeError);
      expect(server.pendingResponses()).toBe(0);
    },
  );
});

describe("TestLLMServer routed scripts", () => {
  it.each(["chat/completions", "responses"] as const)(
    "handles upstream title generation without consuming a scripted response on %s",
    async (endpoint) => {
      const server = new TestLLMServer();
      servers.push(server);
      await server.start();
      server.text("Scripted task response");
      const title = "You are a title generator. You output ONLY a thread title. Nothing else.";
      const request = (input: Record<string, unknown>) =>
        fetch(`${server.url}/${endpoint}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model: "test-model", ...input }),
        });
      const response = await request(
        endpoint === "responses"
          ? { instructions: title, input: [{ role: "user", content: "A test task" }] }
          : {
              messages: [
                { role: "system", content: title },
                { role: "user", content: "A test task" },
              ],
            },
      );
      expect(await response.text()).toContain("E2E Title");
      expect(server.scriptedCalls()).toBe(0);
      // A user quoting title instructions is still an ordinary scripted model request.
      const ordinary = await request(
        endpoint === "responses"
          ? { input: [{ role: "user", content: title }] }
          : { messages: [{ role: "user", content: title }] },
      );
      expect(await ordinary.text()).toContain("Scripted task response");
      expect(server.scriptedCalls()).toBe(1);
    },
  );

  it.each(["chat/completions", "responses"] as const)(
    "streams exact partial tool arguments before completion on %s",
    async (endpoint) => {
      const server = new TestLLMServer();
      servers.push(server);
      await server.start();
      const input = {
        patchText: '*** Begin Patch\n*** Add File: sample.txt\n+"quoted" 🌲\n*** End Patch',
      };
      const serialized = JSON.stringify(input);
      // Split inside a JSON newline escape, then inside a quoted content string.
      const escape = serialized.indexOf("\\n") + 1;
      const quote = serialized.indexOf('\\"') + 1;
      const chunks = [
        serialized.slice(0, escape),
        serialized.slice(escape, quote),
        serialized.slice(quote, quote + 5),
        serialized.slice(quote + 5),
      ];
      if (endpoint === "responses") {
        server.route("[PATCH]", (script) => script.toolInputChunks("patch", chunks, 25));
      } else {
        server.toolInputChunks("patch", chunks, 25);
      }
      const response = await fetch(`${server.url}/${endpoint}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "test-model",
          messages: [{ role: "user", content: "[PATCH]" }],
        }),
      });
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let body = "";
      const firstDelta = JSON.stringify(chunks[0]);
      while (!body.includes(firstDelta)) {
        const next = await reader.read();
        expect(next.done).toBe(false);
        body += decoder.decode(next.value, { stream: true });
      }
      expect(body).not.toContain('"finish_reason":"tool_calls"');
      expect(body).not.toContain('"type":"response.completed"');
      expect(body).not.toContain(JSON.stringify(chunks.at(-1)));
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        body += decoder.decode(next.value, { stream: true });
      }
      const events = body
        .split("\n\n")
        .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
        .map((line) => JSON.parse(line.slice(6)));
      const deltas: string[] =
        endpoint === "responses"
          ? events
              .filter((event) => event.type === "response.function_call_arguments.delta")
              .map((event) => event.delta)
          : events.flatMap((event) =>
              (event.choices?.[0]?.delta.tool_calls ?? []).flatMap(
                (call: { function: { arguments?: string } }) =>
                  call.function.arguments ? [call.function.arguments] : [],
              ),
            );
      expect(deltas).toEqual(chunks);
      expect(JSON.parse(deltas.join(""))).toEqual(input);
      if (endpoint === "responses") {
        expect(
          events.find((event) => event.type === "response.output_item.done").item,
        ).toMatchObject({
          name: "patch",
          arguments: serialized,
          status: "completed",
        });
        expect(events.at(-1).type).toBe("response.completed");
        expect(events.map((event) => event.sequence_number)).toEqual(
          Array.from({ length: events.length }, (_, index) => index + 1),
        );
      } else {
        expect(events.at(-1).choices[0].finish_reason).toBe("tool_calls");
      }
      expect(server.pendingResponses()).toBe(0);
    },
  );

  it("rejects malformed streamed input before queuing a response", () => {
    const server = new TestLLMServer();
    expect(() => server.toolInputChunks("patch", ['{"patchText":'], 30)).toThrow(SyntaxError);
    expect(server.pendingResponses()).toBe(0);
  });

  it("cancels delayed emissions promptly and can restart with its remaining script", async () => {
    const server = new TestLLMServer();
    servers.push(server);
    await server.start();
    server.textChunks(
      Array.from({ length: 100 }, () => "slow"),
      20,
    );
    server.text("after restart");
    const request = () =>
      fetch(`${server.url}/chat/completions`, {
        method: "POST",
        body: JSON.stringify({ model: "test-model", messages: [] }),
      });
    const response = await request();
    const drained = response.text().catch(() => undefined);
    await sleep(30);
    const started = performance.now();
    await Promise.all([server.close(), server.close()]);
    expect(performance.now() - started).toBeLessThan(500);
    await drained;
    const emissions = server.emissions.length;
    expect(emissions).toBeGreaterThan(0);
    await sleep(80);
    expect(server.emissions).toHaveLength(emissions);
    await server.start();
    expect(await (await request()).text()).toContain("after restart");
    expect(server.scriptedCalls()).toBe(2);
    expect(server.pendingResponses()).toBe(0);
  });

  it("leaves no delayed-stream timers keeping a closed server's process alive", () => {
    const source = `
      import { TestLLMServer } from ${JSON.stringify(new URL("./test-llm-server.ts", import.meta.url).href)};
      const server = new TestLLMServer();
      await server.start();
      server.textChunks(Array.from({length: 100}, () => 'slow'), 1000);
      const response = await fetch(server.url + '/chat/completions', { method: 'POST', body: JSON.stringify({messages: []}) });
      const body = response.text().catch(() => undefined);
      await server.close();
      await body;
      console.log('CLOSED');
    `;
    const result = spawnSync(
      process.execPath,
      ["--experimental-strip-types", "--input-type=module", "-e", source],
      {
        encoding: "utf8",
        timeout: 3_000,
      },
    );
    expect(result.stdout).toContain("CLOSED");
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
  });

  it("keeps parallel requests on their matching script", async () => {
    const server = new TestLLMServer();
    servers.push(server);
    await server.start();
    server.route("[ROUTE_ALPHA]", (script) => {
      script.textChunks(["ALPHA-1", "ALPHA-2"], 5);
    });
    server.route("[ROUTE_BETA]", (script) => {
      script.textChunks(["BETA-1", "BETA-2"], 0);
    });

    const request = (marker: string) =>
      fetch(`${server.url}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "test-model",
          messages: [{ role: "user", content: marker }],
        }),
      }).then((response) => response.text());
    const [alpha, beta] = await Promise.all([request("[ROUTE_ALPHA]"), request("[ROUTE_BETA]")]);

    expect(alpha).toContain("ALPHA-1");
    expect(alpha).not.toContain("BETA-1");
    expect(beta).toContain("BETA-1");
    expect(beta).not.toContain("ALPHA-1");
    expect(server.requests.map((entry) => entry.route).toSorted()).toEqual([
      "[ROUTE_ALPHA]",
      "[ROUTE_BETA]",
    ]);
    expect(server.pendingResponses()).toBe(0);
  });

  it("can report deterministic output usage for response fixtures", async () => {
    const server = new TestLLMServer();
    servers.push(server);
    await server.start();
    server.textChunksWithUsage(["usage"], 0, 12);
    server.textChunksWithUsage(["usage"], 0, 12);
    const chatBody = await fetch(`${server.url}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "test-model", messages: [] }),
    }).then((response) => response.text());
    const body = await fetch(`${server.url}/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "test-model", input: [] }),
    }).then((response) => response.text());
    expect(body).toContain('"output_tokens":12');
    expect(body).toContain('"total_tokens":12');
    expect(chatBody).toContain('"completion_tokens":12');
    expect(chatBody).toContain('"total_tokens":12');
  });
});
