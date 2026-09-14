import { fileURLToPath } from "node:url";
import { demoHelp, parseDemoArgs } from "./demo-cli.ts";

let options: ReturnType<typeof parseDemoArgs>;
try {
  options = parseDemoArgs(process.argv.slice(2));
} catch (error) {
  console.error(`Palot demo: ${error instanceof Error ? error.message : String(error)}`);
  console.error("Usage: bun run demo [--smoke] [--keep]. Use --help for examples.");
  process.exit(1);
}

if (options.help) {
  console.log(demoHelp);
} else {
  // Run in this process so E2ERun owns SIGINT/SIGTERM and awaits cleanup.
  // A forwarding child wrapper could exit before its isolated service is stopped.
  process.argv = [
    process.execPath,
    fileURLToPath(new URL("./e2e.ts", import.meta.url)),
    ...options.e2eArgs,
  ];
  await import("./e2e.ts");
}
