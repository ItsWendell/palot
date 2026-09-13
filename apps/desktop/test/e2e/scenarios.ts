import type { OpenCodeClient, SessionInfo } from "@opencode/client";
import { expect, type Locator, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { compactQuestionScenario } from "./compact-question-scenario.ts";
import { subagentRequestsScenario } from "./subagent-requests-scenario.ts";
import { beaconMotionScenario } from "./beacon-motion-scenario.ts";
import { checkSourceUpdateInstructions, sourceUpdatesScenario } from "./source-updates-scenario.ts";
import { measureInteraction } from "./performance.ts";
import { inputUnderStreaming } from "./input-streaming-performance.ts";
import { interactionStreamingPerformanceScenario } from "./interaction-streaming-performance.ts";
import { batchInputPerformanceScenario } from "./batch-input-performance.ts";
import {
  startStreamingStabilityProbe,
  stopStreamingStabilityProbe,
  setStreamingStabilityUserScroll,
} from "./streaming-stability.ts";
import { processPickerScenario } from "./process-picker-scenario.ts";
import { reviewBaseScenario } from "./review-base-scenario.ts";
import { projectSettingsScenario } from "./project-settings-scenario.ts";
import { streamingPatchScenario } from "./streaming-patch-scenario.ts";
import type { TestLLMServer } from "./test-llm-server";
import { workflowScenarios } from "./workflow-scenarios.ts";
import { pairingAddressScenario } from "./pairing-address-scenario.ts";
import { composerSelectionMemoryScenario } from "./composer-selection-memory-scenario.ts";
import { composerPermissionsScenario } from "./composer-permissions-scenario.ts";
import { composerContextScenario } from "./composer-context-scenario.ts";
import { themePresetsScenario } from "./theme-presets-scenario.ts";
import { assertCommandPaletteMaterial } from "./appearance-accessibility.ts";
import { linuxDesktopScenario } from "./linux-desktop-scenario.ts";
import { compactWindowsScenario } from "./compact-windows-scenario.ts";
import { sessionWindowDragScenario } from "./session-window-drag-scenario.ts";
import { sshConnectionScenario } from "./ssh-connection-scenario.ts";
import { remoteTerminalScenario } from "./remote-terminal-scenario.ts";
import { sharedServiceScenario } from "./shared-service-scenario.ts";
import { openCodeReleaseChannelScenario } from "./opencode-release-channel-scenario.ts";
import { openCodeRuntimeAcquisitionScenario } from "./opencode-runtime-acquisition-scenario.ts";
import { startupAttentionScenario } from "./startup-attention-scenario.ts";
import { multiConnectionScenario } from "./multi-connection-scenario.ts";
import {
  transcriptRailScenario,
  transcriptRailStreamingScenario,
} from "./transcript-rail-scenario.ts";
import {
  conversationToolsScenario,
  conversationPermissionScenario,
} from "./conversation-tools-scenario.ts";

export type ScenarioName = keyof typeof scenarios;

const configuredStreamChunkDelay = Number(process.env.PALOT_E2E_STREAM_CHUNK_DELAY_MS);
const configuredParallelPerformanceChunkDelay = Number(
  process.env.PALOT_E2E_PARALLEL_CHUNK_DELAY_MS,
);
const execFileAsync = promisify(execFile);
const STREAM_CHUNK_DELAY_MS =
  Number.isFinite(configuredStreamChunkDelay) && configuredStreamChunkDelay >= 0
    ? configuredStreamChunkDelay
    : 30;
const STREAM_FINAL_CHUNK_DELAY_MS = STREAM_CHUNK_DELAY_MS + 5;
const STREAM_CONTINUITY_TEXT_MARKERS = 48;
const STREAM_CONTINUITY_REASONING_MARKERS = 24;
const STREAM_CONTINUITY_DELAY_MS = 40;
const STREAM_CONTINUITY_MAX_VISIBLE_GAP_MS = 500;
const STREAM_CONTINUITY_MAX_MARKER_JUMP = 4;
const STREAM_CONTINUITY_FILES = [
  "a",
  "b",
  "c",
  "d",
  "e",
  "f",
  "g",
  "h",
  "i",
  "j",
  "k",
  "l",
] as const;
const STREAM_CONTINUITY_CYCLES = ["A", "B", "C", "D"] as const;
const RENDER_HISTORY_TURNS = 8;
const RENDER_PROJECTION_CALLS = 15;
const RENDER_SUBAGENT_CALLS = 4;
const RENDER_POST_COMPACTION_CALLS = 4;
const RELOAD_RECOVERY_DRAFT = "Unsent draft survives reload. ".repeat(500);
const RENDER_TOOL_NAMES = [
  "edit",
  "execute",
  "glob",
  "grep",
  "question",
  "read",
  "shell",
  "skill",
  "subagent",
  "webfetch",
  "websearch",
  "write",
] satisfies string[];
const RENDERED_TOOL_NAMES = RENDER_TOOL_NAMES.filter(
  (name) => name !== "question" && name !== "subagent",
);
const RENDERED_TOOL_KINDS = [
  "execute",
  "file-change",
  "read",
  "search",
  "shell",
  "skill",
  "web-fetch",
  "web-search",
] satisfies string[];
const RENDER_EXPECTED_MODEL_CALLS =
  RENDER_HISTORY_TURNS * 2 +
  RENDER_PROJECTION_CALLS * 2 +
  RENDER_SUBAGENT_CALLS * 2 +
  1 +
  RENDER_POST_COMPACTION_CALLS;
const PARALLEL_PERFORMANCE_LABELS = ["ALPHA", "BETA", "GAMMA", "DELTA"] as const;
const PARALLEL_PERFORMANCE_CYCLES = 3;
const PARALLEL_PERFORMANCE_MODEL_CALLS_PER_SESSION = PARALLEL_PERFORMANCE_CYCLES + 1;
const PARALLEL_PERFORMANCE_CHUNK_DELAY_MS =
  Number.isFinite(configuredParallelPerformanceChunkDelay) &&
  configuredParallelPerformanceChunkDelay >= 0
    ? configuredParallelPerformanceChunkDelay
    : 15;

export interface Scenario {
  description: string;
  prompt: string;
  expectedModelCalls: number;
  onboarding?: boolean;
  modelRuntime?: "native-openai";
  arrange(llm: TestLLMServer): void;
  prepare?(home: string): Promise<void>;
  prepareProject?(context: ScenarioSeedContext): Promise<void>;
  seed?(client: OpenCodeClient, context: ScenarioSeedContext): Promise<void>;
  run?(page: Page, context: ScenarioContext): Promise<void>;
  assert(page: Page, context: ScenarioContext): Promise<void>;
}

interface ScenarioSeedContext {
  projectDirectory: string;
  runRoot: string;
}

interface ScenarioContext {
  visible: boolean;
  uncertainCleanup(reason: string): void;
  client: OpenCodeClient;
  llm: TestLLMServer;
  session: SessionInfo;
  projectDirectory: string;
  runRoot: string;
  profile: boolean;
  cssSelectorStats: boolean;
  reactProfile: boolean;
}

export const scenarios = {
  "settings-source-updates": sourceUpdatesScenario,
  "theme-presets": themePresetsScenario,
  "composer-context": composerContextScenario,
  "beacon-motion": beaconMotionScenario,
  "startup-attention": startupAttentionScenario,
  "multi-connection": multiConnectionScenario,
  "shared-service": sharedServiceScenario,
  "opencode-release-channel": openCodeReleaseChannelScenario,
  "opencode-runtime-acquisition": openCodeRuntimeAcquisitionScenario,
  "linux-desktop": linuxDesktopScenario,
  "compact-windows": compactWindowsScenario,
  "session-window-drag": sessionWindowDragScenario,
  ...workflowScenarios,
  "pairing-address": pairingAddressScenario,
  "ssh-connection": sshConnectionScenario,
  "remote-terminal": remoteTerminalScenario,
  "conversation-tools": conversationToolsScenario,
  "transcript-rail": transcriptRailScenario,
  "transcript-rail-streaming": transcriptRailStreamingScenario,
  "conversation-permission": conversationPermissionScenario,
  "composer-selection-memory": composerSelectionMemoryScenario,
  "composer-permissions": composerPermissionsScenario,
  "compact-question": compactQuestionScenario,
  "subagent-requests": subagentRequestsScenario,
  "process-picker": processPickerScenario,
  "review-base": reviewBaseScenario,
  "project-settings": projectSettingsScenario,
  "streaming-patch": streamingPatchScenario,
  "accessibility-keyboard": {
    description: "use major routes and dialogs by keyboard with compact accessibility checks",
    prompt: "",
    expectedModelCalls: 0,
    onboarding: true,
    arrange() {},
    async run(page, { runRoot }) {
      await assertRouteAccessibility(page, "welcome");
      await tabTo(page, page.getByRole("button", { name: "Continue" }));
      await page.keyboard.press("Enter");

      await page.getByRole("heading", { name: "Where should Palot start?" }).waitFor();
      await assertRouteAccessibility(page, "project onboarding");
      await tabTo(page, page.locator("[data-onboarding-project-name]").first());
      await page.keyboard.press("Enter");

      await page.getByRole("heading", { name: "Connect your models" }).waitFor();
      await assertRouteAccessibility(page, "provider onboarding");
      await tabTo(page, page.getByRole("button", { name: "Skip provider setup" }), 80);
      await page.keyboard.press("Enter");

      await page.getByRole("main", { name: "New task" }).waitFor();
      await assertRouteAccessibility(page, "new task");
      const composer = page.getByRole("textbox", { name: "Message Palot" });
      await tabTo(page, composer, 40);
      await page.keyboard.type("Keyboard-only draft");
      await expect(composer).toHaveValue("Keyboard-only draft");

      await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
      const commandSearch = page.getByRole("combobox", { name: "Search tasks and commands" });
      await commandSearch.fill("appearance");
      await page.getByRole("option", { name: /Appearance/ }).waitFor();
      await page.keyboard.press("Enter");
      await page.getByRole("heading", { name: "Appearance", level: 1 }).waitFor();
      await assertRouteAccessibility(page, "appearance settings");

      const appearanceCard = page.getByRole("button", { name: /System|Light|Dark/ }).first();
      const beforeMotion = await appearanceCard.evaluate(
        (element) =>
          (
            globalThis as unknown as {
              getComputedStyle(value: unknown): { transitionDuration: string };
            }
          ).getComputedStyle(element).transitionDuration,
      );
      const beforeFontSize = await page
        .getByRole("heading", { name: "Typography", level: 2 })
        .evaluate((element) =>
          Number.parseFloat(
            (
              globalThis as unknown as {
                getComputedStyle(value: unknown): { fontSize: string };
              }
            ).getComputedStyle(element).fontSize,
          ),
        );
      const interfaceSize = page.getByRole("combobox", { name: "Interface font size" });
      await tabTo(page, interfaceSize, 80);
      await page.keyboard.press("Enter");
      const largeInterfaceSize = page.getByRole("option", { name: "19px" });
      await largeInterfaceSize.focus();
      await page.keyboard.press("Enter");
      await expect
        .poll(() =>
          page.getByRole("heading", { name: "Typography", level: 2 }).evaluate((element) =>
            Number.parseFloat(
              (
                globalThis as unknown as {
                  getComputedStyle(value: unknown): { fontSize: string };
                }
              ).getComputedStyle(element).fontSize,
            ),
          ),
        )
        .toBeGreaterThan(beforeFontSize);

      await page.emulateMedia({ reducedMotion: "reduce" });
      const afterMotion = await appearanceCard.evaluate(
        (element) =>
          (
            globalThis as unknown as {
              getComputedStyle(value: unknown): { transitionDuration: string };
            }
          ).getComputedStyle(element).transitionDuration,
      );
      expect(afterMotion).not.toBe(beforeMotion);
      expect(cssDurationMilliseconds(afterMotion)).toBeLessThanOrEqual(0.01);

      await assertCommandPaletteMaterial(page);

      await checkSourceUpdateInstructions(page, runRoot);
      await assertRouteAccessibility(page, "about settings");

      await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
      await commandSearch.fill("Palot E2E: accessibility-keyboard");
      await page.getByRole("option", { name: /Palot E2E: accessibility-keyboard/ }).waitFor();
      await page.keyboard.press("Enter");
    },
    async assert(page) {
      await expect.poll(() => new URL(page.url()).hash).toContain("/sessions/");
      const settledShelf = page.getByRole("button", { name: /^Settled\b/ });
      if ((await settledShelf.getAttribute("data-state")) !== "open") await settledShelf.click();
      const taskRow = page
        .locator("[data-inbox-compact-row]")
        .filter({ hasText: "Palot E2E: accessibility-keyboard" })
        .first();
      await taskRow.waitFor();
      const taskButton = taskRow.getByRole("button").first();
      await taskButton.focus();
      await page.keyboard.press("Shift+F10");
      const deleteTask = page.getByRole("menuitem", { name: "Delete task" });
      if (!(await deleteTask.isVisible().catch(() => false))) {
        await taskButton.dispatchEvent("contextmenu");
      }
      await deleteTask.waitFor();
      await page.keyboard.press("End");
      await page.keyboard.press("Enter");
      const destructiveDialog = page.getByRole("alertdialog");
      await destructiveDialog.waitFor();
      await assertRouteAccessibility(page, "delete task dialog");
      await expect(destructiveDialog.getByRole("button", { name: "Cancel" })).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(taskButton).toBeFocused();
    },
  },
  onboarding: {
    description: "complete first-run project and provider setup",
    prompt: "",
    expectedModelCalls: 0,
    onboarding: true,
    arrange() {},
    async seed(client: OpenCodeClient, { runRoot }: ScenarioSeedContext): Promise<void> {
      for (let index = 0; index < 16; index += 1) {
        const directory = join(runRoot, `onboarding-project-${String(index).padStart(2, "0")}`);
        await mkdir(directory, { recursive: true });
        await execFileAsync("git", ["init", "--quiet"], { cwd: directory });
        await writeFile(join(directory, "README.md"), `# Onboarding project ${index}\n`);
        await execFileAsync("git", ["add", "README.md"], { cwd: directory });
        await execFileAsync(
          "git",
          [
            "-c",
            "user.name=Palot E2E",
            "-c",
            "user.email=palot-e2e@example.invalid",
            "commit",
            "--quiet",
            "-m",
            "seed",
          ],
          { cwd: directory },
        );
        await client.session.create({ location: { directory } });
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    },
    async run(page, { projectDirectory }) {
      await page.getByRole("button", { name: "Continue" }).click();
      const projectSearch = page.getByPlaceholder("Search projects");
      await projectSearch.waitFor();
      const projectList = page.locator("[data-onboarding-project-list]");
      const projectListMetrics = await projectList.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return {
          clientHeight: element.clientHeight,
          scrollHeight: element.scrollHeight,
          bottom: bounds.bottom,
          viewportHeight: element.ownerDocument.defaultView?.innerHeight ?? 0,
        };
      });
      expect(projectListMetrics.scrollHeight).toBeGreaterThan(projectListMetrics.clientHeight);
      expect(projectListMetrics.bottom).toBeLessThanOrEqual(projectListMetrics.viewportHeight);
      await page.locator(".palot-scroll-fade-bottom").filter({ visible: true }).waitFor();
      await projectList.evaluate((element) => {
        element.scrollTop = 40;
        element.dispatchEvent(new Event("scroll"));
      });
      await page.locator(".palot-scroll-fade-top[data-visible='true']").waitFor();
      await projectSearch.fill(projectDirectory);
      await page.getByText(projectDirectory, { exact: true }).click();
      await page.getByRole("heading", { name: "Connect your models" }).waitFor();
      const faded = await page
        .getByRole("button", { name: "Start working" })
        .evaluate(async (button) => {
          (button as HTMLElement).click();
          await new Promise((resolve) =>
            button.ownerDocument.defaultView?.requestAnimationFrame(() => resolve(undefined)),
          );
          return button.closest("main")?.getAttribute("data-leaving");
        });
      expect(faded).toBe("true");
      await page.getByRole("main", { name: "New task" }).waitFor();

      await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
      await page.getByRole("combobox", { name: "Search tasks and commands" }).fill("welcome guide");
      await page.getByRole("option", { name: /Open welcome guide/ }).click();
      await page.getByRole("button", { name: "Continue" }).click();
      const defaultProjectName = await page
        .locator("[data-onboarding-project-name]")
        .first()
        .getAttribute("data-onboarding-project-name");
      expect(defaultProjectName).toBeTruthy();
      await page.getByRole("button", { name: "Skip for now" }).click();
      await page.getByRole("combobox", { name: `Project: ${defaultProjectName}` }).waitFor();
    },
    async assert(page) {
      await page.getByRole("main", { name: "New task" }).waitFor();
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByRole("main", { name: "New task" }).waitFor();
    },
  },
  "provider-settings": {
    description: "manage multiple credentials from provider settings",
    prompt: "",
    expectedModelCalls: 0,
    arrange() {},
    async seed(client: OpenCodeClient, { projectDirectory }: ScenarioSeedContext): Promise<void> {
      await client.integration.list({ location: { directory: projectDirectory } });
      await client.integration.connect.key({
        integrationID: "openai",
        location: { directory: projectDirectory },
        key: "e2e-work-key",
        label: "Work",
      });
      await client.integration.connect.key({
        integrationID: "openai",
        location: { directory: projectDirectory },
        key: "e2e-personal-key",
        label: "Personal",
      });
    },
    async run(page) {
      await page.evaluate(() => {
        (globalThis as unknown as { location: { hash: string } }).location.hash =
          "#/settings/providers";
      });
      await page.getByRole("heading", { name: "Providers", level: 1 }).waitFor();
    },
    async assert(page, { runRoot }) {
      const openAI = page.getByRole("article", { name: "OpenAI connections" });
      await openAI.waitFor();
      await expect(openAI.getByText("2 stored credentials", { exact: false })).toBeVisible();
      await expect(openAI.getByText("Personal", { exact: true })).toBeVisible();
      await expect(openAI.getByText("In use", { exact: true })).toBeVisible();
      await expect(openAI.getByText("Work", { exact: true })).toBeVisible();
      await expect(openAI.getByRole("button", { name: "Use" })).toHaveCount(1);

      const work = openAI.getByRole("group", { name: "Work connection" });
      await work.getByRole("button", { name: "Use" }).click();
      await expect(work.getByText("In use", { exact: true })).toBeVisible();
      await expect(
        openAI
          .getByRole("group", { name: "Personal connection" })
          .getByRole("button", { name: "Use" }),
      ).toBeVisible();

      await openAI.getByRole("button", { name: "Manage Work" }).click();
      await page.getByRole("menuitem", { name: "Remove credential" }).click();
      const removal = page.getByRole("alertdialog");
      await expect(removal).toContainText(
        "“Personal” will become active for OpenAI across this OpenCode service.",
      );
      await removal.getByRole("button", { name: "Cancel" }).click();

      await openAI.getByRole("button", { name: "Add credential" }).click();
      const addCredential = page.getByRole("dialog", { name: "Add OpenAI credential" });
      await expect(addCredential).toContainText(
        "Adding it makes it active across all connected projects.",
      );
      await expect(addCredential.getByText("Choose a connection method")).toBeVisible();
      await page.screenshot({ path: join(runRoot, "provider-add-credential.png") });
      await addCredential.getByRole("button", { name: "Cancel" }).click();

      await page.screenshot({ path: join(runRoot, "provider-settings.png") });
      await page.setViewportSize({ width: 920, height: 640 });
      await openAI.scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(runRoot, "provider-settings-minimum.png") });
    },
  },
  smoke: {
    description: "one deterministic assistant turn",
    prompt: "Return the scripted smoke response.",
    expectedModelCalls: 1,
    arrange(llm) {
      llm.textChunksWithUsage(["Palot E2E ", "smoke complete"], 30, 12);
    },
    async assert(page) {
      await page.getByText("Palot E2E smoke complete", { exact: true }).waitFor();
      await expect(page.getByText(/^\d+\.\d tok\/s$/)).toHaveCount(1);
      const composerChrome = await page.evaluate(() => {
        type BrowserElement = { getBoundingClientRect(): { bottom: number; top: number } };
        const browser = globalThis as unknown as {
          document: {
            documentElement: BrowserElement;
            querySelector(selector: string): BrowserElement | null;
          };
          getComputedStyle(element: BrowserElement): { fontSize: string; overflow: string };
        };
        const composer = browser.document.querySelector(".palot-composer");
        const footer = browser.document.querySelector(".palot-composer-context-compact");
        if (!composer || !footer) throw new Error("Compact composer chrome was not rendered");
        const composerBounds = composer.getBoundingClientRect();
        const footerBounds = footer.getBoundingClientRect();
        return {
          overlap: composerBounds.bottom - footerBounds.top,
          rootFontSize: Number.parseFloat(
            browser.getComputedStyle(browser.document.documentElement).fontSize,
          ),
          overflow: browser.getComputedStyle(footer).overflow,
        };
      });
      expect(composerChrome.overlap).toBeGreaterThanOrEqual(composerChrome.rootFontSize - 0.5);
      expect(composerChrome.overflow).toBe("hidden");
      await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
      await page.getByRole("dialog", { name: "Commands" }).waitFor();
      await page.getByRole("combobox", { name: "Search tasks and commands" }).fill("appearance");
      await page.getByRole("option", { name: /Appearance/ }).waitFor();
      await page.keyboard.press("Escape");
    },
  },
  "python-shell-projection": {
    description:
      "inspect embedded Python, surrounding shell, and combined output in a real tool call",
    prompt: "Run the scripted Python inspection command.",
    expectedModelCalls: 2,
    arrange(llm) {
      llm.tool("shell", {
        command:
          "python3 - <<'PY'\nimport json\nprint(json.dumps({'answer': 42}))\nPY\nprintf 'validation complete\\n'",
      });
      llm.text("Python inspection complete.");
    },
    async assert(page, { runRoot }) {
      await page.getByText("Python inspection complete.", { exact: true }).waitFor();
      for (const selector of ["[data-palot-turn-activity]", "[data-palot-activity-group]"]) {
        const triggers = page.locator(`${selector} > button[aria-expanded="false"]`);
        for (const trigger of await triggers.all()) await trigger.click();
      }
      await page.getByRole("button", { name: /Ran shell commands with Python/ }).click();
      const python = page.getByLabel("Python script", { exact: true });
      await expect(python).toContainText("import json");
      await expect(python.locator(".th-keyword").first()).toHaveText("import");
      await expect(page.getByLabel("Shell commands", { exact: true })).toContainText("printf");
      await expect(page.getByText("Combined output", { exact: true })).toBeVisible();
      await expect(page.getByRole("region", { name: "Command output" })).toContainText(
        '"answer": 42',
      );
      await expect(page.getByRole("region", { name: "Command output" })).toContainText(
        "validation complete",
      );
      await page.getByRole("button", { name: "Raw command", exact: true }).click();
      await expect(page.getByRole("region", { name: "Raw command" })).toContainText("<<'PY'");
      await page.getByRole("button", { name: "Show script", exact: true }).click();
      await expect(python).toBeVisible();
      await page.screenshot({ path: join(runRoot, "python-shell.png") });
      await page.setViewportSize({ width: 920, height: 640 });
      await python.scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(runRoot, "python-shell-minimum.png") });
      await page.emulateMedia({ colorScheme: "dark" });
      await page.screenshot({ path: join(runRoot, "python-shell-dark.png") });
    },
  },
  "completed-turn-user-message": {
    description: "keep the submitted user message visible after tool activity completes",
    prompt: "What time is it?",
    expectedModelCalls: 2,
    arrange(llm) {
      llm.tool("shell", { command: "date '+%H:%M'" });
      llm.text("The deterministic clock check is complete.");
    },
    async run(page) {
      await page.getByLabel("Message Palot").fill("What time is it?");
      await page.getByRole("button", { name: "Send message" }).click();
      await page.getByText("What time is it?", { exact: true }).waitFor();
      await page.getByText("The deterministic clock check is complete.", { exact: true }).waitFor();
    },
    async assert(page) {
      const prompt = page.getByText("What time is it?", { exact: true });
      await expect(prompt).toBeVisible();
      await expect(prompt).toBeInViewport();
    },
  },
  "active-turn-stream-continuity": {
    description: "keep visible assistant text moving across parallel tool activity",
    prompt: "Stream the deterministic continuity response and inspect the fixture files.",
    expectedModelCalls: STREAM_CONTINUITY_CYCLES.length * 2,
    modelRuntime: "native-openai",
    arrange(llm) {
      for (const cycle of STREAM_CONTINUITY_CYCLES) {
        llm.toolsWithReasoningAndText(
          STREAM_CONTINUITY_FILES.map((suffix) => ({
            name: "read",
            input: { path: `continuity-${suffix}.txt` },
          })),
          continuityChunks(`THINK-${cycle}-BEFORE`, STREAM_CONTINUITY_REASONING_MARKERS),
          continuityChunks(`PRE-${cycle}`, STREAM_CONTINUITY_TEXT_MARKERS),
          STREAM_CONTINUITY_DELAY_MS,
        );
        llm.reasoningAndTextChunks(
          continuityChunks(`THINK-${cycle}-AFTER`, STREAM_CONTINUITY_REASONING_MARKERS),
          continuityChunks(`POST-${cycle}`, STREAM_CONTINUITY_TEXT_MARKERS),
          STREAM_CONTINUITY_DELAY_MS,
        );
      }
    },
    async run(page, { client, llm, projectDirectory, runRoot, session, profile }) {
      await Promise.all(
        STREAM_CONTINUITY_FILES.map((suffix) =>
          writeFile(
            join(projectDirectory, `continuity-${suffix}.txt`),
            `deterministic continuity fixture ${suffix}\n`,
          ),
        ),
      );
      const reports: StreamContinuityCycleReport[] = [];
      const eventAbort = new AbortController();
      const openCodeEvents: StreamContinuityOpenCodeEvent[] = [];
      const eventTask = collectStreamContinuityEvents(
        client,
        session.id,
        eventAbort.signal,
        openCodeEvents,
      );
      try {
        for (const cycle of STREAM_CONTINUITY_CYCLES) {
          const prePrefix = `PRE-${cycle}`;
          const postPrefix = `POST-${cycle}`;
          const preReasoningPrefix = `THINK-${cycle}-BEFORE`;
          const postReasoningPrefix = `THINK-${cycle}-AFTER`;
          await startStreamContinuityProbe(
            page,
            prePrefix,
            postPrefix,
            preReasoningPrefix,
            postReasoningPrefix,
          );
          await client.session.prompt({
            sessionID: session.id,
            text: `Run deterministic stream continuity cycle ${cycle}.`,
          });
          await client.session.wait({ sessionID: session.id });
          await page
            .getByText(new RegExp(`${postPrefix}-${STREAM_CONTINUITY_TEXT_MARKERS}`))
            .waitFor();
          reports.push({ cycle, ...(await stopStreamContinuityProbe(page)) });
        }
      } finally {
        eventAbort.abort();
        await eventTask;
      }
      const streamingLatency = profile
        ? await page.evaluate(() => {
            const browser = globalThis as unknown as {
              palotStreamingLatency?: () => unknown[];
            };
            return browser.palotStreamingLatency?.() ?? [];
          })
        : [];
      await writeFile(
        join(runRoot, "stream-continuity.json"),
        JSON.stringify(
          {
            reports,
            modelRequestURLs: llm.requests.map((request) => request.url),
            modelEmissions: llm.emissions,
            openCodeEvents,
            streamingLatency,
          },
          null,
          2,
        ),
        { mode: 0o600 },
      );
    },
    async assert(_page, { runRoot }) {
      const result = JSON.parse(
        await readFile(join(runRoot, "stream-continuity.json"), "utf8"),
      ) as { reports: StreamContinuityCycleReport[]; modelRequestURLs: string[] };
      expect(new Set(result.modelRequestURLs)).toEqual(new Set(["/v1/responses"]));
      expect(result.reports).toHaveLength(STREAM_CONTINUITY_CYCLES.length);
      for (const report of result.reports) {
        for (const phase of [report.preText, report.postText]) {
          expect(phase.finalCount).toBe(STREAM_CONTINUITY_TEXT_MARKERS);
          expect(phase.maxJump).toBeLessThanOrEqual(STREAM_CONTINUITY_MAX_MARKER_JUMP);
          expect(phase.maxVisibleGapMs).not.toBeNull();
          expect(phase.maxVisibleGapMs ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(
            STREAM_CONTINUITY_MAX_VISIBLE_GAP_MS,
          );
        }
        for (const phase of [report.preReasoning, report.postReasoning]) {
          expect(phase.finalCount).toBe(STREAM_CONTINUITY_REASONING_MARKERS);
          expect(phase.maxJump).toBeLessThanOrEqual(STREAM_CONTINUITY_MAX_MARKER_JUMP);
          expect(phase.maxVisibleGapMs).not.toBeNull();
          expect(phase.maxVisibleGapMs ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(
            STREAM_CONTINUITY_MAX_VISIBLE_GAP_MS,
          );
        }
        expect(report.maxFrameIntervalMs).toBeLessThanOrEqual(STREAM_CONTINUITY_MAX_VISIBLE_GAP_MS);
        expect(report.statusGapObserved).toBe(false);
        expect(report.statusRegressed).toBe(false);
      }
    },
  },
  "active-turn-status-continuity": {
    description: "keep active status monotonic from tool preamble into final output",
    prompt: "Inspect the status fixture, then return the deterministic final response.",
    expectedModelCalls: 2,
    modelRuntime: "native-openai",
    arrange(llm) {
      llm.toolsWithReasoningAndText(
        [{ name: "read", input: { path: "status-continuity.txt" } }],
        ["Checking the fixture. "],
        continuityChunks("STATUS-PREAMBLE", 12),
        50,
      );
      llm.reasoningAndTextChunks(
        ["Preparing the final response. "],
        continuityChunks("STATUS-FINAL", 12),
        50,
      );
    },
    async run(page, { client, projectDirectory, runRoot, session }) {
      await writeFile(
        join(projectDirectory, "status-continuity.txt"),
        "status continuity fixture\n",
      );
      await startStreamContinuityProbe(
        page,
        "STATUS-PREAMBLE",
        "STATUS-FINAL",
        "STATUS-THINK-BEFORE",
        "STATUS-THINK-AFTER",
      );
      await client.session.prompt({
        sessionID: session.id,
        text: "Inspect the status fixture, then return the deterministic final response.",
      });
      await client.session.wait({ sessionID: session.id });
      await page.getByText(/STATUS-FINAL-12/).waitFor();
      await writeFile(
        join(runRoot, "status-continuity.json"),
        JSON.stringify(await stopStreamContinuityProbe(page), null, 2),
        { mode: 0o600 },
      );
    },
    async assert(_page, { runRoot }) {
      const report = JSON.parse(
        await readFile(join(runRoot, "status-continuity.json"), "utf8"),
      ) as StreamContinuityReport;
      expect(report.statusGapObserved).toBe(false);
      expect(report.statusRegressed).toBe(false);
      expect(report.frames.some((frame) => frame.activeStatus?.startsWith("Working for "))).toBe(
        true,
      );
      expect(report.frames.some((frame) => frame.activeStatus?.startsWith("Finishing for "))).toBe(
        true,
      );
    },
  },
  usage: {
    description: "navigate from the runtime footer through cached aggregate usage",
    prompt: "Return the scripted usage response.",
    expectedModelCalls: 1,
    arrange(llm) {
      llm.text("Palot E2E usage complete");
    },
    async assert(page, { client, runRoot, session }) {
      await client.session.wait({ sessionID: session.id });
      await page.getByText("Palot E2E usage complete", { exact: true }).waitFor();

      await page.getByRole("button", { name: "Open Palot menu" }).click();
      await page.screenshot({ path: join(runRoot, "runtime-menu.png") });
      await page.getByRole("menuitem", { name: "Usage" }).click();
      await page.getByRole("heading", { name: "Usage", level: 1 }).waitFor();
      const rangeDescription = page
        .getByRole("heading", { name: "Usage", level: 1 })
        .locator("..")
        .getByText(/ to .*Updated/);
      await rangeDescription.waitFor();
      const initialRangeDescription = await rangeDescription.textContent();
      await page.getByText("Reported model cost", { exact: true }).waitFor();
      await page.getByText("Daily activity", { exact: true }).waitFor();
      await page.getByText("Models", { exact: true }).waitFor();
      await page.getByText("Tool reliability", { exact: true }).waitFor();
      await expect
        .poll(() =>
          page
            .getByText("Sessions", { exact: true })
            .locator("..")
            .locator("div")
            .first()
            .textContent(),
        )
        .toMatch(/[1-9]/);
      await expect
        .poll(() =>
          page
            .getByText("Prompts", { exact: true })
            .locator("..")
            .locator("div")
            .first()
            .textContent(),
        )
        .toMatch(/[1-9]/);
      await page.screenshot({ path: join(runRoot, "usage-dashboard.png") });

      await page.getByRole("button", { name: "Show details" }).click();
      await page.getByText("No per-tool usage in this range.", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Hide details" }).click();

      await page.getByRole("button", { name: "7 days" }).click();
      await expect(page.getByText("Reported model cost", { exact: true })).toBeVisible();
      await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0);
      await expect
        .poll(() =>
          page.evaluate(
            () => (globalThis as unknown as { location: { hash: string } }).location.hash,
          ),
        )
        .toContain("days=7");
      await expect
        .poll(async () => {
          const description = await rangeDescription.textContent();
          return description !== initialRangeDescription && !description?.includes("Updating");
        })
        .toBe(true);

      await page.evaluate((sessionID) => {
        (globalThis as unknown as { location: { hash: string } }).location.hash =
          `#/sessions/${sessionID}`;
      }, session.id);
      await page.getByLabel("Current task").waitFor();
      await page.getByRole("button", { name: "Open Palot menu" }).click();
      await page.getByRole("menuitem", { name: "Usage" }).click();
      await page.getByText("Reported model cost", { exact: true }).waitFor();
      await expect(page.getByRole("menuitem", { name: "Usage" })).toHaveCount(0);
      await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0);

      await page.setViewportSize({ width: 920, height: 640 });
      await expect(page.getByRole("heading", { name: "Usage", level: 1 })).toBeVisible();
      await expect(page.getByRole("button", { name: "Refresh usage" })).toBeVisible();
      await page.screenshot({ path: join(runRoot, "usage-dashboard-minimum.png") });

      await page.getByRole("button", { name: "Open Palot menu" }).click();
      await page.getByRole("menuitem", { name: "Settings" }).click();
      await page.getByRole("heading", { name: "General", level: 1 }).waitFor();
    },
  },
  "reload-recovery": {
    description:
      "rehydrate the selected task, transcript, and unsent draft after a renderer reload",
    prompt: "Return the scripted reload recovery response.",
    expectedModelCalls: 1,
    arrange(llm) {
      llm.text("Palot E2E reload recovery complete");
    },
    async run(page, { client, session }) {
      await client.session.prompt({
        sessionID: session.id,
        text: "Return the scripted reload recovery response.",
      });
      await client.session.wait({ sessionID: session.id });
      await page.getByText("Palot E2E reload recovery complete", { exact: true }).waitFor();
      await page.addInitScript(() => {
        const browser = globalThis as unknown as {
          document: {
            querySelector(selector: string): {
              getAttribute(name: string): string | null;
            } | null;
          };
          getComputedStyle(element: object): { opacity: string };
          performance: { now(): number };
          requestAnimationFrame(callback: () => void): number;
          __palotColdHydrationSamples?: Array<{
            atMs: number;
            currentTaskVisible: boolean;
            transcriptState: string | null;
            transcriptOpacity: number | null;
          }>;
        };
        const startedAt = browser.performance.now();
        browser.__palotColdHydrationSamples = [];
        const capture = () => {
          const currentTask = browser.document.querySelector('[aria-label="Current task"]');
          const transcript = browser.document.querySelector("[data-palot-transcript-surface]");
          browser.__palotColdHydrationSamples?.push({
            atMs: browser.performance.now() - startedAt,
            currentTaskVisible: currentTask !== null,
            transcriptState: transcript?.getAttribute("data-palot-transcript-state") ?? null,
            transcriptOpacity: transcript
              ? Number.parseFloat(browser.getComputedStyle(transcript).opacity)
              : null,
          });
          if (browser.performance.now() - startedAt < 2_000) {
            browser.requestAnimationFrame(capture);
          }
        };
        browser.requestAnimationFrame(capture);
      });
      await page.getByRole("textbox", { name: "Message Palot" }).fill(RELOAD_RECOVERY_DRAFT);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByLabel("Current task").waitFor();
    },
    async assert(page) {
      await page.getByText("Palot E2E reload recovery complete", { exact: true }).waitFor();
      await expect(page.getByText(/Could not connect to OpenCode/)).toHaveCount(0);
      await expect(page.getByRole("textbox", { name: "Message Palot" })).toHaveValue(
        RELOAD_RECOVERY_DRAFT,
      );
      const samples = await page.evaluate(() => {
        const browser = globalThis as unknown as {
          __palotColdHydrationSamples?: Array<{
            currentTaskVisible: boolean;
            transcriptState: string | null;
            transcriptOpacity: number | null;
          }>;
        };
        return browser.__palotColdHydrationSamples ?? [];
      });
      expect(samples.some((sample) => sample.currentTaskVisible)).toBe(true);
      expect(
        samples.some(
          (sample) =>
            sample.currentTaskVisible &&
            (sample.transcriptState === "settling" ||
              (sample.transcriptOpacity !== null && sample.transcriptOpacity < 0.99)),
        ),
      ).toBe(false);
      await page.getByRole("textbox", { name: "Message Palot" }).fill("");
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByRole("textbox", { name: "Message Palot" })).toHaveValue("");
      await page.getByText("Palot E2E reload recovery complete", { exact: true }).waitFor();
    },
  },
  "fork-delete": {
    description: "fork a task through the native context menu, then permanently delete the fork",
    prompt: "Return the scripted fork lifecycle response.",
    expectedModelCalls: 1,
    arrange(llm) {
      llm.text("Palot E2E fork lifecycle complete");
    },
    async run(page, { client, session }) {
      await client.session.prompt({
        sessionID: session.id,
        text: "Return the scripted fork lifecycle response.",
      });
      await client.session.wait({ sessionID: session.id });
      await page.getByText("Palot E2E fork lifecycle complete", { exact: true }).waitFor();
    },
    async assert(page, { client, session }) {
      const originalTitle = `Palot E2E: fork-delete`;
      const before = await client.session.list({ directory: session.location.directory });
      const beforeIDs = new Set(before.data.map((item) => item.id));
      const originalRow = page
        .locator("[data-palot-task-row], [data-palot-recent-row]")
        .filter({ hasText: originalTitle })
        .first();
      await originalRow.click({ button: "right" });
      await page.getByRole("menuitem", { name: "Fork" }).click();

      await expect
        .poll(async () => {
          const sessions = await client.session.list({ directory: session.location.directory });
          return sessions.data.filter((item) => !beforeIDs.has(item.id)).length;
        })
        .toBe(1);
      const forked = (
        await client.session.list({ directory: session.location.directory })
      ).data.find((item) => !beforeIDs.has(item.id));
      if (!forked) throw new Error("Forked task was not created");
      await expect
        .poll(() =>
          page.evaluate(
            () => (globalThis as unknown as { location: { hash: string } }).location.hash,
          ),
        )
        .toContain(forked.id);
      await page.getByText("Palot E2E fork lifecycle complete", { exact: true }).waitFor();

      const forkedRow = page
        .locator("[data-palot-task-row], [data-palot-recent-row]")
        .filter({ has: page.locator("[data-active]") })
        .first();
      await forkedRow.click({ button: "right" });
      await page.getByRole("menuitem", { name: "Delete task" }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Delete task" }).click();

      await expect
        .poll(async () =>
          (await client.session.list({ directory: session.location.directory })).data.some(
            (item) => item.id === forked.id,
          ),
        )
        .toBe(false);
      await originalRow.waitFor();
      await expect
        .poll(() =>
          page.evaluate(
            () => (globalThis as unknown as { location: { hash: string } }).location.hash,
          ),
        )
        .not.toContain(forked.id);
    },
  },
  "worktree-lifecycle": {
    description:
      "move a task into a new managed worktree and remove that worktree after moving back",
    prompt: "",
    expectedModelCalls: 0,
    async prepareProject({ projectDirectory }) {
      // Worktree creation needs a real HEAD, not the harness's default unborn repository.
      await execFileAsync(
        "git",
        [
          "-c",
          "user.name=Palot E2E",
          "-c",
          "user.email=palot-e2e@example.invalid",
          "-c",
          "commit.gpgsign=false",
          "commit",
          "--allow-empty",
          "--quiet",
          "-m",
          "Seed worktree lifecycle repository",
        ],
        { cwd: projectDirectory },
      );
    },
    arrange() {},
    async run() {},
    async assert(page, { client, session, runRoot }) {
      const mainCheckout = (await client.project.list())
        .filter(
          (project) =>
            project.id !== "global" && session.location.directory.startsWith(project.canonical),
        )
        .toSorted((a, b) => b.canonical.length - a.canonical.length)[0]?.canonical;
      if (!mainCheckout) throw new Error("Repository checkout was not resolved");
      expect(mainCheckout).toBe(session.location.directory);
      await page.getByRole("button", { name: "Show projects", exact: true }).click();
      const taskRow = page
        .locator("[data-palot-task-row], [data-palot-recent-row]")
        .filter({ hasText: "Palot E2E: worktree-lifecycle" })
        .first();
      await taskRow.click({ button: "right" });
      await page.getByRole("menuitem", { name: "Move to worktree" }).focus();
      await page.keyboard.press("ArrowRight");
      await page.getByRole("menuitem", { name: "New worktree" }).click();

      await expect
        .poll(async () => {
          const moved = await client.session.get({ sessionID: session.id });
          return moved.location.directory;
        })
        .not.toBe(session.location.directory);
      const moved = await client.session.get({ sessionID: session.id });
      const worktreeDirectory = moved.location.directory;
      await expect
        .poll(async () =>
          access(worktreeDirectory).then(
            () => true,
            () => false,
          ),
        )
        .toBe(true);

      const projectRow = page.locator("[data-palot-project-row]").filter({ has: taskRow }).first();
      await projectRow.locator("[data-palot-project-trigger]").click({ button: "right" });
      await page.getByRole("menuitem", { name: "Manage worktrees" }).click();
      const worktreeName = worktreeDirectory.split("/").at(-1)!;
      await page.getByRole("button", { name: `Tasks in ${worktreeName}`, exact: true }).click();
      const attachedTasks = page.getByRole("list", {
        name: `Tasks in ${worktreeName}`,
        exact: true,
      });
      const taskLink = attachedTasks.getByRole("link", { name: /Palot E2E: worktree-lifecycle/ });
      await expect(taskLink).toBeVisible();
      const viewport = page.viewportSize();
      await page.setViewportSize({ width: 920, height: 640 });
      await page.screenshot({ path: join(runRoot, "worktree-attached-tasks.png") });
      await taskLink.click();
      await expect.poll(() => new URL(page.url()).hash).toBe(`#/sessions/${session.id}`);
      await page.getByRole("button", { name: "Task actions", exact: true }).click();
      await expect(page.getByRole("menuitem", { name: "Export task", exact: true })).toBeVisible();
      await page.screenshot({ path: join(runRoot, "task-export-menu.png") });
      await page
        .getByRole("menuitem", { name: "Copy conversation as Markdown", exact: true })
        .click();
      await expect(
        page.getByText("Conversation copied as Markdown", { exact: true }),
      ).toBeVisible();
      if (viewport) await page.setViewportSize(viewport);

      await taskRow.click({ button: "right" });
      await page.getByRole("menuitem", { name: "Move to worktree" }).focus();
      await page.keyboard.press("ArrowRight");
      await page.getByRole("menuitem", { name: "Main checkout" }).click();
      await expect
        .poll(async () => (await client.session.get({ sessionID: session.id })).location.directory)
        .toBe(mainCheckout);

      await projectRow.locator("[data-palot-project-trigger]").click({ button: "right" });
      await page.getByRole("menuitem", { name: "Manage worktrees" }).click();
      await page
        .getByRole("button", { name: `Remove ${worktreeDirectory.split("/").at(-1)!}` })
        .click();
      const confirmRemoval = page
        .getByRole("alertdialog")
        .getByRole("button", { name: "Remove worktree" });
      await expect(confirmRemoval).toBeVisible();
      await confirmRemoval.click({ force: true });
      await expect
        .poll(async () =>
          access(worktreeDirectory).then(
            () => true,
            () => false,
          ),
        )
        .toBe(false);
    },
  },
  "composer-undo-redo": {
    description: "undo a delivered turn through execution cleanup, then restore it with redo",
    prompt: "Produce the undo fixture response.",
    expectedModelCalls: 1,
    arrange(llm) {
      llm.text("The delivered turn is ready for undo and redo.");
    },
    async assert(page, { client, session }) {
      const composer = page.getByRole("textbox", { name: "Message Palot" });
      const response = page.getByText("The delivered turn is ready for undo and redo.", {
        exact: true,
      });
      await expect(response).toBeVisible();
      await composer.fill("/undo");
      await page.getByRole("option", { name: /\/undo/i }).click();
      await page.getByRole("button", { name: "Send message", exact: true }).click();
      await expect
        .poll(async () => Boolean((await client.session.get({ sessionID: session.id })).revert))
        .toBe(true);
      await expect(composer).toHaveValue("Produce the undo fixture response.");
      await expect(page.getByText("Undo staged", { exact: true })).toBeVisible();

      await composer.fill("/redo");
      await page.getByRole("option", { name: /\/redo/i }).click();
      await page.getByRole("button", { name: "Send message", exact: true }).click();
      await expect
        .poll(async () => Boolean((await client.session.get({ sessionID: session.id })).revert))
        .toBe(false);
      await expect(composer).toHaveValue("");
      await expect(page.getByText("Undo staged", { exact: true })).toHaveCount(0);
      await expect(response).toBeVisible();
    },
  },
  diagnostics: {
    description: "open live diagnostics, toggle the isolated overlay, and release collection",
    prompt: "",
    expectedModelCalls: 0,
    arrange() {},
    async run(page) {
      await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
      await page.getByRole("combobox", { name: "Search tasks and commands" }).fill("diagnostics");
      await page.getByRole("option", { name: /^Diagnostics/ }).click();
    },
    async assert(page, { runRoot }) {
      await page.getByRole("heading", { name: "Diagnostics", level: 1 }).waitFor();
      await expect
        .poll(() =>
          page.locator("[data-diagnostics-status]").getAttribute("data-diagnostics-status"),
        )
        .toBe("live");
      await page.getByText("Electron processes", { exact: true }).waitFor();
      await page.getByText("FPS", { exact: true }).waitFor();
      await page.getByText("React renders", { exact: true }).waitFor();
      await expect
        .poll(() =>
          page.evaluate(() => {
            const browser = globalThis as unknown as {
              palotDiagnostics?: { snapshot(): { collector: { sampleCount: number } } };
            };
            return browser.palotDiagnostics?.snapshot().collector.sampleCount ?? 0;
          }),
        )
        .toBeGreaterThanOrEqual(2);
      await expect(page.locator(".palot-chart")).toHaveCount(2);
      await expect(page.locator(".palot-chart svg")).toHaveCount(2);
      await page.screenshot({ path: join(runRoot, "diagnostics-dashboard.png") });

      await page.getByRole("switch", { name: "Diagnostic overlay" }).click();
      await page.getByRole("complementary", { name: "Diagnostics overlay" }).waitFor();
      await page.screenshot({ path: join(runRoot, "diagnostics-overlay.png") });
      await page.getByRole("button", { name: "Hide diagnostics overlay" }).click();
      await expect(page.getByRole("complementary", { name: "Diagnostics overlay" })).toHaveCount(0);

      const defaultViewport = page.viewportSize();
      await page.setViewportSize({ width: 920, height: 640 });
      await page.getByRole("heading", { name: "Diagnostics", level: 1 }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(runRoot, "diagnostics-dashboard-minimum.png") });

      await page.getByText("Resource history", { exact: true }).scrollIntoViewIfNeeded();
      const resourceChart = page.locator(".palot-chart").first();
      const chartBox = await resourceChart.boundingBox();
      if (!chartBox) throw new Error("Resource history chart has no layout box");
      await resourceChart.hover({
        position: { x: Math.max(8, chartBox.width - 12), y: chartBox.height / 2 },
      });
      const chartTooltip = resourceChart.locator(".palot-chart-tooltip:not([hidden])");
      await chartTooltip.waitFor();
      await expect(chartTooltip.locator(".ts-chart-tooltip__row")).toHaveCount(2);
      await page.screenshot({ path: join(runRoot, "diagnostics-chart-tooltip.png") });
      if (defaultViewport) await page.setViewportSize(defaultViewport);

      await page.evaluate(() => {
        (globalThis as unknown as { location: { hash: string } }).location.hash = "#/new";
      });
      await expect
        .poll(() =>
          page.evaluate(() => {
            const browser = globalThis as unknown as {
              palotDiagnostics?: { snapshot(): { phase: string } };
            };
            return browser.palotDiagnostics?.snapshot().phase ?? "missing";
          }),
        )
        .toBe("idle");
    },
  },
  "diagnostics-react-scan": {
    description: "enable React Scan before React, then disable it and leave the setting off",
    prompt: "",
    expectedModelCalls: 0,
    arrange() {},
    async run(page) {
      await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
      await page.getByRole("combobox", { name: "Search tasks and commands" }).fill("diagnostics");
      await page.getByRole("option", { name: /^Diagnostics/ }).click();
    },
    async assert(page) {
      await page.getByRole("heading", { name: "Diagnostics", level: 1 }).waitFor();
      await expect(page.getByRole("switch", { name: "React Scan" })).not.toBeChecked();

      await toggleReactScanAndWait(page, true);
      await page.getByText("React Scan is instrumenting this renderer", { exact: true }).waitFor();
      await expect(page.locator("[data-react-scan]")).toHaveCount(1);
      await expect(
        page.getByText(/Cannot read properties of undefined \(reading '__H'\)/),
      ).toHaveCount(0);

      await toggleReactScanAndWait(page, false);
      await expect(page.getByText("React Scan is instrumenting this renderer")).toHaveCount(0);
      await expect
        .poll(() =>
          page.evaluate(() => {
            const raw = localStorage.getItem("palot.desktop.state.diagnostics");
            if (!raw) return null;
            const stored = JSON.parse(raw) as {
              value?: { reactScanEnabled?: boolean | null };
            };
            return stored.value?.reactScanEnabled ?? null;
          }),
        )
        .toBe(false);
    },
  },
  "terminal-startup": {
    description: "open an interactive terminal without an initialization error",
    prompt: "",
    expectedModelCalls: 0,
    arrange() {},
    async run(page) {
      await page.keyboard.press("Control+Backquote");
    },
    async assert(page) {
      const terminal = page.locator("[data-workbench-terminal]");
      await terminal.waitFor();
      await terminal.locator("canvas").waitFor();
      await expect(terminal.locator("..").getByText("error", { exact: true })).toHaveCount(0);
      await expect(terminal.locator("..").getByText("connecting", { exact: true })).toHaveCount(0);
      const location = page.url();
      await terminal.locator("canvas").click();
      await page.keyboard.press("Control+k");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await page.keyboard.press("Control+BracketLeft");
      expect(page.url()).toBe(location);
    },
  },
  "workbench-tabs": {
    description: "open workspace files, diffs, and terminals in OpenCode-native tabs",
    prompt: "Reference the deterministic workbench fixture.",
    expectedModelCalls: 1,
    arrange(llm) {
      llm.text("Open `workbench-e2e.txt:1` to inspect the deterministic fixture.");
    },
    async run(page, { client, session, projectDirectory }) {
      await writeFile(join(projectDirectory, "workbench-e2e.txt"), "Palot workbench E2E\n");
      await client.session.prompt({
        sessionID: session.id,
        text: "Reference the workbench fixture.",
      });
      await client.session.wait({ sessionID: session.id });
      await page.getByRole("button", { name: "Show changes" }).click();
    },
    async assert(page, { client, session, projectDirectory }) {
      const probe = await client.experimental.persistentPty
        .create({
          sessionID: session.id,
          command: process.env.SHELL || "/bin/sh",
          args: ["-l"],
          cwd: projectDirectory,
          title: "E2E persistent PTY probe",
          env: { TERM: "xterm-256color" },
        })
        .catch(() => null);
      const persistentSupported = probe !== null;
      if (probe) await client.experimental.persistentPty.remove({ ptyID: probe.id });

      const runningTerminals = async () => {
        const persistent = await client.experimental.persistentPty
          .list({ sessionID: session.id })
          .catch(() => []);
        const legacy = await client.pty.list({
          location: { directory: projectDirectory },
        });
        return {
          persistent: persistent.filter((pty) => pty.status === "running").length,
          legacy: legacy.data.filter((pty) => pty.status === "running").length,
        };
      };
      const changedFile = page.locator('[data-palot-diff-header="workbench-e2e.txt"]');
      await changedFile.waitFor();
      await page.getByRole("button", { name: "Branch", exact: true }).click();
      await expect(page.getByRole("button", { name: "Branch", exact: true })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      // The unborn fixture has no review base. Branch mode must offer selection,
      // not invent a default or show an endless diff spinner.
      await expect(
        page.getByRole("button", { name: "Review base: Choose base", exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Working", exact: true }).click();
      await page.getByRole("region", { name: "Working tree review", exact: true }).waitFor();
      await changedFile.waitFor();
      await page.getByRole("button", { name: "Use split diff", exact: true }).click();
      await page.getByRole("button", { name: "Use unified diff", exact: true }).click();
      await page.getByRole("button", { name: "Collapse all diffs", exact: true }).click();
      await page.getByRole("button", { name: "Expand all diffs", exact: true }).click();
      await page
        .getByRole("button", { name: "Open workbench-e2e.txt in a tab", exact: true })
        .click();
      const diffTab = page.getByRole("tab", { name: "workbench-e2e.txt" });
      await diffTab.waitFor();
      await diffTab.click({ button: "right" });
      await page.getByRole("menuitem", { name: "Move to bottom" }).click();
      await page.locator('[data-workbench-pane="bottom"]').waitFor();
      await page.getByRole("button", { name: "Open workbench surface" }).last().click();
      await page.getByRole("menuitem", { name: "Terminal", exact: true }).click();
      const terminal = page.locator("[data-workbench-terminal]");
      await terminal.waitFor();
      await terminal.locator("canvas").waitFor({ timeout: 30_000 });
      await expect
        .poll(async () => {
          const running = await runningTerminals();
          return persistentSupported ? running.persistent : running.legacy;
        })
        .toBeGreaterThan(0);
      if (persistentSupported) {
        await expect.poll(async () => (await runningTerminals()).legacy).toBe(0);
      }

      await page.getByRole("button", { name: "Close Terminal" }).click();
      await expect
        .poll(async () => {
          const running = await runningTerminals();
          return running.persistent + running.legacy;
        })
        .toBeGreaterThan(0);
      await page.getByRole("tab", { name: "workbench-e2e.txt" }).waitFor();

      await page
        .getByRole("link", { name: "Open workbench-e2e.txt (line 1)", exact: true })
        .click();
      await page
        .locator('[data-workbench-pane="right"]')
        .getByRole("tab", { name: "workbench-e2e.txt" })
        .waitFor();
      await page.getByText("workbench-e2e.txt:1", { exact: true }).waitFor();
      await expect(page.getByText("Loading file", { exact: true })).toHaveCount(0);
      await expect(page.getByText("Could not load file", { exact: true })).toHaveCount(0);
      const filePane = page
        .locator('[data-workbench-pane="right"]')
        .getByRole("tabpanel", { name: "workbench-e2e.txt", exact: true });
      await expect(filePane.getByText("Palot workbench E2E", { exact: true })).toBeVisible();
      await writeFile(join(projectDirectory, "workbench-e2e.txt"), "Refreshed workbench E2E\n");
      await page.getByRole("button", { name: "Refresh file", exact: true }).click();
      await expect(filePane.getByText("Refreshed workbench E2E", { exact: true })).toBeVisible();
      await expect(filePane.getByText("Palot workbench E2E", { exact: true })).toHaveCount(0);
    },
  },
  "parallel-session-performance": parallelSessionPerformanceScenario(1),
  "input-streaming-performance": parallelSessionPerformanceScenario(
    1,
    PARALLEL_PERFORMANCE_LABELS,
    { input: true },
  ),
  "streaming-bottom-follow-stability": parallelSessionPerformanceScenario(
    1,
    PARALLEL_PERFORMANCE_LABELS,
    { input: true, stability: true },
  ),
  "parallel-session-memory": parallelSessionPerformanceScenario(5),
  "visible-session-performance": parallelSessionPerformanceScenario(1, ["ALPHA"]),
  "session-switch-performance": {
    description: "replace cached long transcripts and reopen them at the live edge immediately",
    prompt: "Populate two long sessions.",
    expectedModelCalls: 24,
    arrange(llm) {
      for (const label of ["ALPHA", "BETA"]) {
        for (let turn = 0; turn < 12; turn += 1) {
          llm.text(longTranscript(label, turn));
        }
      }
    },
    async run(page, { client, session, projectDirectory }) {
      for (let turn = 0; turn < 12; turn += 1) {
        await client.session.prompt({ sessionID: session.id, text: `Populate alpha ${turn}.` });
        await client.session.wait({ sessionID: session.id });
      }
      const secondSession = await client.session.create({
        location: { directory: projectDirectory },
      });
      await client.session.rename({
        sessionID: secondSession.id,
        title: "Palot E2E: session-switch-performance-beta",
      });
      for (let turn = 0; turn < 12; turn += 1) {
        await client.session.prompt({
          sessionID: secondSession.id,
          text: `Populate beta ${turn}.`,
        });
        await client.session.wait({ sessionID: secondSession.id });
      }

      await page.evaluate((sessionID) => {
        (globalThis as unknown as { location: { hash: string } }).location.hash =
          `#/sessions/${sessionID}`;
      }, secondSession.id);
    },
    async assert(page, { cssSelectorStats, profile, runRoot }) {
      // A tiling compositor can override BrowserWindow's requested dimensions.
      // Keep this inline-navigation benchmark at its documented logical size.
      await page.setViewportSize({ width: 1440, height: 920 });
      await page.getByRole("button", { name: /^(Show|Hide) navigation$/ }).evaluate((button) => {
        if (button.getAttribute("aria-pressed") === "false") (button as HTMLElement).click();
      });
      const alphaEnd = page.getByText("ALPHA END", { exact: true });
      const betaEnd = page.getByText("BETA END", { exact: true });
      await betaEnd.waitFor();
      await waitForTranscriptBottom(page);

      const alphaButton = page.getByRole("button", {
        name: /^Open Palot E2E: session-switch-performance, /,
      });
      await alphaButton.click();
      await alphaEnd.waitFor();
      await waitForTranscriptBottom(page);

      const betaButton = page.getByRole("button", {
        name: /^Open Palot E2E: session-switch-performance-beta, /,
      });
      await betaButton.waitFor();
      const switchToBeta = async () => {
        await betaButton.evaluate((button) => {
          button.addEventListener(
            "click",
            (event: { timeStamp: number }) => {
              const browser = globalThis as unknown as {
                document: Document;
                getComputedStyle(element: object): { opacity: string };
                performance: Performance;
                requestAnimationFrame(callback: () => void): number;
                __palotSessionSwitchStartedAt?: number;
                __palotSessionSwitchSamples?: SessionSwitchFrameSample[];
                __palotSessionSwitchSamplingComplete?: boolean;
              };
              browser.__palotSessionSwitchStartedAt = event.timeStamp;
              browser.__palotSessionSwitchSamples = [];
              browser.__palotSessionSwitchSamplingComplete = false;
              const deadline = event.timeStamp + 1_500;
              // Resolve exact-text markers only when their DOM is replaced. Keep geometry,
              // opacity and overlap sampling per-frame, without walking the transcript twice.
              let markerViewport: Element | null = null;
              let markersDirty = true;
              const markerCache = new Map<string, Element[]>();
              const markerObserver = new MutationObserver(() => {
                markersDirty = true;
              });
              let usefulResponseMarked = false;
              const captureFrame = () => {
                const viewport = browser.document.querySelector('[aria-label="Task transcript"]');
                if (viewport !== markerViewport) {
                  markerObserver.disconnect();
                  markerViewport = viewport;
                  markerCache.clear();
                  markersDirty = true;
                  if (viewport)
                    markerObserver.observe(viewport, {
                      childList: true,
                      characterData: true,
                      subtree: true,
                    });
                }
                if (markerObserver.takeRecords().length > 0) markersDirty = true;
                if (markersDirty && viewport) {
                  const missing = ["ALPHA END", "BETA END"].filter((expected) => {
                    const cached = markerCache.get(expected);
                    return (
                      !cached?.length ||
                      cached.some(
                        (element) =>
                          !viewport.contains(element) || element.textContent?.trim() !== expected,
                      )
                    );
                  });
                  if (missing.length > 0) {
                    const descendants = Array.from(viewport.querySelectorAll("*"));
                    for (const expected of missing) {
                      markerCache.set(
                        expected,
                        descendants.filter((element) => element.textContent?.trim() === expected),
                      );
                    }
                  }
                  markersDirty = false;
                }
                const currentTask = browser.document.querySelector('[aria-label="Current task"]');
                const composerDock = browser.document.querySelector("[data-palot-composer-dock]");
                const transcriptSurface = browser.document.querySelector(
                  "[data-palot-transcript-surface]",
                );
                const transcriptOpacity = transcriptSurface
                  ? Number.parseFloat(browser.getComputedStyle(transcriptSurface).opacity)
                  : 0;
                const transcriptVisible =
                  transcriptSurface?.getAttribute("data-palot-transcript-state") === "visible";
                const viewportRect = viewport?.getBoundingClientRect();
                const visibleRows =
                  viewport && viewportRect
                    ? Array.from(viewport.querySelectorAll("[data-message-id]"))
                        .map((row) => ({ row, rect: row.getBoundingClientRect() }))
                        .filter(
                          ({ rect }) =>
                            rect.bottom > viewportRect.top && rect.top < viewportRect.bottom,
                        )
                        .toSorted((left, right) => left.rect.top - right.rect.top)
                    : [];
                const findVisibleText = (expected: string) =>
                  viewport && viewportRect
                    ? markerCache.get(expected)?.find((element) => {
                        const rect = element.getBoundingClientRect();
                        return rect.bottom > viewportRect.top && rect.top < viewportRect.bottom;
                      })
                    : undefined;
                const target = findVisibleText("BETA END");
                if (
                  target &&
                  transcriptVisible &&
                  transcriptOpacity >= 0.99 &&
                  !usefulResponseMarked
                ) {
                  usefulResponseMarked = true;
                  browser.performance.mark("palot:session-switch:useful-response");
                }
                const lastRow = visibleRows.at(-1)?.rect;
                const composerTop = composerDock?.getBoundingClientRect().top;
                let maxOverlap = 0;
                for (let index = 1; index < visibleRows.length; index += 1) {
                  maxOverlap = Math.max(
                    maxOverlap,
                    visibleRows[index - 1]!.rect.bottom - visibleRows[index]!.rect.top,
                  );
                }
                browser.__palotSessionSwitchSamples?.push({
                  atMs: browser.performance.now() - event.timeStamp,
                  currentSessionReady:
                    currentTask?.textContent?.includes(
                      "Palot E2E: session-switch-performance-beta",
                    ) ?? false,
                  transcriptVisible,
                  transcriptOpacity,
                  targetVisible: target !== undefined,
                  staleVisible: findVisibleText("ALPHA END") !== undefined,
                  bottomGap: viewport
                    ? viewport.scrollHeight -
                      viewport.clientHeight -
                      Math.max(0, viewport.scrollTop)
                    : null,
                  composerClearance:
                    composerTop === undefined || lastRow === undefined
                      ? null
                      : composerTop - lastRow.bottom,
                  targetComposerClearance:
                    composerTop === undefined || target === undefined
                      ? null
                      : composerTop - target.getBoundingClientRect().bottom,
                  maxOverlap,
                  mountedVirtualTurns: viewport?.querySelectorAll("[data-index]").length ?? 0,
                });
                if (browser.performance.now() < deadline) {
                  browser.requestAnimationFrame(captureFrame);
                } else {
                  markerObserver.disconnect();
                  browser.__palotSessionSwitchSamplingComplete = true;
                }
              };
              captureFrame();
            },
            { capture: true, once: true },
          );
        });
        await betaButton.click();
        await page.evaluate(() => {
          const browser = globalThis as unknown as {
            __palotSessionSwitchStartedAt?: number;
          };
          const timestamp = browser.__palotSessionSwitchStartedAt;
          delete browser.__palotSessionSwitchStartedAt;
          if (timestamp === undefined) throw new Error("Session switch click was not observed");
        });
        return sampleSessionSwitchState(page);
      };
      const state = profile
        ? await measureInteraction(page, "long-transcript-session-switch", switchToBeta, {
            captureCssSelectorStats: cssSelectorStats,
          }).then(async ({ result, report }) => {
            const streamingLatency = await page.evaluate(() => {
              const browser = globalThis as unknown as {
                palotStreamingLatency?: () => unknown[];
              };
              return browser.palotStreamingLatency?.() ?? [];
            });
            const output = join(runRoot, "performance.json");
            await writeFile(
              output,
              JSON.stringify(
                { interaction: report, sessionSwitch: result, streamingLatency },
                null,
                2,
              ),
              { mode: 0o600 },
            );
            console.log(`Palot performance report: ${output}`);
            return result;
          })
        : await switchToBeta();

      expect(state.targetVisible).toBe(true);
      expect(state.staleVisible).toBe(false);
      expect(state.transcriptSettledAtMs).not.toBeNull();
      expect(state.transcriptFullyVisibleAtMs).not.toBeNull();
      if (!cssSelectorStats) {
        expect(state.transcriptSettledAtMs ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(150);
        expect(state.transcriptFullyVisibleAtMs ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(
          300,
        );
      }
      expect(state.transcriptFadeObserved).toBe(true);
      expect(state.maxSettlingOpacity).toBeLessThanOrEqual(0.01);
      expect(state.transcriptOpacityMonotonic).toBe(true);
      expect(state.maxBottomGap).not.toBeNull();
      expect(state.maxBottomGap ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(2);
      expect(state.maxOverlap).toBeLessThanOrEqual(1);
      expect(state.minComposerClearance).not.toBeNull();
      expect(state.minComposerClearance ?? Number.NEGATIVE_INFINITY).toBeGreaterThanOrEqual(12);
      expect(state.maxComposerClearanceShift).toBeLessThanOrEqual(2);
      expect(state.minTargetComposerClearance).not.toBeNull();
      expect(state.minTargetComposerClearance ?? Number.NEGATIVE_INFINITY).toBeGreaterThanOrEqual(
        12,
      );
      expect(state.maxTargetComposerClearanceShift).toBeLessThanOrEqual(2);
      expect(state.maxMountedVirtualTurns).toBeLessThan(12);

      const releasedBottomGap = await page.getByLabel("Task transcript").evaluate((viewport) => {
        viewport.scrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight - 1_200);
        return viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop;
      });
      expect(releasedBottomGap).toBeGreaterThan(500);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            (
              globalThis as unknown as { requestAnimationFrame(callback: () => void): number }
            ).requestAnimationFrame(() => resolve()),
          ),
      );
      await alphaButton.click();
      await alphaEnd.waitFor();
      await betaButton.click();
      await page
        .getByLabel("Current task")
        .getByText("Palot E2E: session-switch-performance-beta", { exact: true })
        .waitFor();
      await waitForTranscriptBottom(page);
      await betaEnd.waitFor();
    },
  },
  "transcript-prepend-restoration": {
    description:
      "automatically prepend older history on upward scrolling and preserve the visible reading anchor",
    prompt: "Load a cold paginated transcript and prepend its earlier messages.",
    expectedModelCalls: 72,
    arrange(llm) {
      for (let turn = 0; turn < 72; turn += 1) {
        llm.text(longTranscript("PREPEND", turn));
      }
    },
    async seed(
      client: OpenCodeClient,
      { projectDirectory, runRoot }: ScenarioSeedContext,
    ): Promise<void> {
      const session = await client.session.create({ location: { directory: projectDirectory } });
      await client.session.rename({
        sessionID: session.id,
        title: "Palot E2E: transcript-prepend-restoration-history",
      });
      for (let turn = 0; turn < 72; turn += 1) {
        await client.session.prompt({
          sessionID: session.id,
          text: `Populate prepend history ${turn}.`,
        });
        await client.session.wait({ sessionID: session.id });
      }
      await writeFile(join(runRoot, "prepend-session-id.txt"), session.id, { mode: 0o600 });
    },
    async run(page, { runRoot }) {
      const sessionID = (await readFile(join(runRoot, "prepend-session-id.txt"), "utf8")).trim();
      await page.evaluate((id) => {
        (globalThis as unknown as { location: { hash: string } }).location.hash =
          `#/sessions/${id}`;
      }, sessionID);
      await page.getByText("PREPEND turn 71 complete", { exact: true }).waitFor();
      await waitForTranscriptBottom(page);
    },
    async assert(page, { runRoot }) {
      const transcript = page.getByLabel("Task transcript");
      for (const pageNumber of [1, 2]) {
        await startTranscriptPrependProbe(page);
        try {
          await expect(
            page.getByRole("button", { name: "Load earlier messages", exact: true }),
          ).toHaveCount(0);
          await transcript.hover();
          await page.mouse.wheel(0, -1_000_000);
          await expect
            .poll(async () => (await readTranscriptPrependProbe(page)).anchor)
            .not.toBeNull();
          const { anchor } = await readTranscriptPrependProbe(page);
          if (!anchor) throw new Error("Missing automatic prepend anchor");
          await expect
            .poll(() => transcriptScrollHeight(page))
            .toBeGreaterThan(anchor.scrollHeight);
          await expect
            .poll(() => transcriptPrependAnchorShift(page, anchor))
            .toBeLessThanOrEqual(2);
          // Give range/measurement callbacks opportunities to expose duplicate requests.
          await waitForAnimationFrames(page, 20);
          // The full first page includes the existing one-message cursor verification.
          expect((await readTranscriptPrependProbe(page)).requests).toBe(pageNumber === 1 ? 2 : 1);
          if (pageNumber === 2) {
            await page.mouse.wheel(0, -1_000_000);
            await waitForAnimationFrames(page, 20);
            expect((await readTranscriptPrependProbe(page)).requests).toBe(1);
            await expect(
              transcript.getByText("Populate prepend history 0.", { exact: true }),
            ).toBeVisible();
          }
          await page.screenshot({
            path: join(runRoot, `transcript-infinite-scroll-anchor-${pageNumber}.png`),
          });
          await writeFile(
            join(runRoot, `transcript-infinite-scroll-${pageNumber}.json`),
            JSON.stringify(await readTranscriptPrependProbe(page)),
            { mode: 0o600 },
          );
        } finally {
          await writeFile(
            join(runRoot, `transcript-infinite-scroll-probe-${pageNumber}.json`),
            JSON.stringify(await readTranscriptPrependProbe(page)),
            { mode: 0o600 },
          );
          await page.evaluate(() => {
            (
              globalThis as unknown as { __palotPrependProbe?: { restore(): void } }
            ).__palotPrependProbe?.restore();
          });
        }
      }
    },
  },
  "message-auto-scroll": {
    description: "keep a long transcript at the live edge when sending from the composer",
    prompt: "Populate a long transcript, then send from the composer.",
    expectedModelCalls: 9,
    arrange(llm) {
      for (let turn = 0; turn < 8; turn += 1) {
        llm.text(longTranscript("HISTORY", turn));
      }
      llm.text("COMPOSER SEND COMPLETE");
    },
    async run(page, { client, session }) {
      for (let turn = 0; turn < 8; turn += 1) {
        await client.session.prompt({ sessionID: session.id, text: `Populate history ${turn}.` });
        await client.session.wait({ sessionID: session.id });
      }

      await page.getByText("HISTORY turn 7 complete", { exact: true }).waitFor();
      await waitForTranscriptBottom(page);
      await page.getByLabel("Task transcript").hover();
      await page.mouse.wheel(0, -1_200);
      await expect
        .poll(() =>
          page
            .getByLabel("Task transcript")
            .evaluate(
              (viewport) => viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop,
            ),
        )
        .toBeGreaterThan(500);
      await page.getByLabel("Message Palot").fill("Send from the long transcript.");
      await page.getByRole("button", { name: "Send message" }).click();
      await page
        .getByLabel("Task transcript", { exact: true })
        .getByText("Send from the long transcript.", { exact: true })
        .waitFor();
      await waitForTranscriptBottom(page);
    },
    async assert(page) {
      await page.getByText("COMPOSER SEND COMPLETE", { exact: true }).waitFor();
      await waitForTranscriptBottom(page);
    },
  },
  "render-react-scan": {
    description:
      "profile two long sessions through every native tool projection, subagents, switching, compaction, and continued work",
    prompt: "",
    expectedModelCalls: RENDER_EXPECTED_MODEL_CALLS,
    arrange(llm) {
      const fixtureURL = llm.fixture(
        "/fixtures/render-workload.md",
        "# Render workload fixture\n\nDeterministic local web content for the Palot E2E harness.\n",
        "text/markdown; charset=utf-8",
      );
      arrangeRenderHistory(llm, "ALPHA");
      arrangeRenderProjectionFlow(llm, "ALPHA", fixtureURL);
      arrangeRenderSubagentFlow(llm, "ALPHA");
      arrangeRenderHistory(llm, "BETA");
      arrangeRenderProjectionFlow(llm, "BETA", fixtureURL);
      arrangeRenderSubagentFlow(llm, "BETA");
      llm.textChunks(compactionSummaryChunks(), STREAM_CHUNK_DELAY_MS);
      arrangePostCompactionFlow(llm);
    },
    async run(page, { client, llm, session, projectDirectory }) {
      await Promise.all([
        mkdir(join(projectDirectory, "src"), { recursive: true }),
        mkdir(join(projectDirectory, "fixtures"), { recursive: true }),
        mkdir(join(projectDirectory, ".opencode/skills/render-e2e"), { recursive: true }),
      ]);
      await Promise.all([
        writeFile(
          join(projectDirectory, "package.json"),
          JSON.stringify({ type: "module", scripts: { check: "node src/check.js" } }, null, 2),
        ),
        writeFile(
          join(projectDirectory, "README.md"),
          "# Render workload\n\nTODO: exercise every native Palot tool projection.\n",
        ),
        writeFile(
          join(projectDirectory, "src/check.js"),
          'console.log("render workload check passed");\n',
        ),
        writeFile(
          join(projectDirectory, "fixtures/data.txt"),
          "alpha render fixture\nbeta render fixture\nprojection coverage\n",
        ),
        writeFile(
          join(projectDirectory, ".opencode/skills/render-e2e/SKILL.md"),
          [
            "---",
            "name: render-e2e",
            "description: Deterministic skill fixture for Palot render profiling.",
            "---",
            "",
            "Use the local render workload fixtures and report concise results.",
            "",
          ].join("\n"),
        ),
      ]);
      await writeFile(
        join(projectDirectory, "fixtures/pixel.png"),
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
          "base64",
        ),
      );

      const beta = await client.session.create({
        location: { directory: projectDirectory },
      });
      const alphaTitle = "Palot E2E: render-react-scan";
      const betaTitle = "Palot E2E: render-react-scan-beta";
      await client.session.rename({ sessionID: beta.id, title: betaTitle });
      await page.evaluate(
        ({ alphaSessionID, betaSessionID }) => {
          const browser = globalThis as unknown as {
            __palotRenderWorkload?: {
              sessions: { alpha: string; beta: string };
              switches: Array<{ target: string; visibleAtMs: number; staleVisible: boolean }>;
              coverage: Record<string, { names: string[]; kinds: string[] }>;
            };
          };
          browser.__palotRenderWorkload = {
            sessions: { alpha: alphaSessionID, beta: betaSessionID },
            switches: [],
            coverage: {},
          };
        },
        { alphaSessionID: session.id, betaSessionID: beta.id },
      );
      await page.getByRole("button", { name: /^Show inbox/ }).click();
      await expect(page.getByLabel("Inbox navigation")).toBeVisible();

      await resetReactScanPhase(page, "alpha-history");
      await populateRenderHistory(client, session.id, "ALPHA");
      await page.getByText("ALPHA HISTORY END", { exact: true }).waitFor();
      await finishReactScanPhase(page, "alpha-history", {
        visibleSession: "alpha",
        activitySession: "alpha",
      });

      await resetReactScanPhase(page, "alpha-tool-projections");
      await runRenderProjectionFlow(page, client, session.id, "ALPHA");
      await captureRenderedToolCoverage(page, "alpha");
      await finishReactScanPhase(page, "alpha-tool-projections", {
        visibleSession: "alpha",
        activitySession: "alpha",
      });

      await resetReactScanPhase(page, "alpha-subagent-parent-visible");
      await runRenderSubagentFlow(client, session.id, "ALPHA");
      await page.getByText("ALPHA SUBAGENT COMPLETE", { exact: true }).waitFor();
      await finishReactScanPhase(page, "alpha-subagent-parent-visible", {
        visibleSession: "alpha",
        activitySession: "alpha-subagent",
      });

      await resetReactScanPhase(page, "beta-history-parent-hidden");
      await populateRenderHistory(client, beta.id, "BETA");
      await expect(
        page.getByLabel("Current task").getByText(alphaTitle, { exact: true }),
      ).toBeVisible();
      await finishReactScanPhase(page, "beta-history-parent-hidden", {
        visibleSession: "alpha",
        activitySession: "beta",
      });

      await resetReactScanPhase(page, "switch-alpha-to-beta");
      await switchRenderSession(page, betaTitle, "BETA HISTORY END", "ALPHA HISTORY END");
      await finishReactScanPhase(page, "switch-alpha-to-beta", {
        visibleSession: "beta",
        activitySession: "switch",
      });

      await resetReactScanPhase(page, "beta-tool-projections");
      await runRenderProjectionFlow(page, client, beta.id, "BETA");
      await captureRenderedToolCoverage(page, "beta");
      await finishReactScanPhase(page, "beta-tool-projections", {
        visibleSession: "beta",
        activitySession: "beta",
      });

      await resetReactScanPhase(page, "switch-beta-to-alpha");
      await switchRenderSession(
        page,
        alphaTitle,
        "ALPHA SUBAGENT COMPLETE",
        "BETA TOOL PROJECTIONS COMPLETE",
      );
      await finishReactScanPhase(page, "switch-beta-to-alpha", {
        visibleSession: "alpha",
        activitySession: "switch",
      });

      await resetReactScanPhase(page, "beta-subagent-parent-hidden");
      const callsBeforeSubagent = llm.scriptedCalls();
      const betaSubagent = client.session.prompt({
        sessionID: beta.id,
        text: "Run the deterministic subagent workload for BETA.",
      });
      await llm.waitForCalls(callsBeforeSubagent + 2);
      await page.waitForTimeout(150);
      await expect(
        page.getByLabel("Current task").getByText(alphaTitle, { exact: true }),
      ).toBeVisible();
      await finishReactScanPhase(page, "beta-subagent-parent-hidden", {
        visibleSession: "alpha",
        activitySession: "beta-subagent",
      });

      await resetReactScanPhase(page, "switch-to-beta-mid-subagent");
      await switchRenderSession(page, betaTitle, null, "ALPHA SUBAGENT COMPLETE");
      await betaSubagent;
      await client.session.wait({ sessionID: beta.id });
      await page.getByText("BETA SUBAGENT COMPLETE", { exact: true }).waitFor();
      await finishReactScanPhase(page, "switch-to-beta-mid-subagent", {
        visibleSession: "beta",
        activitySession: "beta-subagent",
      });

      await resetReactScanPhase(page, "switch-back-to-alpha");
      await switchRenderSession(
        page,
        alphaTitle,
        "ALPHA SUBAGENT COMPLETE",
        "BETA SUBAGENT COMPLETE",
      );
      await finishReactScanPhase(page, "switch-back-to-alpha", {
        visibleSession: "alpha",
        activitySession: "switch",
      });

      await resetReactScanPhase(page, "alpha-manual-compaction");
      const callsBeforeCompaction = llm.scriptedCalls();
      const compact = await client.session.compact({ sessionID: session.id });
      await client.session.wait({ sessionID: session.id });
      // Check the protocol result before waiting on presentation: a rejected summary
      // can consume the continuation fixture on retry and leave a failed boundary.
      const compactionMessages = await client.message.list({
        sessionID: session.id,
        order: "desc",
        limit: 10,
      });
      expect(compactionMessages.data.find((message) => message.id === compact.id)).toMatchObject({
        type: "compaction",
        status: "completed",
        reason: "manual",
        summary: compactionSummaryChunks().join(""),
      });
      expect(llm.scriptedCalls()).toBe(callsBeforeCompaction + 1);
      await page.getByRole("button", { name: "Compaction completed" }).waitFor();
      await finishReactScanPhase(page, "alpha-manual-compaction", {
        visibleSession: "alpha",
        activitySession: "alpha",
      });

      await resetReactScanPhase(page, "alpha-post-compaction");
      await client.session.prompt({
        sessionID: session.id,
        text: "Continue after compaction and verify the render workload remains healthy.",
      });
      await client.session.wait({ sessionID: session.id });
      await page.getByText("ALPHA POST COMPACTION COMPLETE", { exact: true }).waitFor();
      await finishReactScanPhase(page, "alpha-post-compaction", {
        visibleSession: "alpha",
        activitySession: "alpha",
      });

      await resetReactScanPhase(page, "warm-switch-cycle");
      await switchRenderSession(
        page,
        betaTitle,
        "BETA SUBAGENT COMPLETE",
        "ALPHA POST COMPACTION COMPLETE",
      );
      await switchRenderSession(
        page,
        alphaTitle,
        "ALPHA POST COMPACTION COMPLETE",
        "BETA SUBAGENT COMPLETE",
      );
      await switchRenderSession(
        page,
        betaTitle,
        "BETA SUBAGENT COMPLETE",
        "ALPHA POST COMPACTION COMPLETE",
      );
      await switchRenderSession(
        page,
        alphaTitle,
        "ALPHA POST COMPACTION COMPLETE",
        "BETA SUBAGENT COMPLETE",
      );
      await finishReactScanPhase(page, "warm-switch-cycle", {
        visibleSession: "alpha",
        activitySession: "switch",
      });
    },
    async assert(page, { client, reactProfile, runRoot }) {
      const compaction = page.getByRole("button", { name: "Compaction completed" });
      expect(await compaction.getAttribute("aria-expanded")).toBe("false");
      expect(
        await page
          .getByText("Continue the ALPHA render workload after its native tool projections", {
            exact: false,
          })
          .count(),
      ).toBe(0);

      const browserReport = await page.evaluate(() => {
        const browser = globalThis as unknown as {
          __palotReactScanPhases?: unknown[];
          __palotRenderWorkload?: unknown;
        };
        return {
          phases: browser.__palotReactScanPhases ?? [],
          workload: browser.__palotRenderWorkload ?? null,
        };
      });
      expect(browserReport.phases).toHaveLength(13);
      expect(browserReport.workload).toMatchObject({
        sessions: { alpha: expect.any(String), beta: expect.any(String) },
        switches: expect.arrayContaining([
          expect.objectContaining({ target: "Palot E2E: render-react-scan-beta" }),
          expect.objectContaining({ target: "Palot E2E: render-react-scan" }),
        ]),
      });

      const workload = browserReport.workload as {
        sessions: { alpha: string; beta: string };
        coverage: Record<string, { names: string[]; kinds: string[] }>;
      };
      expect(await sessionToolNames(client, workload.sessions.alpha)).toEqual(
        expect.arrayContaining(RENDER_TOOL_NAMES),
      );
      expect(await sessionToolNames(client, workload.sessions.beta)).toEqual(
        expect.arrayContaining(RENDER_TOOL_NAMES),
      );
      expect(workload.coverage.alpha?.kinds).toEqual(expect.arrayContaining(RENDERED_TOOL_KINDS));
      expect(workload.coverage.beta?.kinds).toEqual(expect.arrayContaining(RENDERED_TOOL_KINDS));
      expect(workload.coverage.alpha?.names).toEqual(expect.arrayContaining(RENDERED_TOOL_NAMES));
      expect(workload.coverage.beta?.names).toEqual(expect.arrayContaining(RENDERED_TOOL_NAMES));

      const report = {
        scenario: "render-react-scan",
        renderer: "production",
        reactScan: true,
        reactProfiling: reactProfile,
        generatedAt: new Date().toISOString(),
        phases: browserReport.phases,
        workload: browserReport.workload,
        projectionCoverage: RENDER_TOOL_NAMES,
        changeReasonSource: "react-scan/lite",
        changeReasons: summarizeReactScanChangeReasons(browserReport.phases),
      };
      const output = join(runRoot, "react-scan.json");
      await writeFile(output, JSON.stringify(report, null, 2), { mode: 0o600 });
      console.log(`Palot React Scan report: ${output}`);
    },
  },
  "viewed-unread": {
    description: "preserve unread state on hover and acknowledge it when opened",
    prompt: "Return the scripted unread response.",
    expectedModelCalls: 1,
    arrange(llm) {
      llm.text("Unread E2E activity complete");
    },
    async run(page, { client, session, projectDirectory }) {
      const viewingSession = await client.session.create({
        location: { directory: projectDirectory },
      });
      await client.session.rename({
        sessionID: viewingSession.id,
        title: "Palot E2E: viewed-unread-current",
      });
      await page.evaluate((sessionID) => {
        (globalThis as unknown as { location: { hash: string } }).location.hash =
          `#/sessions/${sessionID}`;
      }, viewingSession.id);
      await page.getByLabel("Current task").waitFor();
      await client.session.prompt({ sessionID: session.id, text: "Return the unread response." });
    },
    async assert(page, { client, session }) {
      const target = page
        .locator("[data-palot-task-row], [data-palot-recent-row]")
        .filter({ has: page.getByText("Palot E2E: viewed-unread", { exact: true }) })
        .first();
      const unread = target.getByLabel("Unread task activity");
      await unread.waitFor();
      await target.hover();
      await unread.waitFor();
      await target.getByRole("button").click();
      await unread.waitFor({ state: "detached" });
      await expect
        .poll(async () => {
          const value = await client.session.get({ sessionID: session.id });
          return value.time.idle !== undefined && value.time.viewed === value.time.idle;
        })
        .toBe(true);
      const viewed = await client.session.get({ sessionID: session.id });
      if (viewed.time.idle === undefined || viewed.time.viewed !== viewed.time.idle) {
        throw new Error("Opening the unread task did not acknowledge the exact idle watermark");
      }
    },
  },
  "scheduled-run": {
    description: "create a local schedule and dispatch it through OpenCode",
    prompt: "Return the scripted setup response.",
    expectedModelCalls: 1,
    arrange(llm) {
      llm.text("Scheduled E2E setup ready");
      llm.text("Scheduled execution complete");
    },
    async assert(page) {
      await page.getByText("Scheduled E2E setup ready", { exact: true }).waitFor();
      await page.evaluate(() => {
        (globalThis as unknown as { location: { hash: string } }).location.hash = "#/scheduled";
      });
      await page.getByRole("heading", { name: "Scheduled tasks" }).waitFor();
      await page.getByRole("button", { name: "Create" }).click();
      await page.getByLabel("Scheduled task title").fill("Scheduled E2E sweep");
      await page
        .getByLabel("Scheduled task prompt")
        .fill("Run the isolated scheduled E2E task and return the scripted result.");
      await page.getByRole("combobox", { name: "Workspace" }).click();
      await page.getByRole("option", { name: "Current checkout" }).click();
      await page
        .getByLabel("Scheduled task editor")
        .getByRole("button", { name: "Create" })
        .click();
      await page.getByText("Scheduled E2E sweep", { exact: true }).waitFor();
      await page.getByRole("button", { name: "More scheduled task actions" }).click();
      await page.getByRole("menuitem", { name: "Run now" }).click();
      await page.getByText("Scheduled execution complete", { exact: true }).waitFor({
        timeout: 30_000,
      });
      await page.getByText("Ready", { exact: true }).waitFor();
      await page.evaluate(() => {
        (globalThis as unknown as { location: { hash: string } }).location.hash = "#/scheduled";
      });
      await page.getByRole("button", { name: "Open latest run for Scheduled E2E sweep" }).waitFor();
      await page.getByRole("button", { name: "Actions for Scheduled E2E sweep" }).click();
      await page.getByRole("menuitem", { name: "Open latest run", exact: true }).waitFor();
      await page.getByRole("menuitem", { name: "Run now", exact: true }).waitFor();
      await page.keyboard.press("Escape");
      await page.getByText("Scheduled E2E sweep", { exact: true }).click();
      const openLatestRun = page.getByRole("button", { name: "Open latest run", exact: true });
      await openLatestRun.waitFor();
      await openLatestRun.click();
      await page.getByText("Scheduled execution complete", { exact: true }).waitFor();
      if (
        (await page
          .locator("[data-palot-task-row], [data-palot-recent-row]")
          .filter({ hasText: "Scheduled E2E sweep" })
          .count()) !== 0
      ) {
        throw new Error("Successful scheduled sessions must stay grouped under Scheduled");
      }
    },
  },
  "scheduled-continuation": {
    description: "schedule a queue-only follow-up from an existing task",
    prompt: "Return the scripted continuation setup response.",
    expectedModelCalls: 1,
    arrange(llm) {
      llm.text("Scheduled continuation setup ready");
      llm.text("Scheduled continuation complete");
    },
    async assert(page) {
      await page.getByText("Scheduled continuation setup ready", { exact: true }).waitFor();
      await page
        .getByText("Palot E2E: scheduled-continuation", { exact: true })
        .first()
        .click({ button: "right" });
      await page.getByRole("menuitem", { name: "Schedule follow-up" }).click();
      await page.getByLabel("Scheduled task title").fill("Continuation E2E follow-up");
      await page
        .getByLabel("Scheduled task prompt")
        .fill("Queue the scripted scheduled continuation response.");
      await page
        .getByLabel("Scheduled task editor")
        .getByRole("button", { name: "Create" })
        .click();
      await page.getByRole("button", { name: "More scheduled task actions" }).click();
      await page.getByRole("menuitem", { name: "Run now" }).click();
      await page.getByText("Scheduled continuation complete", { exact: true }).waitFor({
        timeout: 30_000,
      });
      await page.getByText("Ready", { exact: true }).waitFor();
    },
  },
  "session-projection-settings": {
    description: "configure session projection presets and category rules",
    prompt: "Return the scripted projection settings response.",
    expectedModelCalls: 1,
    arrange(llm) {
      llm.text("Projection settings session ready");
    },
    async assert(page) {
      await page.getByText("Projection settings session ready", { exact: true }).waitFor();
      await page.evaluate(() => {
        (globalThis as unknown as { location: { hash: string } }).location.hash =
          "#/settings/general";
      });

      const expectedGeneralLabels = [
        ["Default workspace", "Worktree"],
        ["Approval behavior", "Ask"],
        ["Messages while running", "Queue"],
      ] as const;
      for (const [label, value] of expectedGeneralLabels) {
        const control = page.getByRole("combobox", { name: label });
        await control.waitFor();
        if (!(await control.textContent())?.includes(value)) {
          throw new Error(`${label} did not show ${value}`);
        }
      }
      await page.getByRole("switch", { name: "Launch at login" }).waitFor();
      await page.getByRole("switch", { name: "Prevent sleep during scheduled runs" }).waitFor();
      const autoBackground = page.getByRole("switch", {
        name: "Automatically send blocking work to background when steering",
      });
      await autoBackground.waitFor();
      if (await autoBackground.isChecked()) {
        throw new Error("Auto-background steering should be opt-in");
      }

      const timelineStyle = page.getByRole("combobox", { name: "Timeline style" });
      await timelineStyle.waitFor();
      if (!(await timelineStyle.textContent())?.includes("Balanced")) {
        throw new Error("Balanced was not the default timeline style");
      }
      const reasoningSummaries = page.getByRole("switch", {
        name: "Show reasoning summaries in the timeline",
      });
      const currentActivity = page.getByRole("switch", {
        name: "Keep current activity expanded",
      });
      await reasoningSummaries.waitFor();
      await currentActivity.waitFor();
      if (!(await reasoningSummaries.isChecked()) || !(await currentActivity.isChecked())) {
        throw new Error("Balanced timeline defaults were not enabled");
      }
      await timelineStyle.click();
      await page.getByRole("option", { name: "Detailed" }).click();
      await page
        .getByText(
          "Shows every activity row while keeping raw tool inputs and outputs inspectable.",
          { exact: true },
        )
        .waitFor();

      await page.getByRole("button", { name: "Customize timeline activity" }).click();
      await page.getByLabel("Edits display").waitFor();
      await page.getByLabel("Commands details").waitFor();
      await page.getByLabel("Completed turns").waitFor();

      await page.evaluate(() => {
        (globalThis as unknown as { location: { hash: string } }).location.hash =
          "#/settings/notifications";
      });
      const completionNotifications = page.getByRole("combobox", {
        name: "Turn completion notifications",
      });
      await completionNotifications.waitFor();
      if (!(await completionNotifications.textContent())?.includes("Always")) {
        throw new Error("Turn completion notifications did not default to Always");
      }
      for (const name of ["Permission notifications", "Question notifications"]) {
        const notification = page.getByRole("switch", { name });
        await notification.waitFor();
        if (!(await notification.isChecked())) {
          throw new Error(`${name} should default to enabled`);
        }
      }
    },
  },
  "interaction-streaming-performance": interactionStreamingPerformanceScenario,
  "batch-input-steady": batchInputPerformanceScenario("steady"),
  "batch-input-burst": batchInputPerformanceScenario("burst"),
  "subagent-success": {
    description: "a parent delegates to a general subagent and finishes",
    prompt: "Delegate this inspection to a general subagent, then summarize its result.",
    expectedModelCalls: 3,
    arrange(llm) {
      llm.tool("subagent", {
        agent: "general",
        description: "inspect bug",
        prompt: "look into the cache key path",
      });
      llm.text("The child inspected the cache key path successfully.");
      llm.text("The delegated inspection completed successfully.");
    },
    async assert(page) {
      await page
        .getByText("The delegated inspection completed successfully.", { exact: true })
        .waitFor();
      await page.getByText("inspect bug", { exact: true }).waitFor();
      await page.getByText("General finished", { exact: true }).waitFor();
    },
  },
  "subagent-card-stability": {
    description: "keep subagent summaries stable while their isolated elapsed counter advances",
    prompt: "Delegate a timed inspection to a general subagent.",
    expectedModelCalls: 3,
    arrange(llm) {
      llm.tool("subagent", {
        agent: "general",
        description: "Timed inspection",
        prompt: "Inspect the scripted fixture and report back.",
      });
      llm.reasoningAndTextChunks(
        Array.from({ length: 40 }, () => "Inspecting the timed fixture. "),
        Array.from({ length: 40 }, () => "The child inspection is progressing. "),
        100,
      );
      llm.text("The timed delegation completed.");
    },
    async run(page, { client, session, llm, runRoot }) {
      await client.session.prompt({ sessionID: session.id, text: this.prompt });
      await llm.waitForCalls(2);
      const card = page.getByRole("button", {
        name: "General subagent running: Timed inspection",
        exact: true,
      });
      await expect(card).toBeVisible();
      const timer = card.getByText(/^\d+(?:s|m(?: \d+s)?)$/);
      await expect(timer).toBeVisible();
      const initialText = await timer.textContent();
      const initialBox = await card.boundingBox();
      await expect(timer).not.toHaveText(initialText!, { timeout: 2_500 });
      await expect(card).toHaveAccessibleName("General subagent running: Timed inspection");
      await expect(card).not.toContainText("Inspecting the timed fixture");
      const nextBox = await card.boundingBox();
      expect(initialBox).not.toBeNull();
      expect(nextBox).not.toBeNull();
      expect(nextBox!.height).toBe(initialBox!.height);
      expect(nextBox!.width).toBe(initialBox!.width);
      await page.screenshot({ path: join(runRoot, "subagent-running.png") });
    },
    async assert(page, { runRoot }) {
      await page.getByText("The timed delegation completed.", { exact: true }).waitFor();
      const card = page.getByRole("button", {
        name: "General subagent finished: Timed inspection",
        exact: true,
      });
      await expect(card).toBeVisible();
      const timer = card.getByText(/^\d+(?:s|m(?: \d+s)?)$/);
      await expect(timer).toBeVisible();
      const finalText = await timer.textContent();
      await page.waitForTimeout(1_100);
      await expect(timer).toHaveText(finalText!);
      await page.screenshot({ path: join(runRoot, "subagent-finished.png") });
      await card.click();
      await expect(page.locator("[data-palot-subagent-session]")).toContainText("General subagent");
      await expect(page.getByText(/The child inspection is progressing/).first()).toBeVisible();
      await page.getByRole("button", { name: "Parent task", exact: true }).click();
      await expect(card).toBeVisible();
    },
  },
  "background-shell": {
    description: "offer to background work when a steer remains waiting",
    prompt: "Run the scripted shell command and wait for steering.",
    expectedModelCalls: 1,
    arrange(llm) {
      llm.tool("shell", { command: "sleep 30" });
      llm.text("The task continued while the shell command remained in the background.");
    },
    async assert(page) {
      await page
        .getByRole("button", { name: "Commands & terminals: 1 command", exact: true })
        .waitFor();
      if (
        await page
          .getByRole("button", {
            name: "Send blocking work to background so the message can steer this turn",
          })
          .count()
      ) {
        throw new Error("Background prompt appeared before a steer was submitted");
      }
      await page.getByRole("textbox", { name: "Message Palot" }).fill("Continue now");
      await page.getByRole("button", { name: "Choose message delivery" }).click();
      await page.getByRole("menuitemradio", { name: /Steer current turn/ }).click();
      await page.getByRole("button", { name: "Steer current turn" }).click();
      await page
        .getByText(
          "The shell command 'sleep 30' is blocking your message from steering this turn.",
          { exact: true },
        )
        .waitFor();
      await page
        .getByRole("button", {
          name: "Send blocking work to background so the message can steer this turn",
        })
        .click();
      await page
        .getByText("The task continued while the shell command remained in the background.", {
          exact: true,
        })
        .waitFor();
    },
  },
  "auto-background-steer": {
    description: "background work when a steer is still waiting after five seconds",
    prompt: "Run the scripted shell command and wait for steering.",
    expectedModelCalls: 1,
    arrange(llm) {
      llm.tool("shell", { command: "sleep 30" });
      llm.text("The steering message continued after the shell moved to the background.");
    },
    async assert(page) {
      await page
        .getByRole("button", { name: "Commands & terminals: 1 command", exact: true })
        .waitFor();
      const sessionHash = await page.evaluate(
        () => (globalThis as unknown as { location: { hash: string } }).location.hash,
      );
      await page.evaluate(() => {
        (globalThis as unknown as { location: { hash: string } }).location.hash =
          "#/settings/general";
      });
      const autoBackground = page.getByRole("switch", {
        name: "Automatically send blocking work to background when steering",
      });
      await autoBackground.waitFor();
      await autoBackground.click();
      await page.evaluate((hash) => {
        (globalThis as unknown as { location: { hash: string } }).location.hash = hash;
      }, sessionHash);
      await page.getByRole("textbox", { name: "Message Palot" }).fill("Continue now");
      await page.getByRole("button", { name: "Choose message delivery" }).click();
      await page.getByRole("menuitemradio", { name: /Steer current turn/ }).click();
      await page.getByRole("button", { name: "Steer current turn" }).click();
      await page
        .getByText("The steering message continued after the shell moved to the background.", {
          exact: true,
        })
        .waitFor();
    },
  },
  "response-interrupted": {
    description: "present a provider step interruption as a neutral stopped state",
    prompt: "Return the scripted interruption.",
    expectedModelCalls: 1,
    arrange(llm) {
      llm.error(400, { error: { type: "UnknownError", message: "Step interrupted" } });
    },
    async assert(page) {
      await page.getByRole("separator", { name: "Response interrupted" }).waitFor();
      await page
        .getByText("The active step stopped before a response was completed.", { exact: true })
        .waitFor();
      if (await page.getByRole("alert", { name: "Response failed" }).count()) {
        throw new Error("Step interruption was rendered as a response failure");
      }
    },
  },
} satisfies Record<string, Scenario>;

async function tabTo(page: Page, target: Locator, attempts = 30): Promise<void> {
  for (let index = 0; index < attempts; index += 1) {
    if (
      await target
        .evaluate(
          (element) =>
            element ===
            (globalThis as unknown as { document: { activeElement: unknown } }).document
              .activeElement,
        )
        .catch(() => false)
    ) {
      return;
    }
    await page.keyboard.press("Tab");
  }
  throw new Error(`Keyboard focus did not reach ${await target.getAttribute("aria-label")}`);
}

function cssDurationMilliseconds(value: string): number {
  const first = value.split(",", 1)[0]?.trim() ?? "";
  const duration = Number.parseFloat(first);
  return first.endsWith("ms") ? duration : duration * 1_000;
}

async function assertRouteAccessibility(page: Page, route: string): Promise<void> {
  const violations = await page.evaluate<string[]>(`(() => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      const bounds = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && bounds.width > 0 && bounds.height > 0;
    };
    const label = (element) => {
      const labelledBy = element.getAttribute("aria-labelledby");
      const labelledText = labelledBy
        ?.split(/\\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .join(" ");
      const htmlLabel = "labels" in element ? element.labels?.[0]?.textContent : "";
      return (
        element.getAttribute("aria-label") ||
        labelledText ||
        htmlLabel ||
        element.getAttribute("alt") ||
        element.getAttribute("title") ||
        element.textContent ||
        ""
      ).trim();
    };
    const results = [];
    const ids = [...document.querySelectorAll("[id]")].map((element) => element.id);
    const duplicates = ids.filter((id, index) => id && ids.indexOf(id) !== index);
    if (duplicates.length) results.push(
      "duplicate ids: " + [...new Set(duplicates)].join(", "),
    );
    for (const element of document.querySelectorAll(
      "button, a[href], input, select, textarea, [role='button'], [role='link']",
    )) {
      if (visible(element) && element.tabIndex >= 0 && !label(element)) {
        results.push("unlabelled " + element.tagName.toLowerCase());
      }
    }
    for (const image of document.querySelectorAll("img")) {
      if (visible(image) && !image.hasAttribute("alt")) results.push("image without alt");
    }
    for (const dialog of document.querySelectorAll("[role='dialog'], [role='alertdialog']")) {
      if (visible(dialog) && !label(dialog)) results.push("dialog without accessible name");
    }
    return results;
  })()`);
  expect(violations, `${route} accessibility violations`).toEqual([]);
}

export function scenarioNames(): ScenarioName[] {
  return Object.keys(scenarios) as ScenarioName[];
}

async function toggleReactScanAndWait(page: Page, enabled: boolean): Promise<void> {
  await Promise.all([
    page.waitForEvent("framenavigated", (frame) => frame === page.mainFrame()),
    page.getByRole("switch", { name: "React Scan" }).click(),
  ]);
  await page.getByRole("heading", { name: "Diagnostics", level: 1 }).waitFor();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const browser = globalThis as unknown as {
          palotDiagnostics?: {
            snapshot(): {
              preferences: {
                reactScanRequested: boolean;
                reactScanActive: boolean;
                reactScanStatus: string;
              };
            };
          };
        };
        return browser.palotDiagnostics?.snapshot().preferences ?? null;
      }),
    )
    .toMatchObject({
      reactScanRequested: enabled,
      reactScanActive: enabled,
      reactScanStatus: enabled ? "active" : "off",
    });
}

