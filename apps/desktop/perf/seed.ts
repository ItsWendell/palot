// Seeds six long tasks (alpha … zeta, 12 turns each, like the session-switch-performance E2E scenario) into
// LIVE, then copies LIVE to TEMPLATE. Run once: `bun perf/seed.ts`. The fixture restores TEMPLATE every block.
import { execFileSync } from "node:child_process";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { OpenCode } from "@opencode/client";
import { Service } from "@opencode/client/service";
import { TestLLMServer } from "../test/e2e/test-llm-server.ts";
import {
  LIVE,
  OPENCODE_BIN,
  PROJECT,
  SEED_LLM_URL_FILE,
  SESSIONS_FILE,
  STATE_HOME,
  TASKS,
  TEMPLATE,
  openCodeEnvironment,
} from "./environment.ts";

const TURNS = 12;

function transcript(label: string, turn: number): string {
  const rows = Array.from(
    { length: 16 },
    (_, i) => `| ${i + 1} | ${label} row ${i + 1} | \`${i * 17}\` |`,
  );
  return [
    turn === 0 ? `${label} START` : `${label} turn ${turn}`,
    ...(turn === 6
      ? [
          `## ${label} long transcript`,
          "| # | Row | Code |\n| - | - | - |\n" + rows.join("\n"),
          "```ts\n" +
            Array.from({ length: 40 }, (_, i) => `const value${i} = ${i} * 2`).join("\n") +
            "\n```",
        ]
      : []),
    ...Array.from(
      { length: 25 },
      (_, i) =>
        `${label} ${String(turn).padStart(2, "0")}.${String(i).padStart(2, "0")} with **bold**, \`code\` and a [link](https://example.com/${i}).`,
    ),
    turn === TURNS - 1 ? `${label} END` : `${label} turn ${turn} complete`,
  ].join("\n\n");
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

await rm(LIVE, { recursive: true, force: true });
await mkdir(PROJECT, { recursive: true });
execFileSync("git", ["init", "--quiet"], { cwd: PROJECT });

const llm = new TestLLMServer();
await llm.start();
for (const label of TASKS)
  for (let turn = 0; turn < TURNS; turn += 1) llm.text(transcript(label.toUpperCase(), turn));

const file = path.join(STATE_HOME, "opencode/service.json");
const environment = openCodeEnvironment(llm.url);
const endpoint = await Service.ensure({
  file,
  command: [OPENCODE_BIN, "serve", "--service", `--port=${await freePort()}`],
  env: { ...process.env, ...environment } as Record<string, string>,
});
try {
  const client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) });
  const sessions: Record<string, string> = {};
  for (const label of TASKS) {
    const session = await client.session.create({ location: { directory: PROJECT } });
    await client.session.update({ sessionID: session.id, title: `Strobe ${label}` });
    for (let turn = 0; turn < TURNS; turn += 1) {
      await client.session.prompt({ sessionID: session.id, text: `Populate ${label} ${turn}.` });
      await client.experimental.session.wait({ sessionID: session.id });
    }
    sessions[label] = session.id;
  }
  await writeFile(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
  await writeFile(SEED_LLM_URL_FILE, llm.url);
  console.log("seeded", sessions);
} finally {
  await Service.stop({ file });
  await llm.close();
}
await rm(path.join(STATE_HOME, "opencode/service.json"), { force: true });
await rm(TEMPLATE, { recursive: true, force: true });
await cp(LIVE, TEMPLATE, { recursive: true });
console.log(`template: ${TEMPLATE}`);
