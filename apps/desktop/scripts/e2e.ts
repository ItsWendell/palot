/** Runs Palot against an isolated real OpenCode service and scripted local model. */

import { type ChildProcess, execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { inspect as inspectError, parseArgs, promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { OpenCode } from "@opencode/client";
import { Service } from "@opencode/client/service";
import { chromium, type Browser, type CDPSession, type Page } from "@playwright/test";
import packageJson from "../package.json" with { type: "json" };
import { isSupportedOpenCodeVersion } from "../src/main/opencode-version.ts";
import { scenarioNames, scenarios } from "../test/e2e/scenarios.ts";
import { showcaseScenarios } from "../test/e2e/showcase-scenarios.ts";
import { TestLLMServer } from "../test/e2e/test-llm-server.ts";
import { assertVideoPrerequisites, startVideoCapture } from "../test/e2e/video.ts";
import { captureShowcaseAssets } from "./showcase-assets.ts";
import { E2ERun } from "./e2e-lifecycle.ts";
import type {} from "../src/preload/api";

const execFileAsync = promisify(execFile);
const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKSPACE_ROOT = path.resolve(APP_ROOT, "../..");
const allScenarios = { ...scenarios, ...showcaseScenarios };
const { values: options, positionals } = parseCommandLine();
const EXPECTED_OPENCODE_VERSION =
  options["opencode-version"] ?? packageJson.devDependencies["@opencode/client"];
if (!isSupportedOpenCodeVersion(EXPECTED_OPENCODE_VERSION))
  throw new Error("E2E runtime overrides must be a supported stable 2.x or reviewed beta version.");
if (options.help) {
  console.log(`Usage: bun run test:e2e -- [scenario] [options]

Run an isolated native desktop scenario. Defaults to smoke, hidden, with
successful artifacts removed. Requires OpenCode ${EXPECTED_OPENCODE_VERSION}.

Options:
  --help                      Show this help without building or launching
  --list                      List scenarios without building or launching
  --visible                   Show an inactive window on your desktop
  --executable <path>         Test an already-packaged executable without rebuilding
  --opencode-version <version> Test a compatible runtime rather than the pinned baseline
  --focus                     Show and focus the window
  --keep                      Keep successful run artifacts
  --inspect                   Wait after success for inspection; Ctrl-C stops
  --inspect-on-failure        Keep an attachable failed app until Ctrl-C; exits nonzero
  --profile                   Enable performance reports; implies --visible --keep
  --video                     Record renderer video; requires ffmpeg; implies --visible --keep
  --trace                     Capture renderer trace; implies --profile
  --app-trace                 Capture whole-app trace; implies --profile
  --css-selector-stats        Collect selector statistics during the scenario
  --react-profile             Build with React profiling
  --react-scan                Enable React Scan; implies --keep
  --glass                     Enable native glass
  --renderer-opaque           Force opaque renderer chrome
  --renderer-glass            Force glass renderer chrome
  --disable-composer-backdrop Disable composer backdrop filtering
  --showcase                  Capture showcase assets; implies --glass --visible --keep

Only one of --trace, --app-trace, and --css-selector-stats may be used.
--renderer-opaque and --renderer-glass cannot be combined.
Set OPENCODE_BIN to the exact-version OpenCode executable if needed.
Uses the host display; visible windows may reflow a tiling desktop.
Video captures renderer content only (no desktop/audio), adds measurement overhead,
and is retained as video.mp4 beside video.json. It is not compositor/FPS evidence.

Examples:
  bun run test:e2e -- --list
  bun run test:e2e -- smoke
  bun run test:e2e -- smoke --visible --inspect
  bun run test:e2e -- session-switch-performance --trace --react-profile`);
  process.exit(0);
}
if (options.list) {
  for (const name of scenarioNames()) console.log(`${name}: ${scenarios[name].description}`);
  for (const [name, scenario] of Object.entries(showcaseScenarios)) {
    console.log(`${name}: ${scenario.description}`);
  }
  process.exit(0);
}
const name = positionals[0] ?? "smoke";
const trace = options.trace ?? false;
const appTrace = options["app-trace"] ?? false;
const profile = Boolean(options.profile || trace || appTrace);
const video = options.video ?? false;
const cssSelectorStats = options["css-selector-stats"] ?? false;
const reactProfile = options["react-profile"] ?? false;
const reactScan = options["react-scan"] ?? false;
const focus = options.focus ?? false;
const showcase = options.showcase ?? false;
const glass = Boolean(options.glass || showcase);
const rendererOpaque = options["renderer-opaque"] ?? false;
const rendererGlass = options["renderer-glass"] ?? false;
const disableComposerBackdrop = options["disable-composer-backdrop"] ?? false;
const visible = Boolean(options.visible || profile || focus || showcase || video);
const inactive = visible && !focus && !showcase;
const keep = Boolean(options.keep || profile || reactScan || showcase || video);
const inspect = options.inspect ?? false;
const inspectOnFailure = options["inspect-on-failure"] ?? false;
const scenario = allScenarios[name as keyof typeof allScenarios];
const packagedExecutable = options.executable ? path.resolve(options.executable) : null;
if (packagedExecutable && (profile || reactProfile || reactScan))
  throw new Error(
    "Packaged smoke checks cannot enable development-only performance instrumentation.",
  );

process.env.PALOT_REACT_SCAN = reactScan ? "1" : "0";
if (profile) process.env.PALOT_PERFORMANCE_HARNESS = "1";
if (reactProfile) process.env.PALOT_REACT_PROFILING = "1";
// Explicit non-secret run controls for report comparability. Compiler/profiling
// environment opt-ins retain their existing build semantics.
Object.assign(process.env, {
  PALOT_E2E_SCENARIO: name,
  PALOT_E2E_VIDEO: video ? "1" : "0",
  PALOT_DISABLE_GLASS: glass ? "0" : "1",
  PALOT_E2E_TRACE: trace ? "1" : "0",
  PALOT_E2E_APP_TRACE: appTrace ? "1" : "0",
  PALOT_E2E_CSS_SELECTOR_STATS: cssSelectorStats ? "1" : "0",
  PALOT_E2E_RENDERER_OPAQUE: rendererOpaque ? "1" : "0",
  PALOT_E2E_RENDERER_GLASS: rendererGlass ? "1" : "0",
  PALOT_E2E_DISABLE_COMPOSER_BACKDROP: disableComposerBackdrop ? "1" : "0",
});

let browser: Browser | null = null;
let page: Page | null = null;
let runRoot = "";
let pageWebSocketUrl: string | undefined;
let passed = false;
type VideoCapture = Awaited<ReturnType<typeof startVideoCapture>>;
let videoCapture: VideoCapture | null = null;
let videoFinalization: Promise<void> | null = null;
const finalizeVideo = (capture: VideoCapture) =>
  (videoFinalization ??= (async () => {
    const report = await capture.stop();
    await writeFile(path.join(runRoot, "video.json"), JSON.stringify(report, null, 2), {
      mode: 0o600,
    });
    console.log(`Palot renderer video: ${path.join(runRoot, "video.mp4")}`);
  })());
const llm = new TestLLMServer();
const lifecycle = new E2ERun(name, {
  hidden: !visible,
  inactive,
  profile,
  video,
  trace,
  appTrace,
  cssSelectorStats,
  reactProfile,
  reactScan,
  glass,
  rendererOpaque,
  rendererGlass,
  disableComposerBackdrop,
});

try {
  const primaryCheckout = await resolvePrimaryCheckout();
  await lifecycle.initialize(path.join(primaryCheckout, ".local/desktop-e2e"));
  runRoot = lifecycle.root;
  lifecycle.phase("prerequisites");
  const binary = await findOpenCodeBinary();
  if (video) await assertVideoPrerequisites();
  lifecycle.check();
  const electronPath = packagedExecutable ?? (createRequire(import.meta.url)("electron") as string);
  lifecycle.phase("build");
  if (packagedExecutable) await access(packagedExecutable, constants.X_OK);
  else await runBuild();
  lifecycle.phase("fixtures");
  const projectDirectory = path.join(runRoot, showcase ? "palot" : "project");
  const home = path.join(runRoot, "home");
  const palotUserData = path.join(runRoot, "palot-user-data");
  await Promise.all([
    mkdir(projectDirectory, { recursive: true }),
    mkdir(home, { recursive: true }),
    mkdir(palotUserData, { recursive: true }),
  ]);
  if (showcase) {
    await writeFile(
      path.join(palotUserData, "appearance.json"),
      JSON.stringify({
        preferences: {
          version: 3,
          mode: "dark",
          lightTheme: "macos",
          darkTheme: "macos",
          lightCodeTheme: "follow",
          darkCodeTheme: "follow",
          uiFont: "system",
          codeFont: "system",
          uiFontSize: 14,
          codeFontSize: 12,
          terminalFontSize: 13,
          lightContrast: 50,
          darkContrast: 50,
          glassOpacity: "theme",
          contentOpacity: 96,
          nativeGlassTint: "theme",
          nativeGlassVariant: "theme",
          windowMaterial: "automatic",
          sidebarMaterial: "automatic",
        },
      }),
      { mode: 0o600 },
    );
  }
  if ("prepare" in scenario && scenario.prepare) await scenario.prepare(home);
  await run("git", ["init", "--quiet"], projectDirectory);
  if ("prepareProject" in scenario && scenario.prepareProject) {
    await scenario.prepareProject({ projectDirectory, runRoot });
  }

  lifecycle.phase("model");
  await lifecycle.acquire(
    "scripted LLM",
    () => llm.start(),
    () => llm.close(),
  );
  lifecycle.discover({ llmPort: Number(new URL(llm.url).port) });
  scenario.arrange(llm);
  const [port, cdpPort] = await Promise.all([allocatePort(), allocatePort()]);
  lifecycle.discover({ servicePort: port, cdpPort });
  const xdgStateHome = path.join(home, ".local/state");
  const isolatedEnvironment = environment({
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    XDG_DATA_HOME: path.join(home, ".local/share"),
    XDG_STATE_HOME: xdgStateHome,
    XDG_CACHE_HOME: path.join(home, ".cache"),
    OPENCODE_TEST_HOME: home,
    OPENCODE_CONFIG_CONTENT: JSON.stringify(
      testConfiguration(llm.url, "modelRuntime" in scenario ? scenario.modelRuntime : undefined),
    ),
    OPENCODE_AUTH_CONTENT: "{}",
    OPENCODE_DISABLE_PROJECT_CONFIG: "1",
    OPENCODE_PURE: "1",
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    OPENCODE_DISABLE_AUTOCOMPACT: "1",
    OPENCODE_DISABLE_MODELS_FETCH: "1",
  });
  const serviceFile = path.join(xdgStateHome, "opencode/service.json");
  lifecycle.phase("service");
  // Installed Service.ensure has no AbortSignal or contender handle. Await its
  // bounded startup (120s), then stop the registration. If ensure rejects before
  // returning an endpoint, the API cannot rule out a surviving unregistered process.
  const endpoint = await lifecycle.acquire(
    "OpenCode Service.stop (isolated registration)",
    async () => {
      try {
        return await Service.ensure({
          file: serviceFile,
          version: EXPECTED_OPENCODE_VERSION,
          command: [binary, "serve", "--service", `--port=${port}`],
          env: isolatedEnvironment,
        });
      } catch (error) {
        lifecycle.uncertainCleanup(
          "Service.ensure failed before returning an endpoint. The installed SDK releases contender handles without stopping unregistered processes, and Service.stop only stops a registered process. An unregistered process may survive; cleanup cannot be verified through the public API.",
        );
        const errorLog = path.join(runRoot, "service-startup-error.log");
        await writeFile(errorLog, inspectError(error, { depth: 5 }), { mode: 0o600 }).catch(
          (logError) => console.error("Could not save service startup error:", logError),
        );
        console.error(
          `Palot E2E service evidence retained: ${errorLog}; isolated service files: ${home}`,
        );
        console.error(
          "SDK startup stdout and timeout stderr are not exposed by Service.ensure; these logs may be incomplete.",
        );
        throw error;
      }
    },
    () => Service.stop({ file: serviceFile }),
  );
  const registration = JSON.parse(await readFile(serviceFile, "utf8")) as { pid?: number };
  if (typeof registration.pid === "number") lifecycle.discover({ servicePID: registration.pid });
  lifecycle.phase("seed");
  const client = OpenCode.make({
    baseUrl: endpoint.url,
    headers: Service.headers(endpoint),
    fetch: lifecycle.fetch,
  });
  const session = await client.session.create({ location: { directory: projectDirectory } });
  const title = `Palot E2E: ${name}`;
  await client.session.rename({ sessionID: session.id, title });
  if ("seed" in scenario && scenario.seed) {
    await scenario.seed(client, { projectDirectory, runRoot });
  }

  const electronEnvironment = environment({
    ...isolatedEnvironment,
    PALOT_CONNECTION_PROFILE_ID: `e2e:${name}`,
    PALOT_DEV_INSTANCE_ID: `e2e-${process.pid}`,
    PALOT_DISABLE_GLASS: glass ? "0" : "1",
    PALOT_E2E_HIDDEN: visible ? "0" : "1",
    PALOT_E2E_INACTIVE: inactive ? "1" : "0",
    PALOT_E2E_USER_DATA: palotUserData,
    PALOT_LOG_DIR: path.join(runRoot, "logs"),
    PALOT_OPENCODE_SERVICE_PORT: String(port),
    PALOT_REMOTE_DEBUGGING_PORT: String(cdpPort),
    ...(showcase
      ? {
          PALOT_SHOWCASE: "1",
          PALOT_SHOWCASE_BACKGROUND: process.env.PALOT_SHOWCASE_BACKGROUND,
          PALOT_SHOWCASE_LAYOUT_PATH: path.join(runRoot, "showcase-layout.json"),
        }
      : {}),
  });
  delete electronEnvironment.ELECTRON_RUN_AS_NODE;
  lifecycle.phase("electron");
  const { child: electronProcess } = lifecycle.spawn(
    "electron",
    electronPath,
    packagedExecutable ? [`--remote-debugging-port=${cdpPort}`] : ["."],
    {
      cwd: APP_ROOT,
      env: electronEnvironment,
    },
  );
  await waitForCdp(cdpPort, electronProcess);
  lifecycle.phase("renderer");
  browser = await lifecycle.acquire(
    "Playwright CDP connection",
    () => chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`, { timeout: 30_000 }),
    async (connected) => {
      await connected?.close();
    },
  );
  const context = browser.contexts()[0];
  if (!context) throw new Error("Electron did not expose a browser context");
  const rendererDeadline = Date.now() + 30_000;
  while (!page && Date.now() < rendererDeadline) {
    lifecycle.check();
    page =
      context
        .pages()
        .find(
          (candidate) =>
            candidate.url() !== "about:blank" && !candidate.url().startsWith("data:text/html"),
        ) ?? null;
    if (!page) await sleep(100, undefined, { signal: lifecycle.signal });
  }
  if (!page) throw new Error("Electron did not expose the Palot renderer page");
  pageWebSocketUrl = await rendererWebSocketUrl(cdpPort);
  lifecycle.discover({ pageWebSocketUrl });
  lifecycle.phase("navigation");
  page.setDefaultTimeout(30_000);
  await page.waitForLoadState("domcontentloaded");
  if ("onboarding" in scenario && scenario.onboarding) {
    await page.getByRole("heading", { name: "Your new home for OpenCode." }).waitFor();
  } else {
    await page.evaluate(async () => {
      const profileID = (await window.palot.runtimeStatus()).profileID;
      globalThis.localStorage.setItem(
        "palot.desktop.state.onboarding.completed-profiles",
        JSON.stringify({ version: 1, value: { [profileID]: 1 } }),
      );
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.evaluate((sessionID) => {
      window.location.hash = `#/sessions/${sessionID}`;
    }, session.id);
    await page.getByLabel("Current task").waitFor();
  }
  if (rendererOpaque || rendererGlass) {
    await page.evaluate(
      (tier) => {
        document.documentElement.dataset.chromeTier = tier;
      },
      rendererOpaque ? "opaque" : "liquid-glass",
    );
  }
  if (disableComposerBackdrop) {
    await page.addStyleTag({
      content:
        ".palot-surface-backdrop[data-tone='composer'] { backdrop-filter: none !important; }",
    });
  }

  const scenarioContext = {
    visible,
    uncertainCleanup: (reason: string) => lifecycle.uncertainCleanup(reason),
    client,
    llm,
    session,
    projectDirectory,
    runRoot,
    profile,
    cssSelectorStats,
    reactProfile,
  };
  if (video) {
    videoCapture = await lifecycle.acquire(
      "renderer video",
      () => startVideoCapture(page!, runRoot, { signal: lifecycle.signal }),
      async (capture) => {
        if (capture) await finalizeVideo(capture);
      },
    );
  }
  lifecycle.phase("scenario");
  if ("run" in scenario && scenario.run) await scenario.run(page, scenarioContext);
  else await client.session.prompt({ sessionID: session.id, text: scenario.prompt });
  lifecycle.check();
  await llm.waitForCalls(scenario.expectedModelCalls);
  lifecycle.phase("assertions");
  if (trace) {
    const traceOutput = path.join(runRoot, "performance-trace.json");
    const traceSession = await page.context().newCDPSession(page);
    await startPerformanceTrace(traceSession);
    let scenarioError: unknown;
    try {
      await scenario.assert(page, scenarioContext);
    } catch (error) {
      scenarioError = error;
    }
    try {
      await stopPerformanceTrace(traceSession, traceOutput);
    } catch (error) {
      if (!scenarioError) throw error;
      console.error("Palot performance trace finalization also failed:", error);
    }
    if (scenarioError) throw scenarioError;
    console.log(`Palot performance trace: ${traceOutput}`);
  } else if (appTrace) {
    await page.evaluate(() => window.palot.performanceTraceStart());
    let scenarioError: unknown;
    try {
      await scenario.assert(page, scenarioContext);
    } catch (error) {
      scenarioError = error;
    }
    let traceOutput: string | null = null;
    try {
      traceOutput = await page.evaluate(() => window.palot.performanceTraceStop());
    } catch (error) {
      if (!scenarioError) throw error;
      console.error("Palot whole-app trace finalization also failed:", error);
    }
    if (scenarioError) throw scenarioError;
    console.log(`Palot whole-app performance trace: ${traceOutput}`);
  } else {
    await scenario.assert(page, scenarioContext);
  }
  if (llm.pendingResponses() !== 0) {
    throw new Error(`${llm.pendingResponses()} scripted model responses were not consumed`);
  }
  if (showcase) {
    await captureShowcaseAssets({
      layoutPath: path.join(runRoot, "showcase-layout.json"),
      runRoot,
      outputDirectory:
        process.env.PALOT_SHOWCASE_OUTPUT_DIRECTORY ?? path.join(WORKSPACE_ROOT, "docs/assets"),
    });
  }
  if (videoCapture) await finalizeVideo(videoCapture);
  lifecycle.pass();
  passed = true;
  console.log(`Palot E2E passed: ${name}`);
  if (inspect) {
    await lifecycle.inspect();
  }
} catch (error) {
  lifecycle.fail(error);
  process.exitCode ||= 1;
  if (runRoot && llm.requests.length > 0) {
    await writeFile(
      path.join(runRoot, "llm-requests.json"),
      JSON.stringify(llm.requests, null, 2),
      { mode: 0o600 },
    ).catch(() => undefined);
  }
  if (page && runRoot && !lifecycle.signal.aborted)
    await page
      .screenshot({ path: path.join(runRoot, "failure.png"), timeout: 5_000 })
      .catch(() => undefined);
  if (runRoot) console.error(`Palot E2E artifacts: ${runRoot}`);
  console.error(error);
  if (videoCapture) {
    await finalizeVideo(videoCapture).catch((videoError) => {
      console.error("Palot renderer video finalization failed:", videoError);
    });
  }
  if (
    inspectOnFailure &&
    !lifecycle.signal.aborted &&
    pageWebSocketUrl &&
    browser?.isConnected() &&
    page &&
    !page.isClosed()
  ) {
    await lifecycle.inspect();
  }
} finally {
  try {
    await lifecycle.close();
    if (passed && !lifecycle.failed && !lifecycle.cleanupFailed && !keep && runRoot)
      await rm(runRoot, { recursive: true, force: true });
    else if (passed && runRoot) console.log(`Palot E2E artifacts kept: ${runRoot}`);
  } finally {
    lifecycle.dispose();
  }
}