function longTranscript(label: string, turn: number): string {
  return [
    turn === 0 ? `${label} START` : `${label} turn ${turn}`,
    ...(turn === 6 ? [performanceMarkdownPage(`${label} long transcript`)] : []),
    ...Array.from(
      { length: 25 },
      (_, index) => `${label} ${String(turn).padStart(2, "0")}.${String(index).padStart(2, "0")}`,
    ),
    turn === 11 ? `${label} END` : `${label} turn ${turn} complete`,
  ].join("\n\n");
}

function parallelSessionPerformanceScenario(
  runs: number,
  labels: readonly (typeof PARALLEL_PERFORMANCE_LABELS)[number][] = PARALLEL_PERFORMANCE_LABELS,
  options: { input?: boolean; stability?: boolean } = {},
): Scenario {
  const expectedModelCalls = labels.length * PARALLEL_PERFORMANCE_MODEL_CALLS_PER_SESSION;
  // Input needs a reproducible overlap window, independent of the parallel stress override.
  const chunkDelayMs = options.input ? 30 : PARALLEL_PERFORMANCE_CHUNK_DELAY_MS;
  return {
    description: options.stability
      ? "diagnose active-turn geometry and bottom-follow stability while four sessions stream"
      : options.input
        ? "measure click focus and exact keyboard input while visible and background sessions stream"
        : labels.length === 1
          ? "measure visible-session React work without background session traffic"
          : runs === 1
            ? "measure main and renderer CPU while four sessions stream long text and parallel tool calls"
            : "measure memory retention across repeated four-session streaming workloads",
    prompt: "",
    expectedModelCalls: 0,
    arrange(llm) {
      for (const label of labels) {
        const marker = parallelPerformanceMarker(label);
        llm.route(marker, (script) => {
          for (let run = 0; run < runs; run += 1) {
            for (let cycle = 0; cycle < PARALLEL_PERFORMANCE_CYCLES; cycle += 1) {
              script.toolsWithReasoningAndText(
                parallelPerformanceTools(label, cycle),
                parallelPerformanceReasoningChunks(label, cycle),
                parallelPerformanceTextChunks(label, cycle),
                chunkDelayMs,
              );
            }
            script.textChunks(parallelPerformanceFinalChunks(label, run), chunkDelayMs);
          }
        });
      }
    },
    async run(page, { client, session, projectDirectory }) {
      await mkdir(join(projectDirectory, "fixtures"), { recursive: true });
      await Promise.all(
        labels.map((label) =>
          writeFile(
            join(projectDirectory, "fixtures", `${label.toLowerCase()}-stream.txt`),
            `${label} deterministic parallel performance fixture\nshared stream marker\n`,
          ),
        ),
      );
      const sessions: Array<{ id: string; label: (typeof PARALLEL_PERFORMANCE_LABELS)[number] }> = [
        { id: session.id, label: "ALPHA" },
      ];
      for (const label of labels.slice(1)) {
        const created = await client.session.create({ location: { directory: projectDirectory } });
        await client.session.rename({
          sessionID: created.id,
          title: `Palot E2E: parallel-session-${label.toLowerCase()}`,
        });
        sessions.push({ id: created.id, label });
      }
      await page.evaluate((value) => {
        (
          globalThis as unknown as { __palotParallelPerformance?: unknown }
        ).__palotParallelPerformance = value;
      }, sessions);
      await expect(page.getByLabel("Current task")).toBeVisible();
    },
    async assert(page, { client, llm, profile, runRoot }) {
      const sessions = await page.evaluate(() => {
        const value = (
          globalThis as unknown as {
            __palotParallelPerformance?: Array<{ id: string; label: string }>;
          }
        ).__palotParallelPerformance;
        if (!value) throw new Error("Parallel performance sessions were not prepared");
        return value;
      });
      const measuredCycles = [];
      if (options.input) {
        // Warm composer initialization outside the measured interval, then require a new click.
        const composer = page.getByRole("textbox", { name: "Message Palot", exact: true });
        await composer.click();
        await page.keyboard.type("warm");
        await composer.fill("");
        await composer.evaluate((element) => (element as HTMLElement).blur());
      }
      for (let run = 0; run < runs; run += 1) {
        const workload = async () => {
          await page.waitForTimeout(500);
          const startedAt = Date.now();
          if (!options.input) await startParallelScrollProbe(page);
          if (options.stability) await startStreamingStabilityProbe(page);
          let scrollProbe: ParallelScrollProbeSummary | null = null;
          let stabilityProbe: Awaited<ReturnType<typeof stopStreamingStabilityProbe>> | null = null;
          let input: Awaited<ReturnType<typeof inputUnderStreaming>> | null = null;
          try {
            const runSessions = async () => {
              await Promise.all(
                sessions.map(async ({ id, label }, index) => {
                  await new Promise((resolve) => setTimeout(resolve, index * 150));
                  await client.session.prompt({
                    sessionID: id,
                    text: `${parallelPerformanceMarker(label)} Run deterministic concurrent workload ${run + 1} for ${label}.`,
                  });
                  await client.session.wait({ sessionID: id });
                }),
              );
            };
            if (options.input)
              input = await inputUnderStreaming(
                page,
                client,
                sessions,
                runSessions,
                options.stability ? () => exerciseStreamingScrollIntent(page) : undefined,
              );
            else await runSessions();
            const expectedCalls = (run + 1) * expectedModelCalls;
            await llm.waitForCalls(expectedCalls);
            await page.waitForTimeout(500);
          } finally {
            if (!options.input) scrollProbe = await stopParallelScrollProbe(page);
            if (options.stability) {
              stabilityProbe = await stopStreamingStabilityProbe(page);
              await writeFile(
                join(runRoot, "streaming-stability.json"),
                JSON.stringify(stabilityProbe, null, 2),
                { mode: 0o600 },
              );
            }
          }
          return {
            run: run + 1,
            startedAt,
            completedAt: Date.now(),
            sessions,
            scrollProbe,
            ...(options.input ? { input } : {}),
            ...(options.stability ? { stabilityProbe } : {}),
            settings: {
              sessionCount: sessions.length,
              visibleSession: "ALPHA",
              cyclesPerSession: PARALLEL_PERFORMANCE_CYCLES,
              modelCallsPerSession: PARALLEL_PERFORMANCE_MODEL_CALLS_PER_SESSION,
              chunkDelayMs,
              sessionStaggerMs: 150,
              reasoningChunksPerCycle: 20,
              textChunksPerCycle: 80,
              parallelToolsPerCycle: 4,
              finalTextChunks: parallelPerformanceFinalChunks("ALPHA", run).length,
              ...(options.stability ? { geometryProbe: true } : {}),
            },
            routedModelCalls: Object.fromEntries(
              labels.map((label) => {
                const marker = parallelPerformanceMarker(label);
                return [label, llm.requests.filter((request) => request.route === marker).length];
              }),
            ),
          };
        };
        measuredCycles.push(
          profile
            ? await measureInteraction(
                page,
                options.stability
                  ? "streaming-bottom-follow-stability"
                  : options.input
                    ? "input-under-four-streaming-sessions"
                    : runs === 1
                      ? "four-parallel-streaming-sessions"
                      : `parallel-memory-cycle-${run + 1}`,
                workload,
                {
                  collectGarbage: runs > 1,
                  processSampleIntervalMs: 500,
                  captureLongAnimationFrames: options.input ?? false,
                },
              )
            : { result: await workload(), report: null },
        );
      }
      const finalCycle = measuredCycles.at(-1);
      if (!finalCycle) throw new Error("Parallel performance workload did not run");
      for (const label of labels) {
        expect(finalCycle.result.routedModelCalls[label]).toBe(
          runs * PARALLEL_PERFORMANCE_MODEL_CALLS_PER_SESSION,
        );
      }
      for (const cycle of measuredCycles) {
        expect(cycle.result.completedAt - cycle.result.startedAt).toBeGreaterThan(3_000);
        if (!cycle.result.scrollProbe) continue;
        console.log("Palot parallel scroll probe:", cycle.result.scrollProbe);
        expect(cycle.result.scrollProbe.longestBottomGapStreak).toBeLessThanOrEqual(5);
        expect(cycle.result.scrollProbe.longestComposerOverlapStreak).toBeLessThanOrEqual(12);
        expect(cycle.result.scrollProbe.longestUnlockedStreak).toBeLessThanOrEqual(5);
      }
      const reports = measuredCycles.flatMap((cycle) => (cycle.report ? [cycle.report] : []));
      if (reports.length > 0) {
        const streamingLatency = await page.evaluate(() => {
          const browser = globalThis as unknown as { palotStreamingLatency?: () => unknown[] };
          return browser.palotStreamingLatency?.() ?? [];
        });
        const output = join(runRoot, "performance.json");
        const payload =
          runs === 1
            ? {
                interaction: reports[0],
                workload: measuredCycles[0]?.result,
                streamingLatency,
              }
            : {
                cycles: reports,
                workloads: measuredCycles.map((cycle) => cycle.result),
                memoryPlateau: reports.map((report, index) => ({
                  cycle: index + 1,
                  rendererHeapUsedBytes: report.browserMetrics.after.JSHeapUsedSize,
                  rendererWorkingSetKiB:
                    report.appMetrics.after.processes.find((process) => process.type === "Tab")
                      ?.memory.workingSetSize ?? null,
                  appWorkingSetKiB: report.appMetrics.workingSetKiB.after,
                })),
                streamingLatency,
              };
        await writeFile(output, JSON.stringify(payload, null, 2), { mode: 0o600 });
        console.log(`Palot parallel performance report: ${output}`);
      }
      if (options.stability) {
        const stability = finalCycle.result.stabilityProbe;
        if (!stability) throw new Error("Streaming stability evidence was not collected");
        expect(
          stability.summary.complete,
          "geometry capture must not be missing or truncated",
        ).toBe(true);
        expect(stability.summary.phaseCounts["virtual-layout"]).toBeGreaterThan(0);
        expect(stability.summary.phaseCounts.raf).toBeGreaterThan(0);
        expect(stability.summary.settledTailSamples).toBeGreaterThan(0);
        expect(
          stability.summary.tailClearanceViolationCount,
          "active-tail clearance must stay stable in both directions, including row handoffs",
        ).toBe(0);
        expect(
          stability.summary.postLayoutExcursionCount,
          "status must not drop and snap back after virtual geometry is applied",
        ).toBe(0);
        expect(
          stability.summary.postLayoutOverlapCount,
          "bottom-locked status must clear the composer after virtual geometry is applied",
        ).toBe(0);
        // Outside the measured streaming window: grow/shrink the real composer
        // without submitting, and preserve the exact draft when finished.
        const composer = page.getByRole("textbox", { name: "Message Palot", exact: true });
        const dock = page.locator("[data-palot-composer-dock]");
        const draft = await composer.inputValue();
        const height = await dock.evaluate((element) => element.getBoundingClientRect().height);
        await composer.fill(
          `${draft}\n${Array.from({ length: 6 }, () => "Composer resize fixture").join("\n")}`,
        );
        await expect
          .poll(() => dock.evaluate((element) => element.getBoundingClientRect().height))
          .toBeGreaterThan(height + 16);
        await waitForTranscriptBottom(page);
        await composer.fill(draft);
        await expect
          .poll(() =>
            dock.evaluate(
              (element, initialHeight) =>
                Math.abs(element.getBoundingClientRect().height - initialHeight),
              height,
            ),
          )
          .toBeLessThanOrEqual(1);
        await waitForTranscriptBottom(page);
      }
    },
  };
}

