// strobe fixture: restores the seeded template and runs OpenCode on strobe's port in the foreground, so strobe owns
// it for the block, with a live scripted model that streams numbered replies of one kind (environment.ts).
// Usage (from a bench file): bun fixture.ts --port {port} [--replies markdown|steady|burst]
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, rm } from "node:fs/promises";
import { TestLLMServer } from "../test/e2e/test-llm-server.ts";
import {
  LIVE,
  OPENCODE_BIN,
  REPLY_KINDS,
  type ReplyKind,
  STREAM_REPLIES,
  TEMPLATE,
  openCodeEnvironment,
  replyLine,
  streamEnd,
} from "./environment.ts";

const flag = (name: string) =>
  process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined;
const port = flag("--port");
if (!port || !/^\d+$/.test(port)) throw new Error("fixture.ts needs --port <port>");
const kind = (flag("--replies") ?? "markdown") as ReplyKind;
if (!REPLY_KINDS.includes(kind)) throw new Error(`--replies takes ${REPLY_KINDS.join(", ")}`);

/** About 2 s per reply: 80 Markdown deltas 25 ms apart, then the reply's marker. */
function markdownReply(index: number): string[] {
  const deltas = Array.from({ length: 80 }, (_, i) =>
    i % 20 === 0
      ? `\n\n## Section ${i / 20 + 1}\n\n`
      : i % 7 === 0
        ? `\n\n| a | b |\n| - | - |\n| ${i} | \`${i * 3}\` |\n\n`
        : `Streamed **delta** ${i} with \`code\` and a [link](https://example.com/${i}). `,
  );
  return [...deltas, `\n\n${streamEnd(index)}`];
}

/** 384 deltas (about 7.7 s): 383 numbered paragraphs, then the reply's marker, as batch-input-performance has. */
function numberedReply(index: number): string[] {
  const lines = Array.from(
    { length: 383 },
    (_, i) =>
      `${replyLine(index, i)} Numbered text keeps ordering observable while the composer receives real keyboard input.\n\n`,
  );
  return [...lines, streamEnd(index)];
}

// First use on this machine (or after the template was removed): seed it, about a minute.
if (!existsSync(TEMPLATE)) await import("./seed.ts");
await rm(LIVE, { recursive: true, force: true });
await cp(TEMPLATE, LIVE, { recursive: true });

const llm = new TestLLMServer();
await llm.start();
for (let index = 1; index <= STREAM_REPLIES; index += 1) {
  if (kind === "markdown") llm.textChunks(markdownReply(index), 25);
  else if (kind === "steady") llm.textChunks(numberedReply(index), 20);
  else llm.textBursts(numberedReply(index), 16, 16 * 20);
}

// A numbered reply is about 10k tokens: the default window holds only some of them, then OpenCode compacts.
const context = kind === "markdown" ? undefined : 10_000_000;
const service = spawn(OPENCODE_BIN, ["serve", "--service", `--port=${port}`], {
  env: { ...process.env, ...openCodeEnvironment(llm.url, context) },
  stdio: "inherit",
});
const stop = () => service.kill("SIGTERM");
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
service.on("exit", async (code) => {
  await llm.close().catch(() => undefined);
  process.exit(code ?? 0);
});