function parseCommandLine() {
  try {
    const args = process.argv.slice(2);
    // Bun forwards the root script's separator to this Node entry point.
    if (args[0] === "--") args.shift();
    const result = parseArgs({
      args,
      strict: true,
      allowPositionals: true,
      options: {
        help: { type: "boolean" },
        list: { type: "boolean" },
        trace: { type: "boolean" },
        "app-trace": { type: "boolean" },
        profile: { type: "boolean" },
        video: { type: "boolean" },
        "css-selector-stats": { type: "boolean" },
        "react-profile": { type: "boolean" },
        "react-scan": { type: "boolean" },
        focus: { type: "boolean" },
        showcase: { type: "boolean" },
        glass: { type: "boolean" },
        "renderer-opaque": { type: "boolean" },
        "renderer-glass": { type: "boolean" },
        "disable-composer-backdrop": { type: "boolean" },
        visible: { type: "boolean" },
        keep: { type: "boolean" },
        inspect: { type: "boolean" },
        "inspect-on-failure": { type: "boolean" },
        executable: { type: "string" },
        "opencode-version": { type: "string" },
      },
    });
    const { values, positionals } = result;
    if (positionals.length > 1) throw new Error("Specify only one E2E scenario");
    const name = positionals[0];
    if (name !== undefined && !Object.hasOwn(allScenarios, name)) {
      throw new Error(`Unknown E2E scenario '${name}'. Use --list to see available scenarios`);
    }
    if (
      [values.trace, values["app-trace"], values["css-selector-stats"]].filter(Boolean).length > 1
    ) {
      throw new Error("--trace, --app-trace, and --css-selector-stats cannot run together");
    }
    if (values["renderer-opaque"] && values["renderer-glass"]) {
      throw new Error("--renderer-opaque and --renderer-glass cannot run together");
    }
    if (values.help && values.list) throw new Error("--help and --list cannot run together");
    return result;
  } catch (error) {
    console.error(`Palot E2E: ${error instanceof Error ? error.message : String(error)}`);
    console.error("Usage: bun run test:e2e -- [scenario] [options]. Use --help for examples.");
    process.exit(1);
  }
}