async function exerciseStreamingScrollIntent(page: Page): Promise<void> {
  await setStreamingStabilityUserScroll(page, true);
  const viewport = page.getByLabel("Task transcript", { exact: true });
  await viewport.hover();
  await page.mouse.wheel(0, -900);
  await expect(viewport).toHaveAttribute("data-bottom-locked", "false");
  const before = await viewport.evaluate((element) => element.scrollTop);
  await page.waitForTimeout(350);
  await expect(viewport).toHaveAttribute("data-bottom-locked", "false");
  const after = await viewport.evaluate((element) => ({
    top: element.scrollTop,
    gap: element.scrollHeight - element.clientHeight - element.scrollTop,
  }));
  expect(after.gap).toBeGreaterThan(300);
  expect(
    Math.abs(after.top - before),
    "streaming must not pull an unlocked reader downward",
  ).toBeLessThanOrEqual(2);
  // Wheel back to the live edge without stealing keyboard focus from the draft.
  await page.mouse.wheel(0, 100_000);
  await expect(viewport).toHaveAttribute("data-bottom-locked", "true");
  await waitForTranscriptBottom(page);
  await setStreamingStabilityUserScroll(page, false);
}

function parallelPerformanceMarker(label: string): string {
  return `[PALOT_PARALLEL_${label}]`;
}

