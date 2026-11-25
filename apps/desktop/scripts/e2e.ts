/** Runs Palot against an isolated real OpenCode service and scripted local model. */

import { type ChildProcess, execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, mkdtemp, open, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { inspect as inspectError, parseArgs, promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { OpenCode } from "@opencode/client";
import { Service } from "@opencode/client/service";
import { chromium, type Browser, type CDPSession, type Page } from "@playwright/test";
import { isSupportedOpenCodeVersion } from "../src/main/opencode-version.ts";
import { scenarioNames, scenarios } from "../test/e2e/scenarios.ts";
import { describeRequirements, unmetRequirements } from "../test/e2e/scenario-requirements.ts";
import { demoScenarios } from "../test/e2e/demo-scenarios.ts";
import { showcaseScenarios } from "../test/e2e/showcase-scenarios.ts";
import { TestLLMServer } from "../test/e2e/test-llm-server.ts";
import { assertVideoPrerequisites, startVideoCapture } from "../test/e2e/video.ts";
import { captureShowcaseAssets } from "./showcase-assets.ts";
import { E2ERun } from "./e2e-lifecycle.ts";
import { runBatch } from "./e2e-batch.ts";
import { OPENCODE_VERSION, findOpenCodeBinary } from "./opencode-binary.ts";
import {
  findWestonBinary,
  privateElectronEnvironment,
  selectDisplay,
  startPrivateDisplay,
} from "./e2e-display.ts";
import { seedDemoAppearance } from "./demo-appearance.ts";
import type {} from "../src/preload/api";

const execFileAsync = promisify(execFile);
const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKSPACE_ROOT = path.resolve(APP_ROOT, "../..");
const allScenarios = { ...scenarios, ...showcaseScenarios, ...demoScenarios };
/** Flags that watch, profile or retain one run; a batch would repeat or block on them. */
const SINGLE_RUN_FLAGS = [
  "inspect",
  "inspect-on-failure",
  "video",
  "keep",
  "profile",
  "trace",
  "app-trace",
  "css-selector-stats",
  "react-profile",
  "react-scan",
  "showcase",
] as const;
const { values: options, positionals } = parseCommandLine();
const display = selectDisplay(options.display);
const EXPECTED_OPENCODE_VERSION = options["opencode-version"] ?? OPENCODE_VERSION;
if (!isSupportedOpenCodeVersion(EXPECTED_OPENCODE_VERSION))
  throw new Error("E2E runtime overrides must be a supported stable 2.x or reviewed beta version.");
if (options.help) {
  console.log(`Usage: bun run test:e2e -- [scenario...] [options]

Run isolated native desktop scenarios. Defaults to smoke, with
successful artifacts removed. Requires OpenCode ${EXPECTED_OPENCODE_VERSION}.

Several scenarios, or a tier, build once and run one after another, each in
its own run directory. The batch prints one line per scenario (passed, flaky,
failed with its kept run directory), writes .local/desktop-e2e/last-run.json in
the primary checkout, and exits nonzero only if a scenario failed. Opt-in
scenarios that need a single-run flag such as --profile, or explicit
environment, are skipped in a batch and counted separately; run them by name.

Options:
  --help                      Show this help without building or launching
  --list                      List scenarios and their tiers without building or launching
  --tier <name>               Run every scenario in a tier (${scenarioTiers().join(", ")})
  --retries <n>               Rerun a failed scenario up to n times; a pass on retry is flaky
                              (default 1 for several scenarios, 0 for one)
  --display <private|desktop>  Linux defaults to private Weston; other platforms to desktop
  --visible                   Show an inactive window on the selected display
  --executable <path>         Test an already-packaged executable without rebuilding
  --opencode-version <version> Test a compatible runtime rather than the pinned baseline
  --focus                     Show and focus on the selected display
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
${SINGLE_RUN_FLAGS.map((flag) => `--${flag}`).join(", ")}
apply to one scenario only.
--renderer-opaque and --renderer-glass cannot be combined.
Set OPENCODE_BIN to the exact-version OpenCode executable if needed.
--display=desktop uses the host display; visible windows may reflow a tiling desktop.
Private display uses headless Weston with pixman software rendering.
Video captures renderer content only (no desktop/audio), adds measurement overhead,
and is retained as video.mp4 beside video.json. It is not compositor/FPS evidence.

Examples:
  bun run test:e2e -- --list
  bun run test:e2e -- smoke
  bun run test:e2e -- smoke onboarding usage
  bun run test:e2e -- --tier core
  bun run test:e2e -- smoke --visible --inspect
  bun run test:e2e -- session-switch-performance --trace --react-profile`);
  process.exit(0);
}
if (options.list) {
  for (const name of scenarioNames()) console.log(listing(name, scenarios[name]));
  for (const [name, scenario] of Object.entries({ ...showcaseScenarios, ...demoScenarios })) {
    console.log(listing(name, scenario));
  }
  process.exit(0);
}
const requestedNames = [
  ...new Set([...positionals, ...(options.tier ? tierScenarioNames(options.tier) : [])]),
];
const severalScenarios = requestedNames.length > 1 || options.tier !== undefined;
const retries =
  options.retries === undefined ? (severalScenarios ? 1 : 0) : Number(options.retries);
if (severalScenarios || retries > 0) {
  for (const requested of requestedNames) {
    const candidate = allScenarios[requested as keyof typeof allScenarios];
    if (
      "requiresFocus" in candidate &&
      candidate.requiresFocus &&
      display !== "private" &&
      !options.focus
    )
      throw new Error(
        `${requested} requires native window focus; pass --focus on the desktop display.`,
      );
  }
  // The batch's single build must match what each scenario run would build itself.
  process.env.PALOT_REACT_SCAN = "0";
  const runOptions = { flags: setFlags(), env: process.env };
  const primaryCheckout = await resolvePrimaryCheckout();
  process.exit(
    await runBatch({
      names: requestedNames.length ? requestedNames : ["smoke"],
      tier: options.tier,
      retries,
      forwardedArgs: forwardedArguments(),
      entrypoint: fileURLToPath(import.meta.url),
      appRoot: APP_ROOT,
      artifactsRoot: path.join(primaryCheckout, ".local/desktop-e2e"),
      build: !options.executable,
      // vite.renderer.config.ts compiles E2E-only renderer behaviour for this scenario.
      buildKey: (scenarioName) => (scenarioName === "inbox-polish" ? scenarioName : ""),
      // Opt-in scenarios need single-run flags or explicit environment; run those by name.
      skipReason: (scenarioName) => {
        const unmet = unmetRequirements(
          allScenarios[scenarioName as keyof typeof allScenarios],
          runOptions,
        );
        return unmet.length ? describeRequirements(unmet) : undefined;
      },
    }),
  );
}
const name = positionals[0] ?? "smoke";
const scenario = allScenarios[name as keyof typeof allScenarios];
const unmet = unmetRequirements(scenario, { flags: setFlags(), env: process.env });
if (unmet.length) {
  console.error(`Palot E2E: ${name} ${describeRequirements(unmet)}`);
  process.exit(1);
}
const requiresFocus = scenario && "requiresFocus" in scenario && scenario.requiresFocus;
if (requiresFocus && display !== "private" && !options.focus)
  throw new Error(`${name} requires native window focus; pass --focus on the desktop display.`);
const trace = options.trace ?? false;
const appTrace = options["app-trace"] ?? false;
const profile = Boolean(options.profile || trace || appTrace);
const video = options.video ?? false;
const cssSelectorStats = options["css-selector-stats"] ?? false;
const reactProfile = options["react-profile"] ?? false;
const reactScan = options["react-scan"] ?? false;
const focus = Boolean(options.focus || (display === "private" && requiresFocus));
const showcase = options.showcase ?? false;
const glass = Boolean(options.glass || showcase);
const rendererOpaque = options["renderer-opaque"] ?? false;
const rendererGlass = options["renderer-glass"] ?? false;
const disableComposerBackdrop = options["disable-composer-backdrop"] ?? false;
const visible = Boolean(
  display === "private" || options.visible || profile || focus || showcase || video,
);
const inactive = visible && !focus && !showcase;
const keep = Boolean(options.keep || profile || reactScan || showcase || video);
const inspect = options.inspect ?? false;
const inspectOnFailure = options["inspect-on-failure"] ?? false;
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
/** A scenario's real home outside the checkout, removed with the run's artifacts. */
let externalHome: string | null = null;
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
  privateDisplay: display === "private",
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
  const primaryCheckout = await resolvePrimaryCheckout(lifecycle.signal);
  await lifecycle.initialize(path.join(primaryCheckout, ".local/desktop-e2e"));
  runRoot = lifecycle.root;
  lifecycle.phase("prerequisites");
  const weston = display === "private" ? await findWestonBinary() : null;
  const binary = await findOpenCodeBinary({
    version: EXPECTED_OPENCODE_VERSION,
    primaryCheckout,
    signal: lifecycle.signal,
  });
  lifecycle.check();
  if (video) await assertVideoPrerequisites();
  lifecycle.check();
  const electronPath = packagedExecutable ?? (createRequire(import.meta.url)("electron") as string);
  const privateDisplay = weston ? await startPrivateDisplay(lifecycle, weston) : null;
  lifecycle.phase("build");
  if (packagedExecutable) await access(packagedExecutable, constants.X_OK);
  // A batch runner has already built this checkout for the scenario.
  else if (process.env.PALOT_E2E_PREBUILT !== "1") await runBuild();
  lifecycle.phase("fixtures");
  const projectDirectory = path.join(
    runRoot,
    "projectName" in scenario ? scenario.projectName : showcase ? "palot" : "project",
  );
  const home = path.join(runRoot, "home");
  if (!("homeInsideCheckout" in scenario && scenario.homeInsideCheckout)) {
    // OpenCode resolves a folder to the nearest enclosing repository, and run roots live in
    // this checkout. A home inside it makes OpenCode register the checkout as a project as
    // soon as something asks about the home folder, and move commit-less tasks into it
    // mid-run. The service resolves its working directory through the link, so its default
    // folder is outside any repository; the link keeps the home with the artifacts.
    externalHome = await mkdtemp(path.join(tmpdir(), "palot-e2e-home-"));
    await symlink(externalHome, home, "dir");
    lifecycle.discover({ home: externalHome });
  }
  const palotUserData = path.join(runRoot, "palot-user-data");
  await Promise.all([
    mkdir(projectDirectory, { recursive: true }),
    mkdir(home, { recursive: true }),
    mkdir(palotUserData, { recursive: true }),
  ]);
  if (name === "demo-workspace" && inspect) {
    const source = await seedDemoAppearance({
      destination: path.join(palotUserData, "appearance.json"),
    });
    console.log(
      source
        ? `Demo appearance copied from: ${source}`
        : "Demo appearance: no saved Palot profile; using system defaults.",
    );
  }
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
    OPENCODE_CONFIG_CONTENT: JSON.stringify({
      ...testConfiguration(llm.url, "modelRuntime" in scenario ? scenario.modelRuntime : undefined),
      ...("openCodeConfig" in scenario ? scenario.openCodeConfig : undefined),
    }),
    OPENCODE_AUTH_CONTENT: "{}",
    OPENCODE_DISABLE_PROJECT_CONFIG: "1",
    OPENCODE_PURE: "1",
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    OPENCODE_DISABLE_AUTOCOMPACT: "1",
    OPENCODE_DISABLE_MODELS_FETCH: "1",
    ...("serviceEnvironment" in scenario && scenario.serviceEnvironment
      ? scenario.serviceEnvironment(home)
      : {}),
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
  await client.session.update({ sessionID: session.id, title });
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
  const displayEnvironment = privateDisplay
    ? privateElectronEnvironment(
        electronEnvironment,
        privateDisplay.runtimeDirectory,
        privateDisplay.socket,
      )
    : electronEnvironment;
  lifecycle.phase("electron");
  const { child: electronProcess } = lifecycle.spawn(
    "electron",
    electronPath,
    [
      ...(packagedExecutable ? [`--remote-debugging-port=${cdpPort}`] : ["."]),
      ...(privateDisplay ? ["--ozone-platform=wayland"] : []),
    ],
    {
      cwd: APP_ROOT,
      env: displayEnvironment,
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
  const pendingModelResponses =
    "pendingModelResponses" in scenario ? scenario.pendingModelResponses : 0;
  if (llm.pendingResponses() !== pendingModelResponses) {
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
      .catch((screenshotError: unknown) =>
        // A screenshot needs a new frame; a window that is not painting cannot give one.
        console.error(
          "Palot E2E failure screenshot unavailable (is the renderer producing frames?):",
          screenshotError instanceof Error ? screenshotError.message : screenshotError,
        ),
      );
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
    if (passed && !lifecycle.failed && !lifecycle.cleanupFailed && !keep && runRoot) {
      await rm(runRoot, { recursive: true, force: true });
      if (externalHome) await rm(externalHome, { recursive: true, force: true });
    } else {
      if (passed && runRoot) console.log(`Palot E2E artifacts kept: ${runRoot}`);
      if (externalHome) console.log(`Palot E2E home kept outside the checkout: ${externalHome}`);
    }
  } finally {
    lifecycle.dispose();
    if (process.env.PALOT_E2E_RESULT_FILE)
      await writeFile(process.env.PALOT_E2E_RESULT_FILE, JSON.stringify({ runRoot }), {
        mode: 0o600,
      }).catch((error) => console.error("Could not report the run to the batch:", error));
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
        display: { type: "string" },
        tier: { type: "string" },
        retries: { type: "string" },
      },
    });
    const { values, positionals } = result;
    for (const name of positionals) {
      if (!Object.hasOwn(allScenarios, name))
        throw new Error(`Unknown E2E scenario '${name}'. Use --list to see available scenarios`);
    }
    if (values.tier !== undefined && !scenarioTiers().includes(values.tier)) {
      throw new Error(
        `Unknown E2E tier '${values.tier}'. Choose one of: ${scenarioTiers().join(", ")}`,
      );
    }
    if (values.retries !== undefined && !/^\d+$/.test(values.retries)) {
      throw new Error("--retries takes a whole number of extra attempts, such as --retries 1");
    }
    const count = new Set([...positionals, ...(values.tier ? tierScenarioNames(values.tier) : [])])
      .size;
    const singleRunFlag = SINGLE_RUN_FLAGS.find((flag) => values[flag]);
    if ((count > 1 || values.tier !== undefined) && singleRunFlag) {
      throw new Error(`--${singleRunFlag} works with one scenario only; run that scenario alone`);
    }
    if (Number(values.retries) > 0 && (values.inspect || values["inspect-on-failure"])) {
      throw new Error("--inspect and --inspect-on-failure cannot be combined with --retries");
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
    console.error("Usage: bun run test:e2e -- [scenario...] [options]. Use --help for examples.");
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

async function resolvePrimaryCheckout(signal?: AbortSignal): Promise<string> {
  const { stdout } = await execFileAsync(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    { cwd: WORKSPACE_ROOT, signal },
  );
  return path.dirname(stdout.trim());
}

function scenarioTier(scenario: object): string | undefined {
  return "tier" in scenario && typeof scenario.tier === "string" ? scenario.tier : undefined;
}

function scenarioTiers(): string[] {
  return [
    ...new Set(Object.values(allScenarios).flatMap((scenario) => scenarioTier(scenario) ?? [])),
  ].sort();
}

function tierScenarioNames(tier: string): string[] {
  return Object.entries(allScenarios).flatMap(([name, scenario]) =>
    scenarioTier(scenario) === tier ? [name] : [],
  );
}

function listing(name: string, scenario: { description: string }): string {
  const tier = scenarioTier(scenario);
  return `${name}: ${scenario.description}${tier ? ` [${tier}]` : ""}`;
}

/** Names of the boolean or string options set on this invocation. */
function setFlags(): Set<string> {
  return new Set(
    Object.entries(options).flatMap(([option, value]) =>
      value === undefined || value === false ? [] : [option],
    ),
  );
}

/** The options of this invocation that each scenario run of a batch also needs. */
function forwardedArguments(): string[] {
  return Object.entries(options).flatMap(([option, value]) => {
    if (option === "tier" || option === "retries" || value === undefined || value === false)
      return [];
    return value === true ? [`--${option}`] : [`--${option}=${value}`];
  });
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