function testConfiguration(llmUrl: string, modelRuntime?: "native-openai") {
  const nativeOpenAI = modelRuntime === "native-openai";
  const providerID = nativeOpenAI ? "openai" : "test";
  const model = `${providerID}/test-model`;
  return {
    formatter: false,
    lsp: false,
    model,
    permission: { "*": "allow" },
    agent: {
      general: {
        description: "General-purpose deterministic E2E subagent",
        mode: "subagent",
        model,
        permission: { "*": "allow" },
      },
    },
    provider: {
      [providerID]: {
        name: nativeOpenAI ? "Native OpenAI Test" : "Test",
        id: providerID,
        env: [],
        npm: nativeOpenAI ? "@ai-sdk/openai" : "@ai-sdk/openai-compatible",
        models: {
          "test-model": {
            id: "test-model",
            name: "Test Model",
            attachment: false,
            reasoning: false,
            temperature: false,
            tool_call: true,
            release_date: "2025-01-01",
            limit: { context: 100_000, output: 10_000 },
            cost: { input: 0, output: 0 },
            options: {},
          },
        },
        options: { apiKey: "test-key", baseURL: llmUrl },
      },
    },
  };
}

async function runBuild(): Promise<void> {
  await lifecycle.spawn("build", "bun", ["run", "scripts/build.ts"], {
    cwd: APP_ROOT,
    env: process.env,
  }).completed;
}