function parallelPerformanceReasoningChunks(label: string, cycle: number): string[] {
  return Array.from(
    { length: 20 },
    (_, index) =>
      `${label} reasoning ${cycle}.${String(index).padStart(2, "0")} checks concurrent event flow. `,
  );
}

function parallelPerformanceTextChunks(label: string, cycle: number): string[] {
  return Array.from(
    { length: 80 },
    (_, index) =>
      `${label} stream ${cycle}.${String(index).padStart(2, "0")} carries deterministic long-form text while background tools execute.\n`,
  );
}

function parallelPerformanceFinalChunks(label: string, run: number): string[] {
  return [
    ...Array.from(
      { length: 80 },
      (_, index) =>
        `${label} final ${String(index).padStart(2, "0")} drains the concurrent streaming workload cleanly.\n`,
    ),
    ...performanceMarkdownChunks(`${label} parallel stream ${run + 1}`),
    `${label} PARALLEL STREAM ${run + 1} COMPLETE`,
  ];
}

function performanceMarkdownChunks(label: string): string[] {
  return performanceMarkdownPage(label).match(/[\s\S]{1,360}/g) ?? [];
}

function performanceMarkdownPage(label: string): string {
  const tableRows = Array.from(
    { length: 16 },
    (_, index) =>
      `| ${index + 1} | ${label} row ${index + 1} | ${index % 2 === 0 ? "**bold**" : "_italic_"} | \`${index * 17}\` |`,
  );
  const nestedItems = Array.from(
    { length: 12 },
    (_, index) =>
      `  ${index + 1}. Nested item ${index + 1} with [link](https://example.com/${index + 1})`,
  );
  return [
    `# ${label}: streamed Markdown kitchen sink`,
    "## Headings, emphasis, and inline syntax",
    "### Third level",
    "#### Fourth level",
    "##### Fifth level",
    "###### Sixth level",
    "Plain text with **bold**, _italic_, ***combined***, ~~strikethrough~~, `inline code`, H~2~O, X^2^, ==highlight-like text==, escaped \\*asterisks\\*, &amp; entities, emoji 🧪, and CJK 日本語.",
    "A hard line break follows.  \nThis line should remain separate, while this deliberately long sentence wraps across the transcript viewport and includes https://example.com/a/very/long/path?with=query&and=values plus `snake_case_identifiers`.",
    "---",
    "## Lists and tasks",
    "- Unordered item\n  - Nested bullet\n    - Third level\n- [x] Completed task\n- [ ] Pending task",
    ["1. Ordered item", ...nestedItems, "2. Ordered continuation"].join("\n"),
    "> Blockquote level one\n>\n> > Nested quote with **formatting**\n>\n> Final quoted paragraph.",
    "## Links, media, and references",
    '[Inline link](https://example.com "Example title") · <https://example.com/autolink> · <markdown@example.com> · [reference link][reference].',
    "![Inline SVG test image](data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='16'%3E%3Crect width='32' height='16' fill='%23888'/%3E%3C/svg%3E)",
    '[reference]: https://example.com/reference "Reference title"',
    "## Table",
    ["| # | Name | Formatting | Value |", "|--:|:-----|:-----------|------:|", ...tableRows].join(
      "\n",
    ),
    "## Code fences",
    [
      "```typescript",
      "type StreamState = { chunks: number; complete: boolean };",
      "const state: StreamState = { chunks: 42, complete: false };",
      "console.log(state);",
      "```",
    ].join("\n"),
    ["```diff", "-const expensive = true;", "+const expensive = false;", "```"].join("\n"),
    ["```json", '{"markdown":true,"features":["table","code","quote"]}', "```"].join("\n"),
    ["```bash", "printf '%s\\n' 'streaming markdown'", "```"].join("\n"),
    ["````markdown", "```ts", "const nestedFence = true", "```", "````"].join("\n"),
    "## Extended syntax probes",
    "Term\n: Definition list content",
    "Here is a footnote reference.[^note]",
    "[^note]: Footnote text with `code` and a [link](https://example.com/footnote).",
    "Inline math probe $E = mc^2$ and block math:\n\n$$\\int_0^1 x^2 dx = \\frac{1}{3}$$",
    "<details><summary>Native HTML details</summary><p>Sanitized HTML content with <strong>bold</strong> text.</p></details>",
    "<kbd>⌘</kbd> + <kbd>K</kbd> · <mark>mark</mark> · <sub>sub</sub> · <sup>sup</sup>",
    "## Final paragraph",
    `${label} MARKDOWN FEATURE PAGE COMPLETE`,
  ].join("\n\n");
}

