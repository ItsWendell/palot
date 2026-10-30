import { expect, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { measureInteraction } from "./performance.ts";
import {
  assertWorkspaceHeaderInsets,
  workbenchResizeScenario,
} from "./workbench-resize-scenario.ts";
import type { Scenario } from "./scenarios.ts";

export const workspacePanelPerformanceScenario = workspacePerformanceScenario(false);
export const workspaceDragPerformanceScenario = workspacePerformanceScenario(true);

function workspacePerformanceScenario(dragOnly: boolean): Scenario {
  return {
    ...workbenchResizeScenario,
    description: dragOnly
      ? "measure navigation and workbench drags over a settled long transcript"
      : "measure navigation and workbench toggles and drags over a settled long transcript",
    async assert(page, { runRoot, profile }) {
      if (!profile) throw new Error("Workspace performance scenarios require --profile");
      await page.setViewportSize({ width: 1440, height: 850 });
      await page.getByText("Transcript line 120:", { exact: false }).waitFor();
      const measure = () => measureWorkspacePanels(page, runRoot, dragOnly);
      if (process.env.PALOT_E2E_TRACE === "1") await measure();
      else await captureStyleTrace(page, runRoot, measure, dragOnly ? 2 : 4);
      if (!dragOnly) await assertWorkspaceHeaderInsets(page, runRoot);
    },
  };
}

/** Bounded style-only attribution, without the full trace's CPU profiler/screenshots. */
async function captureStyleTrace(
  page: Page,
  runRoot: string,
  action: () => Promise<void>,
  expectedPhases: number,
) {
  const session = await page.context().newCDPSession(page);
  const events: unknown[] = [];
  let truncated = false;
  let starts = 0;
  let ends = 0;
  const completed = new Promise<void>((resolve) =>
    session.once("Tracing.tracingComplete", () => resolve()),
  );
  session.on("Tracing.dataCollected", ({ value }) => {
    for (const event of value) {
      if (event.name === "palot:measurement:start") starts += 1;
      if (event.name === "palot:measurement:end") ends += 1;
      if (
        ![
          "UpdateLayoutTree",
          "Layout",
          "palot:measurement:start",
          "palot:measurement:end",
        ].includes(event.name ?? "")
      )
        continue;
      if (events.length < 20_000) events.push(event);
      else truncated = true;
    }
  });
  await session.send("Tracing.start", {
    transferMode: "ReportEvents",
    traceConfig: { includedCategories: ["devtools.timeline", "blink.user_timing"] },
  });
  try {
    await action();
  } finally {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await session.send("Tracing.end");
      await Promise.race([
        completed,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Panel style trace did not finish")), 15_000);
        }),
      ]);
      await writeFile(
        join(runRoot, "workspace-panel-style-trace.json"),
        JSON.stringify({ traceEvents: events, truncated }),
        { mode: 0o600 },
      );
    } finally {
      if (timer) clearTimeout(timer);
      await session.detach();
    }
  }
  if (truncated || starts !== expectedPhases || ends !== expectedPhases)
    throw new Error("Panel style trace is incomplete");
}

/** Settled transcript diagnostic, separate from streaming and screenshot overhead. */
async function measureWorkspacePanels(page: Page, runRoot: string, dragOnly: boolean) {
  const settle = () => page.waitForTimeout(300);
  const navigationCycle = async () => {
    await page.getByRole("button", { name: "Hide navigation", exact: true }).click();
    await settle();
    await page.getByRole("button", { name: "Show navigation", exact: true }).click();
    await settle();
  };
  const rightCycle = async () => {
    await page.getByRole("button", { name: "Show changes", exact: true }).click();
    await settle();
    await page.getByRole("button", { name: "Hide right workbench", exact: true }).click();
    await settle();
  };
  const dragCycle = async (panel: "navigation" | "center", verify = false) => {
    const separator = page.locator(
      `[data-shell-panel="${panel}"] + [data-slot="resizable-handle"]`,
    );
    const bounds = await separator.boundingBox();
    if (!bounds) throw new Error(`Missing ${panel} separator`);
    const x = bounds.x + bounds.width / 2;
    const y = bounds.y + bounds.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + (panel === "navigation" ? 60 : -60), y, { steps: 12 });
    if (verify) {
      const moved = await separator.boundingBox();
      expect(Math.abs((moved?.x ?? bounds.x) - bounds.x)).toBeGreaterThan(30);
    }
    await page.mouse.move(x, y, { steps: 12 });
    await page.mouse.up();
    await settle();
  };

  await navigationCycle();
  await rightCycle();
  const fixture = await page.evaluate(() => ({
    nodes: document.querySelectorAll("*").length,
    transcriptNodes: document.querySelector('[aria-label="Task transcript"]')?.querySelectorAll("*")
      .length,
  }));
  const reports = [];
  for (const [label, action] of [
    ["navigation-toggle", navigationCycle],
    ["right-toggle", rightCycle],
    ["navigation-drag", () => dragCycle("navigation")],
    ["right-drag", () => dragCycle("center")],
  ] as const) {
    if (dragOnly && !label.endsWith("drag")) continue;
    if (label.endsWith("drag")) {
      await page.getByRole("button", { name: "Show changes", exact: true }).click();
      await settle();
      await dragCycle(label === "navigation-drag" ? "navigation" : "center", true);
    }
    const { report } = await measureInteraction(page, label, async () => {
      for (let cycle = 0; cycle < 5; cycle += 1) await action();
    });
    reports.push(report);
    if (label.endsWith("drag")) {
      await page.getByRole("button", { name: "Hide right workbench", exact: true }).click();
      await settle();
    }
  }
  await expect(page.getByText("Transcript line 120:", { exact: false })).toBeInViewport();
  const output = join(runRoot, "workspace-panel-performance.json");
  await writeFile(
    output,
    JSON.stringify(
      {
        fixture,
        cyclesPerPhase: 5,
        styleAttribution:
          process.env.PALOT_E2E_TRACE === "1" ? "full-harness-trace" : "style-only-trace",
        reports,
      },
      null,
      2,
    ),
    {
      mode: 0o600,
    },
  );
  console.log(`Palot panel performance report: ${output}`);
}