async function resolvePrimaryCheckout(): Promise<string> {
  const { stdout } = await execFileAsync(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    { cwd: WORKSPACE_ROOT, signal: lifecycle.signal },
  );
  return path.dirname(stdout.trim());
}

async function allocatePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not allocate an E2E port");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

async function waitForCdp(port: number, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    lifecycle.check();
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `Electron exited before CDP was ready (${child.signalCode ?? child.exitCode})`,
      );
    }
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.any([lifecycle.signal, AbortSignal.timeout(500)]),
    }).catch(() => null);
    if (response?.ok) return;
    await sleep(100, undefined, { signal: lifecycle.signal });
  }
  throw new Error("Electron did not expose CDP within 30 seconds");
}

async function rendererWebSocketUrl(port: number): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
    signal: AbortSignal.any([lifecycle.signal, AbortSignal.timeout(5_000)]),
  });
  const targets = (await response.json()) as Array<{
    type?: string;
    webSocketDebuggerUrl?: string;
  }>;
  const pageTarget = targets.find(
    (target) => target.type === "page" && target.webSocketDebuggerUrl,
  );
  if (!pageTarget?.webSocketDebuggerUrl) {
    throw new Error("Electron did not expose a renderer WebSocket target");
  }
  return pageTarget.webSocketDebuggerUrl;
}