function parallelPerformanceTools(
  label: string,
  cycle: number,
): Array<{ name: string; input: unknown }> {
  const lower = label.toLowerCase();
  return [
    { name: "glob", input: { pattern: `fixtures/${lower}-*.txt` } },
    {
      name: "grep",
      input: { pattern: "shared stream marker", path: "fixtures", include: `${lower}-*.txt` },
    },
    { name: "read", input: { filePath: `fixtures/${lower}-stream.txt`, offset: 1, limit: 20 } },
    {
      name: "shell",
      input: {
        command: `node -e "process.stdout.write('${label} tool cycle ${cycle} complete\\n')"`,
        workdir: ".",
      },
    },
  ];
}

function streamChunks(value: string): string[] {
  return value.match(/\S+\s*/g) ?? [value];
}

function continuityChunks(prefix: string, count: number): string[] {
  return Array.from(
    { length: count },
    (_, index) => `${prefix}-${String(index + 1).padStart(2, "0")} `,
  );
}

interface StreamContinuityFrame {
  atMs: number;
  preTextCount: number;
  postTextCount: number;
  preReasoningCount: number;
  postReasoningCount: number;
  activityCount: number;
  activeStatus: string | null;
}

interface StreamContinuityPhaseReport {
  finalCount: number;
  maxJump: number;
  maxVisibleGapMs: number | null;
  updates: Array<{ atMs: number; count: number; jump: number }>;
}

