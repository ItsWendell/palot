/** Opt-in, paid-model discovery eval. Never connects to the user's shared service. */
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { OpenCode } from "@opencode/client";
import { connectClientMcp, type ClientMcpConnection } from "@opencode/client/mcp";
import { Service } from "@opencode/client/service";
import { discoveryCases, distractorCatalog, evalTools } from "../test/tool-eval/catalog";

if (process.argv.includes("--help")) {
  console.log(
    "EVAL_MODEL=provider/model [OPENCODE_BIN=/path/to/opencode2] bun run eval:tools\nUses environment provider credentials only. Optional EVAL_CONFIG is an inline OpenCode config.\nTen prompts, max 4 steps each; production tool handlers are replaced by recording dry runs.\nWrites owner-only JSON under the primary checkout's .local/evals/.",
  );
} else {
  await main();
}

async function main() {
  const model = process.env.EVAL_MODEL;
  if (!model || !model.includes("/"))
    throw new Error("Set EVAL_MODEL=provider/model (see --help).");
  const version = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"))
    .devDependencies["@opencode/client"] as string;
  const binary = process.env.OPENCODE_BIN ?? path.join(homedir(), ".bun/bin/opencode2");
  if (
    !execFileSync(binary, ["--version"], { encoding: "utf8", timeout: 5000 })
      .split(/\s+/)
      .includes(`v${version}`)
  )
    throw new Error(`OPENCODE_BIN must be OpenCode ${version}.`);
  const primary = path.dirname(
    execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
      encoding: "utf8",
    }).trim(),
  );
  const root = path.join(primary, ".local/evals");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const runRoot = await mkdtemp(path.join(root, "tools-"));
  const home = path.join(runRoot, "home");
  const directory = path.join(home, "project");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = path.join(home, ".local/state/opencode/service.json");
  const config = {
    ...JSON.parse(process.env.EVAL_CONFIG ?? "{}"),
    model,
    agents: {
      eval: {
        mode: "primary",
        steps: 4,
        system:
          "Carry out the user's request with the available tools. Stop after the requested action, not after prerequisite reads. Do not use shell or file tools. " +
          "Fixture context: the current task's work is complete; the other task is ses_eval_other; the scheduled automation is aut_eval. " +
          "The linked PR is https://github.com/example/project/pull/7. The current branch is pushed, base main, title Eval change, body Evaluation fixture. " +
          "A reminder should ask to check the build. Local time zone is UTC.",
      },
    },
  };
  const env = Object.fromEntries(
    Object.entries({
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: path.join(home, ".config"),
      XDG_DATA_HOME: path.join(home, ".local/share"),
      XDG_STATE_HOME: path.join(home, ".local/state"),
      XDG_CACHE_HOME: path.join(home, ".cache"),
      OPENCODE_TEST_HOME: home,
      OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
      OPENCODE_AUTH_CONTENT: "{}",
      OPENCODE_DISABLE_PROJECT_CONFIG: "1",
      OPENCODE_PURE: "1",
      OPENCODE_DISABLE_AUTOUPDATE: "1",
    }).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  const abort = new AbortController();
  const stop = () => abort.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  const attachments: ClientMcpConnection[] = [];
  const catalogReady = new Set<string>();
  // Client-hosted servers are intentionally absent from mcp.list. Observe the published
  // helper's outbound tools/list response instead of polling that unrelated API.
  class CatalogSocket extends WebSocket {
    override send(data: Parameters<WebSocket["send"]>[0]): void {
      super.send(data);
      if (typeof data !== "string") return;
      const message = JSON.parse(data) as { result?: { tools?: unknown[] } };
      if (Array.isArray(message.result?.tools)) {
        const name = new URL(this.url).searchParams.get("name");
        if (name) catalogReady.add(name);
      }
    }
  }
  const rows: Array<{
    prompt: string;
    expected: string;
    called: string[];
    pass: boolean;
    error?: string;
  }> = [];
  let started = false;
  let current: string[] = [];
  let startupUncertain = false;
  try {
    // Explicit registration + isolated HOME/XDG, as scripts/e2e.ts. No shared service discovery.
    startupUncertain = true;
    const endpoint = await Service.ensure({
      file,
      version,
      command: [binary, "serve", "--service", "--port=0"],
      env,
    });
    started = true;
    startupUncertain = false;
    const client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) });
    attachments.push(
      connectClientMcp({
        url: endpoint.url,
        headers: Service.headers(endpoint),
        name: "palot",
        WebSocket: CatalogSocket,
        directory,
        tools: evalTools((name) => current.push(name)),
      }),
    );
    attachments.push(
      connectClientMcp({
        url: endpoint.url,
        headers: Service.headers(endpoint),
        name: "eval_distractors",
        WebSocket: CatalogSocket,
        directory,
        tools: distractorCatalog.map((tool, index) => ({
          name: `${tool.path.replaceAll(/[^a-zA-Z0-9_-]/g, "_")}_${index}`,
          description: tool.description,
          inputSchema: { type: "object" },
          handler: () => {
            current.push(tool.path);
            return { content: [{ type: "text", text: "Dry-run recorded." }] };
          },
        })),
      }),
    );
    for (let attempt = 0; attempt < 100; attempt++) {
      if (catalogReady.size >= 2) break;
      if (attempt === 99) throw new Error("Client-hosted eval tools did not connect.");
      await delay(100, undefined, { signal: abort.signal });
    }
    const cases = [0, 4, 8, 10, 14, 18, 20, 24, 26, 29].map((index) => discoveryCases[index]!);
    for (const [prompt, expected] of cases) {
      abort.signal.throwIfAborted();
      current = [];
      const session = await client.session.create({
        location: { directory },
        agent: "eval",
        permissions: [
          { action: "*", resource: "*", effect: "deny" },
          { action: "execute", resource: "*", effect: "allow" },
          { action: "palot_*", resource: "*", effect: "allow" },
          { action: "eval_distractors_*", resource: "*", effect: "allow" },
        ],
      });
      const timeout = AbortSignal.any([abort.signal, AbortSignal.timeout(90_000)]);
      let error: string | undefined;
      try {
        await client.session.prompt({ sessionID: session.id, text: prompt }, { signal: timeout });
        await client.experimental.session.wait({ sessionID: session.id }, { signal: timeout });
      } catch {
        // Provider error text may contain credentials or request headers. Do not print/store it.
        error = "Model request failed or timed out; inspect isolated service logs privately.";
        await client.session.interrupt({ sessionID: session.id }).catch(() => {});
      }
      rows.push({
        prompt,
        expected,
        called: [...current],
        pass: current.includes(expected),
        ...(error ? { error } : {}),
      });
      if (error) break;
    }
  } finally {
    await Promise.allSettled(attachments.map((connection) => connection.close()));
    if (started) await Service.stop({ file });
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    const output = path.join(runRoot, "results.json");
    await writeFile(
      output,
      JSON.stringify({ model, version, dryRun: true, startupUncertain, rows }, null, 2),
      { mode: 0o600 },
    );
    console.table(
      rows.map((row) => ({
        prompt: row.prompt,
        expected: row.expected,
        called: row.called.join(", "),
        result: row.pass ? "PASS" : "FAIL",
      })),
    );
    console.log(output);
    if (startupUncertain)
      console.error(
        "Service startup failed before returning an endpoint. Unregistered contender cleanup cannot be verified; shared service was not touched.",
      );
  }
  if (rows.length !== 10 || rows.some((row) => !row.pass || row.error)) process.exitCode = 1;
}