async function startPerformanceTrace(session: CDPSession): Promise<void> {
  await session.send("Tracing.start", {
    transferMode: "ReturnAsStream",
    streamFormat: "json",
    screenshotMaxSize: 720,
    screenshotMaxCount: 120,
    traceConfig: {
      recordMode: "recordAsMuchAsPossible",
      enableSampling: true,
      includedCategories: [
        "blink.user_timing",
        "cc",
        "devtools.timeline",
        "disabled-by-default-devtools.screenshot",
        "disabled-by-default-devtools.timeline",
        "disabled-by-default-devtools.timeline.stack",
        "disabled-by-default-v8.cpu_profiler",
        "disabled-by-default-v8.cpu_profiler.hires",
        "renderer.scheduler",
        "toplevel",
        "v8.execute",
      ],
    },
  });
}

async function stopPerformanceTrace(session: CDPSession, outputPath: string): Promise<void> {
  const completed = new Promise<{
    dataLossOccurred: boolean;
    stream?: string;
  }>((resolve) => {
    session.once("Tracing.tracingComplete", (event) => resolve(event));
  });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let stream: string | undefined;
  try {
    const result = await Promise.race([
      (async () => {
        await session.send("Tracing.end");
        return completed;
      })(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Chrome performance trace did not finish within 15 seconds")),
          15_000,
        );
      }),
    ]);
    stream = result.stream;
    if (!stream) throw new Error("Chrome performance trace did not return a stream");

    const output = await open(outputPath, "w", 0o600);
    try {
      while (true) {
        const chunk = await session.send("IO.read", { handle: stream, size: 1_048_576 });
        if (chunk.base64Encoded) await output.write(Buffer.from(chunk.data, "base64"));
        else await output.write(chunk.data);
        if (chunk.eof) break;
      }
    } finally {
      await output.close();
    }
    if (result.dataLossOccurred) console.warn("Chrome reported data loss in the performance trace");
  } finally {
    if (timeout) clearTimeout(timeout);
    if (stream) await session.send("IO.close", { handle: stream }).catch(() => undefined);
    await session.detach().catch(() => undefined);
  }
}