interface StreamContinuityReport {
  durationMs: number;
  maxFrameIntervalMs: number;
  maxActivityJump: number;
  preText: StreamContinuityPhaseReport;
  postText: StreamContinuityPhaseReport;
  preReasoning: StreamContinuityPhaseReport;
  postReasoning: StreamContinuityPhaseReport;
  statusGapObserved: boolean;
  statusRegressed: boolean;
  statusMounts: number;
  frames: StreamContinuityFrame[];
}

interface StreamContinuityCycleReport extends StreamContinuityReport {
  cycle: string;
}

interface StreamContinuityOpenCodeEvent {
  at: number;
  created: number | null;
  type: string;
  delta?: string;
  id?: string;
  name?: string;
  ordinal?: number;
}

async function collectStreamContinuityEvents(
  client: OpenCodeClient,
  sessionID: string,
  signal: AbortSignal,
  output: StreamContinuityOpenCodeEvent[],
): Promise<void> {
  try {
    for await (const event of client.event.subscribe({ signal })) {
      const data = event.data as unknown;
      if (!data || typeof data !== "object" || Array.isArray(data)) continue;
      const record = data as Record<string, unknown>;
      if (record.sessionID !== sessionID) continue;
      output.push({
        at: Date.now(),
        created: "created" in event && typeof event.created === "number" ? event.created : null,
        type: event.type,
        ...(typeof record.delta === "string" ? { delta: record.delta } : {}),
        ...(typeof record.id === "string" ? { id: record.id } : {}),
        ...(typeof record.name === "string" ? { name: record.name } : {}),
        ...(typeof record.ordinal === "number" ? { ordinal: record.ordinal } : {}),
      });
    }
  } catch (error) {
    if (!signal.aborted) throw error;
  }
}

