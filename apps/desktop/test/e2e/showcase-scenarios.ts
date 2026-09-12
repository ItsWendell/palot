import type { OpenCodeClient, SessionInfo } from "@opencode/client";
import { expect, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { TestLLMServer } from "./test-llm-server";

const execFileAsync = promisify(execFile);

interface ShowcaseContext {
  client: OpenCodeClient;
  llm: TestLLMServer;
  session: SessionInfo;
  projectDirectory: string;
  runRoot: string;
}

export const showcaseScenarios = {
  "showcase-readme-cover": {
    description: "stage the deterministic Palot and OpenCode README cover",
    prompt: "",
    expectedModelCalls: 7,
    async prepareProject({
      projectDirectory,
      runRoot,
    }: Pick<ShowcaseContext, "projectDirectory" | "runRoot">) {
      await preparePalotProject(projectDirectory);
      await prepareOpenCodeProject(join(runRoot, "opencode"));
    },
    arrange(llm: TestLLMServer) {
      llm.route("Match OpenCode tool rendering", (script) => {
        script.toolsWithText(
          [
            {
              name: "read",
              input: {
                path: "../opencode/packages/app/src/components/tool-part.tsx",
                offset: 1,
                limit: 160,
              },
            },
            {
              name: "read",
              input: { path: "src/components/tool-part.tsx", offset: 1, limit: 160 },
            },
            {
              name: "write",
              input: {
                path: "src/components/tool-part.tsx",
                content: parityToolPartSource(),
              },
            },
          ],
          [
            "I’ll compare OpenCode’s tool-part lifecycle with Palot’s renderer, then close the smallest visible gap. ",
          ],
          15,
        );
        script.text(
          [
            "Closed the tool-state gap after comparing Palot with OpenCode’s renderer.",
            "",
            "- Added pending, running, completed, and error states",
            "- Kept labels aligned with OpenCode’s tool-part lifecycle",
            "- Preserved Palot’s compact desktop layout",
            "",
            "The focused checks pass. The feature-parity diff is ready for review.",
          ].join("\n"),
        );
      });
      llm.route("Add OpenCode session fork controls", (script) =>
        script.text("Added session fork controls using OpenCode’s native session contract."),
      );
      llm.route("Align OpenCode permission requests", (script) =>
        script.text("Aligned permission requests with OpenCode’s allow, deny, and remember flow."),
      );
      llm.route("Inspect OpenCode tool part lifecycle", (script) =>
        script.text(
          "Mapped the tool-part lifecycle and its pending, running, and terminal states.",
        ),
      );
      llm.route("Trace OpenCode session event contracts", (script) =>
        script.text("Traced session events from the service through the client contract."),
      );
      llm.route("Review OpenCode desktop navigation", (script) =>
        script.textChunks(
          [
            "Inspecting OpenCode’s desktop navigation and session transitions…\n",
            ...Array.from(
              { length: 80 },
              (_, index) =>
                `Comparing navigation behavior ${String(index + 1).padStart(2, "0")}…\n`,
            ),
            "Navigation review complete.",
          ],
          100,
        ),
      );
    },
    async run(page: Page, context: ShowcaseContext) {
      const { client, llm, session: selected, projectDirectory, runRoot } = context;
      const openCodeDirectory = join(runRoot, "opencode");
      await client.session.rename({
        sessionID: selected.id,
        title: "Match OpenCode tool rendering",
      });
      await promptAndWait(client, selected.id, "Match OpenCode tool rendering.");

      const forks = await createCompletedTask(
        client,
        projectDirectory,
        "Add session fork controls",
        "Add OpenCode session fork controls.",
      );
      const permissions = await createCompletedTask(
        client,
        projectDirectory,
        "Align permission request flow",
        "Align OpenCode permission requests.",
      );

      const toolParts = await createCompletedTask(
        client,
        openCodeDirectory,
        "Inspect tool part lifecycle",
        "Inspect OpenCode tool part lifecycle.",
        false,
      );
      const events = await createCompletedTask(
        client,
        openCodeDirectory,
        "Trace session event contracts",
        "Trace OpenCode session event contracts.",
      );
      const navigation = await client.session.create({
        location: { directory: openCodeDirectory },
      });
      void client.session.prompt({
        sessionID: navigation.id,
        text: "Review OpenCode desktop navigation.",
      });
      await llm.waitForCalls(7);
      await client.session.rename({
        sessionID: navigation.id,
        title: "Review desktop navigation",
      });

      await page.evaluate((sessionID) => {
        (globalThis as unknown as { location: { hash: string } }).location.hash =
          `#/sessions/${sessionID}`;
      }, selected.id);
      await page
        .getByText("The feature-parity diff is ready for review.", { exact: false })
        .waitFor();
      await page
        .getByRole("button", { name: "Show changes" })
        .evaluate((element: HTMLButtonElement) => element.click());
      await page.locator('[data-palot-diff-header="src/components/tool-part.tsx"]').waitFor();
      await page
        .getByRole("button", { name: /^Show inbox/ })
        .evaluate((element: HTMLButtonElement) => element.click());
      await expect(page.getByLabel("Inbox navigation")).toBeVisible();

      await page.evaluate(
        (value) => {
          (globalThis as unknown as { __palotShowcaseSessions?: unknown }).__palotShowcaseSessions =
            value;
        },
        {
          selected: selected.id,
          forks: forks.id,
          permissions: permissions.id,
          toolParts: toolParts.id,
          events: events.id,
          navigation: navigation.id,
        },
      );
    },
    async assert(page: Page) {
      await expect(
        page.getByLabel("Current task").getByText("Match OpenCode tool rendering", { exact: true }),
      ).toBeVisible();
      await expect(page.getByText("Review desktop navigation", { exact: true })).toBeVisible();
      await expect(page.getByText("Inspect tool part lifecycle", { exact: true })).toBeVisible();
      await expect(page.getByText("Palot E2E: showcase-readme-cover", { exact: true })).toHaveCount(
        0,
      );
      await expect(
        page.locator('[data-palot-diff-header="src/components/tool-part.tsx"]'),
      ).toBeVisible();
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
    },
  },
};

async function createCompletedTask(
  client: OpenCodeClient,
  directory: string,
  title: string,
  text: string,
  acknowledge = true,
): Promise<SessionInfo> {
  const session = await client.session.create({ location: { directory } });
  await client.session.rename({ sessionID: session.id, title });
  await promptAndWait(client, session.id, text, acknowledge);
  return session;
}

async function promptAndWait(
  client: OpenCodeClient,
  sessionID: string,
  text: string,
  acknowledge = true,
): Promise<void> {
  await client.session.prompt({ sessionID, text });
  await client.session.wait({ sessionID });
  if (!acknowledge) return;
  const completed = await client.session.get({ sessionID });
  if (completed.time.idle === undefined) return;
  await client.session.view({ sessionID, idle: completed.time.idle });
}

async function preparePalotProject(directory: string): Promise<void> {
  await mkdir(join(directory, "src/components"), { recursive: true });
  await Promise.all([
    writeFile(
      join(directory, "package.json"),
      JSON.stringify({ name: "palot", private: true }, null, 2),
    ),
    writeFile(
      join(directory, "README.md"),
      "# Palot\n\nA native desktop client built on OpenCode’s contracts.\n",
    ),
    writeFile(
      join(directory, "src/components/tool-part.tsx"),
      [
        'type ToolPart = { status: "running" | "completed"; label: string };',
        "",
        "export function ToolPart({ part }: { part: ToolPart }) {",
        "  return <div>{part.label}</div>;",
        "}",
        "",
      ].join("\n"),
    ),
  ]);
  await commitAll(directory, "Add tool rendering baseline");
}

async function prepareOpenCodeProject(directory: string): Promise<void> {
  await mkdir(join(directory, "packages/app/src/components"), { recursive: true });
  await execFileAsync("git", ["init", "--quiet"], { cwd: directory });
  await Promise.all([
    writeFile(
      join(directory, "README.md"),
      "# OpenCode\n\nThe open-source coding agent Palot builds on.\n",
    ),
    writeFile(
      join(directory, "packages/app/src/components/tool-part.tsx"),
      openCodeToolPartSource(),
    ),
  ]);
  await commitAll(directory, "Seed OpenCode showcase project");
}

function parityToolPartSource(): string {
  return [
    'type ToolStatus = "pending" | "running" | "completed" | "error";',
    "",
    "type ToolPart = { status: ToolStatus; label: string };",
    "",
    "export function ToolPart({ part }: { part: ToolPart }) {",
    "  return (",
    "    <section aria-label={part.label} data-state={part.status}>",
    "      <span>{part.label}</span>",
    '      <span className="text-meta text-muted-foreground">{part.status}</span>',
    "    </section>",
    "  );",
    "}",
    "",
  ].join("\n");
}

function openCodeToolPartSource(): string {
  return [
    'export type ToolStatus = "pending" | "running" | "completed" | "error";',
    "",
    "export function ToolPart(props: { label: string; status: ToolStatus }) {",
    "  return (",
    '    <section data-component="tool-part" data-status={props.status}>',
    "      <span>{props.label}</span>",
    "      <output>{props.status}</output>",
    "    </section>",
    "  );",
    "}",
    "",
  ].join("\n");
}

async function commitAll(directory: string, message: string): Promise<void> {
  await execFileAsync("git", ["add", "."], { cwd: directory });
  await execFileAsync(
    "git",
    [
      "-c",
      "user.name=Palot Showcase",
      "-c",
      "user.email=showcase@example.invalid",
      "commit",
      "--quiet",
      "-m",
      message,
    ],
    { cwd: directory },
  );
}
