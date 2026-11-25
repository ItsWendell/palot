// Shared paths and OpenCode settings for the strobe benchmarks. The seeded OpenCode data stores absolute
// paths (the project folder, its database), so every block restores the template at the same place.
import path from "node:path";
import { findOpenCodeBinarySync, primaryCheckoutSync } from "../scripts/opencode-binary.ts";

// /var/tmp survives reboots and doesn't depend on HOME, which strobe gives each launch and fixture of its own.
export const ROOT = process.env.PALOT_STROBE_ROOT ?? "/var/tmp/palot-strobe";
export const LIVE = path.join(ROOT, "live");
export const TEMPLATE = path.join(ROOT, "template");
export const HOME = path.join(LIVE, "home");
export const PROJECT = path.join(LIVE, "project");
export const STATE_HOME = path.join(HOME, ".local/state");
export const SESSIONS_FILE = path.join(LIVE, "sessions.json");
// strobe gives the fixture its own HOME, so the primary checkout comes from this file's repository.
export const OPENCODE_BIN = findOpenCodeBinarySync({
  primaryCheckout: primaryCheckoutSync(import.meta.dirname),
});

/**
 * OpenCode's settings for the scripted model at `llmUrl`. `context` is the model's context window in tokens: the
 * fixture raises it for long replies, whose history would pass the default within a block and start a compaction.
 */
export function openCodeEnvironment(llmUrl: string, context = 100_000): Record<string, string> {
  return {
    HOME,
    XDG_CONFIG_HOME: path.join(HOME, ".config"),
    XDG_DATA_HOME: path.join(HOME, ".local/share"),
    XDG_STATE_HOME: STATE_HOME,
    XDG_CACHE_HOME: path.join(HOME, ".cache"),
    OPENCODE_TEST_HOME: HOME,
    OPENCODE_CONFIG_CONTENT: JSON.stringify({
      formatter: false,
      lsp: false,
      model: "test/test-model",
      permission: { "*": "allow" },
      provider: {
        test: {
          name: "Test",
          id: "test",
          env: [],
          npm: "@ai-sdk/openai-compatible",
          models: {
            "test-model": {
              id: "test-model",
              name: "Test Model",
              attachment: false,
              reasoning: false,
              temperature: false,
              tool_call: true,
              release_date: "2025-01-01",
              limit: { context, output: 10_000 },
              cost: { input: 0, output: 0 },
              options: {},
            },
          },
          options: { apiKey: "test-key", baseURL: llmUrl },
        },
      },
    }),
    OPENCODE_AUTH_CONTENT: "{}",
    OPENCODE_DISABLE_PROJECT_CONFIG: "1",
    OPENCODE_PURE: "1",
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    OPENCODE_DISABLE_AUTOCOMPACT: "1",
    OPENCODE_DISABLE_MODELS_FETCH: "1",
  };
}

export const SEED_LLM_URL_FILE = path.join(LIVE, "llm-url");

/** The seeded tasks, oldest first; each is titled "Strobe <label>". */
export const TASKS = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"] as const;

/** Streamed replies the fixture's scripted model gives, in order: each ends with its own numbered marker. */
export const STREAM_REPLIES = 400;
export const streamEnd = (index: number) => `STREAM END ${String(index).padStart(3, "0")}`;

/**
 * What the fixture's replies are (`bun fixture.ts --port {port} --replies <kind>`), one kind per bench file:
 * `markdown` (the default) is 80 Markdown deltas 25 ms apart; `steady` and `burst` are one numbered text of 384
 * deltas (the batch-input E2E profile's), 20 ms apart or in bursts of 16 every 320 ms.
 */
export const REPLY_KINDS = ["markdown", "steady", "burst"] as const;
export type ReplyKind = (typeof REPLY_KINDS)[number];

/** Line `line` of numbered reply `index`; without `line`, the text every line of that reply starts with. */
export const replyLine = (index: number, line?: number) =>
  `Reply ${String(index).padStart(3, "0")} line${line === undefined ? "" : ` ${line}.`}`;