async function startStreamContinuityProbe(
  page: Page,
  prePrefix: string,
  postPrefix: string,
  preReasoningPrefix: string,
  postReasoningPrefix: string,
): Promise<void> {
  await page.evaluate(
    ({ prePrefix, postPrefix, preReasoningPrefix, postReasoningPrefix }) => {
      interface ProbeFrame {
        atMs: number;
        preTextCount: number;
        postTextCount: number;
        preReasoningCount: number;
        postReasoningCount: number;
        activityCount: number;
        activeStatus: string | null;
      }
      interface BrowserGlobal {
        document: {
          querySelector(selector: string): {
            textContent: string | null;
            getAttribute(name: string): string | null;
          } | null;
          querySelectorAll(selector: string): { length: number };
        };
        performance: { now(): number };
        requestAnimationFrame(callback: (timestamp: number) => void): number;
        cancelAnimationFrame(handle: number): void;
        __palotStreamContinuityProbe?: {
          startedAt: number;
          frameHandle: number;
          frames: ProbeFrame[];
          previousRafAt: number | null;
          maxRafIntervalMs: number;
          preTextPattern: RegExp;
          postTextPattern: RegExp;
          preReasoningPattern: RegExp;
          postReasoningPattern: RegExp;
          previousStatusElement: object | null;
          statusMounts: number;
        };
      }
      const browser = globalThis as unknown as BrowserGlobal;
      const previous = browser.__palotStreamContinuityProbe;
      if (previous) browser.cancelAnimationFrame(previous.frameHandle);
      const startedAt = browser.performance.now();
      const frames: ProbeFrame[] = [];
      const probe = {
        startedAt,
        frameHandle: 0,
        frames,
        previousRafAt: null as number | null,
        maxRafIntervalMs: 0,
        preTextPattern: new RegExp(`${prePrefix}-\\d{2}`, "g"),
        postTextPattern: new RegExp(`${postPrefix}-\\d{2}`, "g"),
        preReasoningPattern: new RegExp(`${preReasoningPrefix}-\\d{2}`, "g"),
        postReasoningPattern: new RegExp(`${postReasoningPrefix}-\\d{2}`, "g"),
        previousStatusElement: null as object | null,
        statusMounts: 0,
      };
      const capture = () => {
        const now = browser.performance.now();
        if (probe.previousRafAt !== null) {
          probe.maxRafIntervalMs = Math.max(probe.maxRafIntervalMs, now - probe.previousRafAt);
        }
        probe.previousRafAt = now;
        const transcript = browser.document.querySelector('[aria-label="Task transcript"]');
        const activeStatus = browser.document.querySelector(
          '[role="status"][aria-label^="Working for "], [role="status"][aria-label^="Finishing for "]',
        );
        if (activeStatus && activeStatus !== probe.previousStatusElement) probe.statusMounts += 1;
        probe.previousStatusElement = activeStatus;
        const text = transcript?.textContent ?? "";
        const frame = {
          atMs: now - startedAt,
          preTextCount: text.match(probe.preTextPattern)?.length ?? 0,
          postTextCount: text.match(probe.postTextPattern)?.length ?? 0,
          preReasoningCount: text.match(probe.preReasoningPattern)?.length ?? 0,
          postReasoningCount: text.match(probe.postReasoningPattern)?.length ?? 0,
          activityCount: browser.document.querySelectorAll("[data-palot-activity-group]").length,
          activeStatus: activeStatus?.getAttribute("aria-label") ?? null,
        };
        const last = frames.at(-1);
        if (
          !last ||
          frame.preTextCount !== last.preTextCount ||
          frame.postTextCount !== last.postTextCount ||
          frame.preReasoningCount !== last.preReasoningCount ||
          frame.postReasoningCount !== last.postReasoningCount ||
          frame.activityCount !== last.activityCount ||
          frame.activeStatus !== last.activeStatus
        ) {
          frames.push(frame);
        }
        probe.frameHandle = browser.requestAnimationFrame(capture);
      };
      browser.__palotStreamContinuityProbe = probe;
      capture();
    },
    { prePrefix, postPrefix, preReasoningPrefix, postReasoningPrefix },
  );
}

async function stopStreamContinuityProbe(page: Page): Promise<StreamContinuityReport> {
  return page.evaluate(() => {
    interface ProbeFrame {
      atMs: number;
      preTextCount: number;
      postTextCount: number;
      preReasoningCount: number;
      postReasoningCount: number;
      activityCount: number;
      activeStatus: string | null;
    }
    interface BrowserGlobal {
      performance: { now(): number };
      cancelAnimationFrame(handle: number): void;
      __palotStreamContinuityProbe?: {
        startedAt: number;
        frameHandle: number;
        frames: ProbeFrame[];
        previousRafAt: number | null;
        maxRafIntervalMs: number;
        preTextPattern: RegExp;
        postTextPattern: RegExp;
        preReasoningPattern: RegExp;
        postReasoningPattern: RegExp;
        previousStatusElement: object | null;
        statusMounts: number;
      };
    }
    const browser = globalThis as unknown as BrowserGlobal;
    const probe = browser.__palotStreamContinuityProbe;
    if (!probe) throw new Error("Stream continuity probe was not started");
    browser.cancelAnimationFrame(probe.frameHandle);
    delete browser.__palotStreamContinuityProbe;

    const phase = (
      key: "preTextCount" | "postTextCount" | "preReasoningCount" | "postReasoningCount",
    ) => {
      const updates: Array<{ atMs: number; count: number; jump: number }> = [];
      let previous = 0;
      for (const frame of probe.frames) {
        const count = frame[key];
        if (count <= previous) continue;
        updates.push({ atMs: frame.atMs, count, jump: count - previous });
        previous = count;
      }
      const gaps = updates.slice(1).map((entry, index) => entry.atMs - updates[index]!.atMs);
      return {
        finalCount: previous,
        maxJump: Math.max(0, ...updates.map((entry) => entry.jump)),
        maxVisibleGapMs: gaps.length > 0 ? Math.max(...gaps) : null,
        updates,
      };
    };
    let maxActivityJump = 0;
    for (let index = 1; index < probe.frames.length; index += 1) {
      maxActivityJump = Math.max(
        maxActivityJump,
        probe.frames[index]!.activityCount - probe.frames[index - 1]!.activityCount,
      );
    }
    const firstStatusIndex = probe.frames.findIndex((frame) => frame.activeStatus !== null);
    const lastStatusIndex = probe.frames.findLastIndex((frame) => frame.activeStatus !== null);
    const activeStatusFrames =
      firstStatusIndex < 0 || lastStatusIndex < firstStatusIndex
        ? []
        : probe.frames.slice(firstStatusIndex, lastStatusIndex + 1);
    let finishingObserved = false;
    let statusRegressed = false;
    for (const frame of activeStatusFrames) {
      if (frame.activeStatus?.startsWith("Finishing for ")) finishingObserved = true;
      if (finishingObserved && frame.activeStatus?.startsWith("Working for ")) {
        statusRegressed = true;
      }
    }
    return {
      durationMs: browser.performance.now() - probe.startedAt,
      maxFrameIntervalMs: probe.maxRafIntervalMs,
      maxActivityJump,
      preText: phase("preTextCount"),
      postText: phase("postTextCount"),
      preReasoning: phase("preReasoningCount"),
      postReasoning: phase("postReasoningCount"),
      statusGapObserved: activeStatusFrames.some((frame) => frame.activeStatus === null),
      statusRegressed,
      statusMounts: probe.statusMounts,
      frames: probe.frames,
    };
  });
}

function arrangeRenderHistory(llm: TestLLMServer, label: "ALPHA" | "BETA"): void {
  for (let turn = 0; turn < RENDER_HISTORY_TURNS; turn += 1) {
    llm.text(renderHistoryMessage(label, turn));
  }
}

function arrangeRenderProjectionFlow(
  llm: TestLLMServer,
  label: "ALPHA" | "BETA",
  fixtureURL: string,
): void {
  const lower = label.toLowerCase();
  const preamble = (value: string) =>
    streamChunks(`${label}: ${value} This call is part of the deterministic render workload. `);

  llm.toolWithText(
    "glob",
    { pattern: "**/*.{js,md,txt,png}" },
    preamble("I’ll start with native file discovery before inspecting content."),
    STREAM_CHUNK_DELAY_MS,
  );
  llm.toolWithText(
    "grep",
    { pattern: "render fixture|projection coverage", path: ".", include: "*.{md,txt}" },
    preamble("The file map is ready, so I’m exercising structured text search."),
    STREAM_CHUNK_DELAY_MS,
  );
  llm.toolWithText(
    "shell",
    { command: 'rg -n "render fixture|projection coverage" .', workdir: "." },
    preamble("I’m repeating search through the shell classifier to cover that projection path."),
    STREAM_CHUNK_DELAY_MS,
  );
  llm.toolWithText(
    "read",
    { filePath: "fixtures/data.txt", offset: 1, limit: 20 },
    preamble("The search results are stable; now I’m reading a numbered text range."),
    STREAM_CHUNK_DELAY_MS,
  );
  llm.toolWithText(
    "read",
    { filePath: "fixtures/pixel.png" },
    preamble("The text projection is covered, so I’m loading an image attachment."),
    STREAM_CHUNK_DELAY_MS,
  );
  llm.toolWithText(
    "write",
    {
      filePath: `src/generated-${lower}.js`,
      content: `export const ${lower}Value = 1;\n`,
    },
    preamble("I’m creating a session-specific source file to exercise write previews and diffs."),
    STREAM_CHUNK_DELAY_MS,
  );
  llm.toolWithText(
    "edit",
    {
      filePath: `src/generated-${lower}.js`,
      oldString: `export const ${lower}Value = 1;`,
      newString: `export const ${lower}Value = 2;`,
    },
    preamble("The new file exists; I’m applying a focused edit to the same source."),
    STREAM_CHUNK_DELAY_MS,
  );
  llm.toolWithText(
    "shell",
    {
      command: `node -e "process.stdout.write('\\u001b[32m${label} shell success\\u001b[0m\\n')"`,
      workdir: ".",
    },
    preamble("I’m running a successful command with ANSI output for terminal rendering."),
    STREAM_CHUNK_DELAY_MS,
  );
  llm.toolWithText(
    "shell",
    {
      command: `node -e "console.error('${label} expected failure'); process.exit(1)"`,
      workdir: ".",
    },
    preamble("The success state is covered; this command intentionally exercises the error state."),
    STREAM_CHUNK_DELAY_MS,
  );
  llm.toolWithText(
    "webfetch",
    { url: fixtureURL, format: "markdown" },
    preamble("I’m fetching deterministic local Markdown through the native web projection."),
    STREAM_CHUNK_DELAY_MS,
  );
  llm.toolWithText(
    "websearch",
    {},
    preamble(
      "I’m issuing an invalid deterministic web search to cover its error projection without external network traffic.",
    ),
    STREAM_CHUNK_DELAY_MS,
  );
  llm.toolWithText(
    "skill",
    { id: "render-e2e" },
    preamble("The network projections are covered; now I’m loading the local skill fixture."),
    STREAM_CHUNK_DELAY_MS,
  );
  llm.toolWithText(
    "execute",
    { code: `return { session: "${lower}", projections: 12, healthy: true };` },
    preamble("I’m exercising Code Mode with a deterministic local computation."),
    STREAM_CHUNK_DELAY_MS,
  );
  llm.toolWithText(
    "question",
    {
      questions: [
        {
          header: `${label} style`,
          question: `Which ${label} projection style should this deterministic workload use?`,
          options: [
            { label: `${label} concise`, description: "Keep the final result compact." },
            { label: `${label} detailed`, description: "Include extra projection detail." },
          ],
        },
      ],
    },
    preamble(
      "The automated projections are complete; I’m covering the blocking question workflow.",
    ),
    STREAM_CHUNK_DELAY_MS,
  );
  llm.textChunks(streamChunks(`${label} TOOL PROJECTIONS COMPLETE`), STREAM_FINAL_CHUNK_DELAY_MS);
}

function arrangeRenderSubagentFlow(llm: TestLLMServer, label: "ALPHA" | "BETA"): void {
  llm.toolWithText(
    "subagent",
    {
      agent: "general",
      description: `Inspect ${label.toLowerCase()} parent impact`,
      prompt: `Search the render fixture and report ${label} child completion.`,
    },
    streamChunks(
      `${label}: I’m delegating a focused search so we can measure the child session’s effect on its parent transcript and app shell. `,
    ),
    STREAM_CHUNK_DELAY_MS,
  );
  llm.toolWithText(
    "grep",
    { pattern: "projection coverage", path: "fixtures", include: "*.txt" },
    streamChunks(
      `${label} child: I’m locating the deterministic projection marker before reporting to the parent. `,
    ),
    STREAM_CHUNK_DELAY_MS,
  );
  llm.textChunks(
    streamChunks(`${label} CHILD COMPLETE: projection coverage marker found.`),
    STREAM_FINAL_CHUNK_DELAY_MS,
  );
  llm.textChunks(streamChunks(`${label} SUBAGENT COMPLETE`), STREAM_FINAL_CHUNK_DELAY_MS);
}

function arrangePostCompactionFlow(llm: TestLLMServer): void {
  llm.toolWithText(
    "read",
    { filePath: "src/generated-alpha.js" },
    streamChunks(
      "The compacted context is loaded. I’m reopening the generated source before continuing. ",
    ),
    STREAM_CHUNK_DELAY_MS,
  );
  llm.toolWithText(
    "edit",
    {
      filePath: "src/generated-alpha.js",
      oldString: "export const alphaValue = 2;",
      newString: "export const alphaValue = 3;",
    },
    streamChunks("The source matches the summary, so I’m applying the post-compaction update. "),
    STREAM_CHUNK_DELAY_MS,
  );
  llm.toolWithText(
    "shell",
    { command: "npm run check", workdir: "." },
    streamChunks(
      "The continuation edit is complete. I’m running the deterministic project check. ",
    ),
    STREAM_CHUNK_DELAY_MS,
  );
  llm.textChunks(streamChunks("ALPHA POST COMPACTION COMPLETE"), STREAM_FINAL_CHUNK_DELAY_MS);
}

function renderHistoryMessage(label: "ALPHA" | "BETA", turn: number): string {
  return [
    turn === 0 ? `${label} HISTORY START` : `${label} history turn ${turn}`,
    ...(turn === Math.floor(RENDER_HISTORY_TURNS / 2)
      ? [performanceMarkdownPage(`${label} render history`)]
      : []),
    ...Array.from(
      { length: 25 },
      (_, index) =>
        `${label} history ${String(turn).padStart(2, "0")}.${String(index).padStart(2, "0")} preserves deterministic transcript weight.`,
    ),
    turn === RENDER_HISTORY_TURNS - 1
      ? `${label} HISTORY END`
      : `${label} history turn ${turn} complete`,
  ].join("\n\n");
}

async function populateRenderHistory(
  client: OpenCodeClient,
  sessionID: string,
  label: "ALPHA" | "BETA",
): Promise<void> {
  for (let turn = 0; turn < RENDER_HISTORY_TURNS; turn += 1) {
    await client.session.prompt({ sessionID, text: `Populate ${label} history turn ${turn}.` });
    await client.session.wait({ sessionID });
  }
}

async function runRenderProjectionFlow(
  page: Page,
  client: OpenCodeClient,
  sessionID: string,
  label: "ALPHA" | "BETA",
): Promise<void> {
  const prompt = client.session.prompt({
    sessionID,
    text: `Run every deterministic native tool projection for ${label}.`,
  });
  const choice = page.locator(`input[value="${label} concise"]`);
  await choice.waitFor();
  await page.locator("[data-palot-composer-request]").waitFor();
  if (await page.getByRole("textbox", { name: "Message Palot" }).isVisible()) {
    throw new Error("The blocking question did not replace the composer body");
  }
  await choice.check({ force: true });
  await page.getByRole("button", { name: "Send", exact: true }).click({ force: true });
  await prompt;
  await client.session.wait({ sessionID });
  await page.getByText(`${label} TOOL PROJECTIONS COMPLETE`, { exact: true }).waitFor();
}

async function runRenderSubagentFlow(
  client: OpenCodeClient,
  sessionID: string,
  label: "ALPHA" | "BETA",
): Promise<void> {
  await client.session.prompt({
    sessionID,
    text: `Run the deterministic subagent workload for ${label}.`,
  });
  await client.session.wait({ sessionID });
}

async function switchRenderSession(
  page: Page,
  title: string,
  targetMarker: string | null,
  staleMarker: string,
): Promise<void> {
  const row = page
    .locator(
      "[data-palot-task-row], [data-palot-recent-row], [data-inbox-card], [data-inbox-compact-row]",
    )
    .filter({ has: page.getByText(title, { exact: true }) })
    .first();
  const button = row.getByRole("button").first();
  await button.waitFor();
  await button.evaluate((element) => {
    element.addEventListener(
      "click",
      (event: { timeStamp: number }) => {
        const browser = globalThis as unknown as { __palotRenderSwitchStartedAt?: number };
        browser.__palotRenderSwitchStartedAt = event.timeStamp;
      },
      { capture: true, once: true },
    );
  });
  await button.click();
  await page.getByLabel("Current task").getByText(title, { exact: true }).waitFor();
  if (targetMarker) await page.getByText(targetMarker, { exact: true }).waitFor();
  const staleVisible = await page
    .getByText(staleMarker, { exact: true })
    .isVisible()
    .catch(() => false);
  await page.evaluate(
    ({ target, stale }) => {
      const browser = globalThis as unknown as {
        __palotRenderSwitchStartedAt?: number;
        __palotRenderWorkload?: {
          switches: Array<{ target: string; visibleAtMs: number; staleVisible: boolean }>;
        };
      };
      const startedAt = browser.__palotRenderSwitchStartedAt;
      if (startedAt === undefined || !browser.__palotRenderWorkload) {
        throw new Error("Render workload switch was not initialized");
      }
      browser.__palotRenderWorkload.switches.push({
        target,
        visibleAtMs: performance.now() - startedAt,
        staleVisible: stale,
      });
      delete browser.__palotRenderSwitchStartedAt;
    },
    { target: title, stale: staleVisible },
  );
  expect(staleVisible).toBe(false);
}

async function sessionToolNames(client: OpenCodeClient, sessionID: string): Promise<string[]> {
  const response = await client.message.list({ sessionID, limit: 100, order: "asc" });
  return [
    ...new Set(
      response.data.flatMap((message) =>
        message.type === "assistant"
          ? message.content.flatMap((part) => (part.type === "tool" ? [part.name] : []))
          : [],
      ),
    ),
  ].toSorted();
}