async function findOpenCodeBinary(): Promise<string> {
  const pathDirectories = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const candidates = [
    process.env.OPENCODE_BIN,
    path.join(homedir(), ".opencode/bin/opencode2"),
    path.join(homedir(), ".local/bin/opencode2"),
    path.join(homedir(), ".bun/bin/opencode2"),
    "/opt/homebrew/bin/opencode2",
    "/usr/local/bin/opencode2",
    ...pathDirectories.map((directory) => path.join(directory, "opencode2")),
  ].filter((candidate): candidate is string => Boolean(candidate));
  for (const candidate of new Set(candidates)) {
    lifecycle.check();
    try {
      await access(candidate, constants.X_OK);
      const { stdout, stderr } = await execFileAsync(candidate, ["--version"], {
        timeout: 5_000,
        signal: lifecycle.signal,
      });
      if (
        `${stdout}\n${stderr}`
          .split(/\s+/)
          .some((token) => token.replace(/^v/, "") === EXPECTED_OPENCODE_VERSION)
      )
        return candidate;
    } catch {
      continue;
    }
  }
  throw new Error(
    `OpenCode ${EXPECTED_OPENCODE_VERSION} is required for Palot E2E tests. Set OPENCODE_BIN to its executable path.`,
  );
}

function environment(overrides: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries({ ...process.env, ...overrides }).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

async function run(command: string, commandArgs: string[], cwd: string): Promise<void> {
  await lifecycle.spawn(command, command, commandArgs, { cwd, env: process.env }).completed;
}
