import { parseArgs } from "node:util";

export const demoHelp = `Usage: bun run demo [--smoke] [--keep]

Build and run the isolated demo-workspace scenario with a scripted local model.
Development only: never launches a packaged app or uses your real sessions.
By default, show an inactive window and keep it open for inspection until Ctrl-C.
Uses the host display (including Linux); does not enable showcase or native glass.

Options:
  --help   Show this help without building or launching
  --smoke  Run the bounded scenario hidden and exit instead of waiting
  --keep   Keep successful run artifacts (failures are always retained)

Requires the same local Node, Bun, Electron, and OpenCode setup as test:e2e.
Set OPENCODE_BIN to the pinned OpenCode executable if it is not on PATH.
Streams finish in about three minutes; rerun to reset. This is not a real model.
Interactive runs copy the most recently saved local Palot appearance, including
its Omarchy palette. Set PALOT_DEMO_APPEARANCE to a specific appearance.json
to choose another profile. --smoke stays independent of personal appearance.
Ctrl-C or SIGTERM uses the E2E runner's awaited isolated-process cleanup.

Examples:
  bun run demo
  bun run demo --smoke
  bun run demo --smoke --keep`;

export function parseDemoArgs(args: string[]): { help: boolean; e2eArgs: string[] } {
  // Bun can forward the root script's separator to this Node entry point.
  const { values } = parseArgs({
    args: args[0] === "--" ? args.slice(1) : args,
    strict: true,
    allowPositionals: false,
    options: {
      help: { type: "boolean" },
      smoke: { type: "boolean" },
      keep: { type: "boolean" },
    },
  });
  return {
    help: values.help ?? false,
    e2eArgs: [
      "demo-workspace",
      ...(values.smoke ? [] : ["--visible", "--inspect"]),
      ...(values.keep ? ["--keep"] : []),
    ],
  };
}