async function captureRenderedToolCoverage(page: Page, session: "alpha" | "beta"): Promise<void> {
  let coverage = { names: [] as string[], kinds: [] as string[] };
  await expect
    .poll(
      async () => {
        const turns = page.locator("[data-palot-turn-activity]");
        for (let index = 0; index < (await turns.count()); index += 1) {
          const trigger = turns.nth(index).locator(':scope > button[aria-expanded="false"]');
          if ((await trigger.count()) > 0) await trigger.click({ force: true });
        }
        const groups = page.locator("[data-palot-activity-group]");
        for (let index = 0; index < (await groups.count()); index += 1) {
          const trigger = groups.nth(index).locator(':scope > button[aria-expanded="false"]');
          if ((await trigger.count()) > 0) await trigger.click({ force: true });
        }
        coverage = await page.locator("[data-palot-tool-kind]").evaluateAll((elements) => ({
          names: [
            ...new Set(
              elements
                .map((element) => element.getAttribute("data-palot-tool-name"))
                .filter((name): name is string => Boolean(name)),
            ),
          ].toSorted(),
          kinds: [
            ...new Set(
              elements
                .map((element) => element.getAttribute("data-palot-tool-kind"))
                .filter((kind): kind is string => Boolean(kind)),
            ),
          ].toSorted(),
        }));
        return coverage;
      },
      { timeout: 30_000 },
    )
    .toEqual({
      names: expect.arrayContaining(RENDERED_TOOL_NAMES),
      kinds: expect.arrayContaining(RENDERED_TOOL_KINDS),
    });
  await page.evaluate(
    ({ key, value }) => {
      const browser = globalThis as unknown as {
        __palotRenderWorkload?: {
          coverage: Record<string, { names: string[]; kinds: string[] }>;
        };
      };
      if (!browser.__palotRenderWorkload) throw new Error("Render workload was not initialized");
      browser.__palotRenderWorkload.coverage[key] = value;
    },
    { key: session, value: coverage },
  );
}

function summarizeReactScanChangeReasons(phases: unknown[]): unknown[] {
  return phases.flatMap((phase) => {
    if (!phase || typeof phase !== "object") return [];
    const value = phase as {
      name?: unknown;
      sample?: { components?: unknown };
    };
    if (typeof value.name !== "string" || !Array.isArray(value.sample?.components)) return [];
    const reasons = value.sample.components.flatMap((component) => {
      if (!component || typeof component !== "object") return [];
      const sample = component as {
        name?: unknown;
        unnecessaryRenderCount?: unknown;
        parentRenderCount?: unknown;
        changedProps?: unknown;
        changedState?: unknown;
        changedContext?: unknown;
      };
      if (typeof sample.name !== "string" || !actionableReactComponentName(sample.name)) return [];
      const changes = (
        [
          ["prop", sample.changedProps],
          ["state", sample.changedState],
          ["context", sample.changedContext],
        ] as const
      ).flatMap(([type, entries]) =>
        entries && typeof entries === "object" && !Array.isArray(entries)
          ? Object.entries(entries).flatMap(([name, count]) =>
              typeof count === "number" ? [{ component: sample.name, type, name, count }] : [],
            )
          : [],
      );
      const unnecessary =
        typeof sample.unnecessaryRenderCount === "number" && sample.unnecessaryRenderCount > 0
          ? [
              {
                component: sample.name,
                type: "unnecessary",
                name: "render",
                count: sample.unnecessaryRenderCount,
              },
            ]
          : [];
      const parent =
        typeof sample.parentRenderCount === "number" && sample.parentRenderCount > 0
          ? [
              {
                component: sample.name,
                type: "parent",
                name: "cascade",
                count: sample.parentRenderCount,
              },
            ]
          : [];
      return [...changes, ...parent, ...unnecessary];
    });
    return [
      {
        phase: value.name,
        reasons: reasons.toSorted((left, right) => right.count - left.count).slice(0, 25),
      },
    ];
  });
}

function actionableReactComponentName(name: string): boolean {
  return name !== "Unknown" && name !== "Anonymous" && !/^[a-z]$/.test(name);
}

function compactionSummaryChunks(): string[] {
  // OpenCode validates the structured summary template. Plain prose triggers a
  // retry, consuming the next response in this scenario's ordered model script.
  return streamChunks(
    [
      "## Objective",
      "- Continue the ALPHA render workload after its native tool projections and foreground subagent.",
      "",
      "## Work State",
      "### Completed",
      "- ALPHA completed the native tool-projection matrix and its foreground subagent workload.",
      "- BETA has an independent long transcript, projection matrix, and completed subagent.",
      "### Active",
      "- Update alphaValue from two to three and run the deterministic npm check.",
      "",
      "## Next Move",
      "1. Read src/generated-alpha.js, update alphaValue to three, and run npm run check.",
      "",
      "## Relevant Files",
      "- `src/generated-alpha.js`: currently exports alphaValue as two.",
    ].join("\n"),
  );
}

async function resetReactScanPhase(page: Page, name: string): Promise<void> {
  await page.evaluate((phaseName) => {
    const browser = globalThis as unknown as {
      palotReactScan?: { readAndReset(): unknown };
      __palotReactScanStarted?: { name: string; at: number };
    };
    if (!browser.palotReactScan) throw new Error("React Scan is not active");
    browser.palotReactScan.readAndReset();
    browser.__palotReactScanStarted = { name: phaseName, at: performance.now() };
  }, name);
}

async function finishReactScanPhase(
  page: Page,
  name: string,
  details?: Record<string, string>,
): Promise<void> {
  await page.evaluate(() => {
    const browser = globalThis as unknown as {
      requestAnimationFrame(callback: () => void): number;
    };
    return new Promise<void>((resolve) =>
      browser.requestAnimationFrame(() => browser.requestAnimationFrame(() => resolve())),
    );
  });
  await page.evaluate(
    ({ phaseName, phaseDetails }) => {
      const browser = globalThis as unknown as {
        palotReactScan?: { readAndReset(): unknown };
        __palotReactScanStarted?: { name: string; at: number };
        __palotReactScanPhases?: unknown[];
      };
      const started = browser.__palotReactScanStarted;
      if (!browser.palotReactScan || !started || started.name !== phaseName) {
        throw new Error(`React Scan phase '${phaseName}' was not started`);
      }
      browser.__palotReactScanPhases ??= [];
      browser.__palotReactScanPhases.push({
        name: phaseName,
        durationMs: performance.now() - started.at,
        ...(phaseDetails ? { details: phaseDetails } : {}),
        sample: browser.palotReactScan.readAndReset(),
      });
      delete browser.__palotReactScanStarted;
    },
    { phaseName: name, phaseDetails: details },
  );
}

interface TranscriptPrependAnchor {
  turnID: string;
  viewportTop: number;
  scrollHeight: number;
}

interface ParallelScrollProbeSummary {
  samples: number;
  maxBottomGap: number;
  longestBottomGapStreak: number;
  longestComposerOverlapStreak: number;
  longestUnlockedStreak: number;
  firstBottomGap: {
    sample: number;
    scrollTop: number;
    scrollHeight: number;
    clientHeight: number;
  } | null;
  finalMetrics: { scrollTop: number; scrollHeight: number; clientHeight: number } | null;
}

async function startParallelScrollProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const browser = globalThis as unknown as {
      requestAnimationFrame(callback: () => void): number;
      cancelAnimationFrame(frame: number): void;
      document: {
        querySelector(selector: string): {
          scrollHeight: number;
          scrollTop: number;
          clientHeight: number;
          getAttribute(name: string): string | null;
          getBoundingClientRect(): { top: number; bottom: number };
          querySelectorAll(selector: string): ArrayLike<{
            getBoundingClientRect(): { top: number; bottom: number };
          }>;
        } | null;
      };
      __palotParallelScrollProbe?: {
        frame: number;
        samples: number;
        maxBottomGap: number;
        bottomGapStreak: number;
        longestBottomGapStreak: number;
        composerOverlapStreak: number;
        longestComposerOverlapStreak: number;
        unlockedStreak: number;
        longestUnlockedStreak: number;
        firstBottomGap: {
          sample: number;
          scrollTop: number;
          scrollHeight: number;
          clientHeight: number;
        } | null;
        finalMetrics: { scrollTop: number; scrollHeight: number; clientHeight: number } | null;
      };
    };
    if (browser.__palotParallelScrollProbe) {
      browser.cancelAnimationFrame(browser.__palotParallelScrollProbe.frame);
    }
    const probe: NonNullable<typeof browser.__palotParallelScrollProbe> = {
      frame: 0,
      samples: 0,
      maxBottomGap: 0,
      bottomGapStreak: 0,
      longestBottomGapStreak: 0,
      composerOverlapStreak: 0,
      longestComposerOverlapStreak: 0,
      unlockedStreak: 0,
      longestUnlockedStreak: 0,
      firstBottomGap: null,
      finalMetrics: null,
    };
    const sample = () => {
      const viewport = browser.document.querySelector('[aria-label="Task transcript"]');
      const composer = browser.document.querySelector("[data-palot-composer-dock]");
      const turns = viewport?.querySelectorAll("[data-turn-row-id]");
      const finalTurn = turns && turns.length > 0 ? turns[turns.length - 1] : null;
      const unlocked = viewport?.getAttribute("data-bottom-locked") === "false";
      if (viewport) {
        const bottomGap = Math.max(
          0,
          viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight,
        );
        const composerOverlap =
          composer && finalTurn
            ? Math.max(
                0,
                finalTurn.getBoundingClientRect().bottom - composer.getBoundingClientRect().top,
              )
            : 0;
        probe.samples += 1;
        probe.finalMetrics = {
          scrollTop: viewport.scrollTop,
          scrollHeight: viewport.scrollHeight,
          clientHeight: viewport.clientHeight,
        };
        probe.maxBottomGap = Math.max(probe.maxBottomGap, bottomGap);
        if (bottomGap > 40 && probe.firstBottomGap === null) {
          probe.firstBottomGap = { sample: probe.samples, ...probe.finalMetrics };
        }
        probe.bottomGapStreak = bottomGap > 40 ? probe.bottomGapStreak + 1 : 0;
        probe.longestBottomGapStreak = Math.max(
          probe.longestBottomGapStreak,
          probe.bottomGapStreak,
        );
        probe.composerOverlapStreak = composerOverlap > 2 ? probe.composerOverlapStreak + 1 : 0;
        probe.longestComposerOverlapStreak = Math.max(
          probe.longestComposerOverlapStreak,
          probe.composerOverlapStreak,
        );
        probe.unlockedStreak = unlocked ? probe.unlockedStreak + 1 : 0;
        probe.longestUnlockedStreak = Math.max(probe.longestUnlockedStreak, probe.unlockedStreak);
      }
      probe.frame = browser.requestAnimationFrame(sample);
    };
    browser.__palotParallelScrollProbe = probe;
    probe.frame = browser.requestAnimationFrame(sample);
  });
}

async function stopParallelScrollProbe(page: Page): Promise<ParallelScrollProbeSummary> {
  return page.evaluate(() => {
    const browser = globalThis as unknown as {
      cancelAnimationFrame(frame: number): void;
      __palotParallelScrollProbe?: {
        frame: number;
        samples: number;
        maxBottomGap: number;
        longestBottomGapStreak: number;
        longestComposerOverlapStreak: number;
        longestUnlockedStreak: number;
        firstBottomGap: {
          sample: number;
          scrollTop: number;
          scrollHeight: number;
          clientHeight: number;
        } | null;
        finalMetrics: { scrollTop: number; scrollHeight: number; clientHeight: number } | null;
      };
    };
    const probe = browser.__palotParallelScrollProbe;
    if (!probe) throw new Error("Parallel scroll probe was not started");
    browser.cancelAnimationFrame(probe.frame);
    delete browser.__palotParallelScrollProbe;
    return {
      samples: probe.samples,
      maxBottomGap: probe.maxBottomGap,
      longestBottomGapStreak: probe.longestBottomGapStreak,
      longestComposerOverlapStreak: probe.longestComposerOverlapStreak,
      longestUnlockedStreak: probe.longestUnlockedStreak,
      firstBottomGap: probe.firstBottomGap,
      finalMetrics: probe.finalMetrics,
    };
  });
}

async function waitForAnimationFrames(page: Page, count: number): Promise<void> {
  await page.evaluate((frameCount) => {
    const browser = globalThis as unknown as {
      requestAnimationFrame(callback: () => void): number;
    };
    return new Promise<void>((resolve) => {
      let remaining = frameCount;
      const next = () => {
        remaining -= 1;
        if (remaining <= 0) resolve();
        else browser.requestAnimationFrame(next);
      };
      browser.requestAnimationFrame(next);
    });
  }, count);
}

async function startTranscriptPrependProbe(page: Page): Promise<void> {
  await page.getByLabel("Task transcript").evaluate((viewport) => {
    const transcript = viewport as unknown as {
      scrollHeight: number;
      getBoundingClientRect(): { top: number };
      querySelectorAll(selector: string): ArrayLike<{
        dataset: { turnRowId?: string };
        getBoundingClientRect(): { top: number; bottom: number };
      }>;
    };
    const browser = globalThis as unknown as {
      console: { debug(...args: unknown[]): void };
      __palotPrependProbe?: {
        anchor: TranscriptPrependAnchor | null;
        requests: number;
        restore(): void;
      };
    };
    const original = browser.console.debug;
    const probe = {
      anchor: null as TranscriptPrependAnchor | null,
      requests: 0,
      restore() {
        browser.console.debug = original;
        delete browser.__palotPrependProbe;
      },
    };
    browser.__palotPrependProbe = probe;
    // Observe the real request boundary synchronously before IPC returns the page.
    // This diagnostic capture changes no response/state and is not a benchmark.
    browser.console.debug = (...args) => {
      const prefix = "[opencode-client] request started ";
      if (typeof args[0] === "string" && args[0].startsWith(prefix)) {
        const request = JSON.parse(args[0].slice(prefix.length)) as { path: string };
        if (/\/message\?.*\bcursor\b/.test(request.path) && !/\btype\b/.test(request.path)) {
          probe.requests += 1;
          if (!probe.anchor) {
            const viewportTop = transcript.getBoundingClientRect().top;
            const anchor = Array.from(transcript.querySelectorAll('[data-scroll-anchor="true"]'))
              .map((element) => ({ element, rect: element.getBoundingClientRect() }))
              .filter(({ rect }) => rect.bottom >= viewportTop)
              .toSorted((left, right) => left.rect.top - right.rect.top)[0];
            const turnID = anchor?.element.dataset.turnRowId;
            if (anchor && turnID)
              probe.anchor = {
                turnID,
                viewportTop: anchor.rect.top - viewportTop,
                scrollHeight: transcript.scrollHeight,
              };
          }
        }
      }
      original(...args);
    };
  });
}

async function readTranscriptPrependProbe(
  page: Page,
): Promise<{ anchor: TranscriptPrependAnchor | null; requests: number }> {
  return page.evaluate(() => {
    const probe = (
      globalThis as unknown as {
        __palotPrependProbe: { anchor: TranscriptPrependAnchor | null; requests: number };
      }
    ).__palotPrependProbe;
    return { anchor: probe.anchor, requests: probe.requests };
  });
}

async function transcriptScrollHeight(page: Page): Promise<number> {
  return page.getByLabel("Task transcript").evaluate((viewport) => viewport.scrollHeight);
}

async function transcriptPrependAnchorShift(
  page: Page,
  expected: TranscriptPrependAnchor,
): Promise<number> {
  return page.getByLabel("Task transcript").evaluate((viewport, anchorState) => {
    const transcript = viewport as unknown as {
      getBoundingClientRect(): { top: number };
      querySelectorAll(selector: string): ArrayLike<{
        dataset: { turnRowId?: string };
        getBoundingClientRect(): { top: number };
      }>;
    };
    const anchor = Array.from(transcript.querySelectorAll("[data-turn-row-id]")).find(
      (element) => element.dataset.turnRowId === anchorState.turnID,
    );
    if (!anchor) return Number.POSITIVE_INFINITY;
    return Math.abs(
      anchor.getBoundingClientRect().top -
        transcript.getBoundingClientRect().top -
        anchorState.viewportTop,
    );
  }, expected);
}

async function waitForTranscriptBottom(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page
        .getByLabel("Task transcript")
        .evaluate(
          (viewport) =>
            viewport.scrollHeight - viewport.clientHeight - Math.max(0, viewport.scrollTop),
        ),
    )
    .toBeLessThanOrEqual(2);
}

interface SessionSwitchFrameSample {
  atMs: number;
  currentSessionReady: boolean;
  transcriptVisible: boolean;
  transcriptOpacity: number;
  targetVisible: boolean;
  staleVisible: boolean;
  bottomGap: number | null;
  composerClearance: number | null;
  targetComposerClearance: number | null;
  maxOverlap: number;
  mountedVirtualTurns: number;
}

async function sampleSessionSwitchState(page: Page) {
  return page.evaluate(async () => {
    const browser = globalThis as unknown as {
      matchMedia(query: string): { matches: boolean };
      requestAnimationFrame(callback: () => void): number;
      __palotSessionSwitchSamples?: SessionSwitchFrameSample[];
      __palotSessionSwitchSamplingComplete?: boolean;
    };
    while (!browser.__palotSessionSwitchSamplingComplete) {
      await new Promise<void>((resolve) => browser.requestAnimationFrame(() => resolve()));
    }
    const readySamples = (browser.__palotSessionSwitchSamples ?? []).filter(
      (sample) => sample.currentSessionReady,
    );
    const settlingSamples = readySamples.filter((sample) => !sample.transcriptVisible);
    const visibleSamples = readySamples.filter((sample) => sample.transcriptVisible);
    const fullyVisibleSamples = visibleSamples.filter((sample) => sample.transcriptOpacity >= 0.99);
    const targetSamples = visibleSamples.filter((sample) => sample.targetVisible);
    const bottomGaps = visibleSamples.flatMap((sample) =>
      sample.bottomGap === null ? [] : [sample.bottomGap],
    );
    const composerClearances = visibleSamples.flatMap((sample) =>
      sample.composerClearance === null ? [] : [sample.composerClearance],
    );
    const targetComposerClearances = targetSamples.flatMap((sample) =>
      sample.targetComposerClearance === null ? [] : [sample.targetComposerClearance],
    );
    return {
      targetVisible: targetSamples.length > 0,
      targetVisibleAtMs: targetSamples[0]?.atMs ?? null,
      transcriptSettledAtMs: visibleSamples[0]?.atMs ?? null,
      transcriptFullyVisibleAtMs: fullyVisibleSamples[0]?.atMs ?? null,
      transcriptFadeObserved:
        browser.matchMedia("(prefers-reduced-motion: reduce)").matches ||
        visibleSamples.some(
          (sample) => sample.transcriptOpacity > 0.01 && sample.transcriptOpacity < 0.99,
        ),
      maxSettlingOpacity: Math.max(0, ...settlingSamples.map((sample) => sample.transcriptOpacity)),
      transcriptOpacityMonotonic: readySamples.every((sample, index, samples) => {
        const previous = samples[index - 1];
        return !previous || sample.transcriptOpacity + 0.01 >= previous.transcriptOpacity;
      }),
      staleVisible: visibleSamples.some((sample) => sample.staleVisible),
      maxOverlap: Math.max(0, ...visibleSamples.map((sample) => sample.maxOverlap)),
      maxBottomGap: bottomGaps.length ? Math.max(...bottomGaps) : null,
      minComposerClearance: composerClearances.length ? Math.min(...composerClearances) : null,
      maxComposerClearanceShift: composerClearances.length
        ? Math.max(...composerClearances) - Math.min(...composerClearances)
        : null,
      minTargetComposerClearance: targetComposerClearances.length
        ? Math.min(...targetComposerClearances)
        : null,
      maxTargetComposerClearanceShift: targetComposerClearances.length
        ? Math.max(...targetComposerClearances) - Math.min(...targetComposerClearances)
        : null,
      maxMountedVirtualTurns: Math.max(
        0,
        ...visibleSamples.map((sample) => sample.mountedVirtualTurns),
      ),
      transitionFrames: readySamples
        .filter((sample, index, samples) => {
          const previous = samples[index - 1];
          return (
            !previous ||
            sample.transcriptVisible !== previous.transcriptVisible ||
            sample.transcriptOpacity !== previous.transcriptOpacity ||
            sample.targetVisible !== previous.targetVisible ||
            sample.bottomGap !== previous.bottomGap ||
            sample.composerClearance !== previous.composerClearance ||
            sample.mountedVirtualTurns !== previous.mountedVirtualTurns
          );
        })
        .slice(0, 20),
    };
  });
}
