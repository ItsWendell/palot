// What every Palot bench shares: the fixture, the target that launches a variant's built Palot, and the steps that
// bring a fresh profile to a known screen. See README.md.
import { command, fixture, type Context, type Page } from "@hona/strobe";
import { type ReplyKind, STATE_HOME, TASKS, replyLine, streamEnd } from "./environment.ts";

export type Task = (typeof TASKS)[number];

/** The fixture with Markdown replies (stream.bench.ts). */
export const palotFixture = fixture("bun fixture.ts --port {port}", { timeout: 300_000 });
/** The fixture with another kind of reply, one kind per bench file (environment.ts). */
export const replyFixture = (kind: ReplyKind) =>
  fixture(`bun fixture.ts --port {port} --replies ${kind}`, { timeout: 300_000 });

export const palotTarget = command("bash perf/launch.sh", {
  cwd: "apps/desktop",
  // A git variant is a fresh worktree: install (with Electron's binary) before building.
  build:
    "vp install --frozen-lockfile && node node_modules/electron/install.js && cd apps/desktop && bun run scripts/build.ts",
  timeout: 120_000,
  env: {
    PALOT_STROBE_HOME: "{home}",
    HOME: "{home}",
    XDG_CONFIG_HOME: "{home}/.config",
    XDG_DATA_HOME: "{home}/.local/share",
    XDG_CACHE_HOME: "{home}/.cache",
    // Palot finds the fixture's OpenCode through its service registration.
    XDG_STATE_HOME: STATE_HOME,
    PALOT_E2E_USER_DATA: "{home}/palot-user-data",
    PALOT_LOG_DIR: "{home}/logs",
    PALOT_REMOTE_DEBUGGING_PORT: "{port}",
    PALOT_OPENCODE_SERVICE_PORT: "{fixture.port}",
    PALOT_CONNECTION_PROFILE_ID: "strobe",
    PALOT_DEV_INSTANCE_ID: "strobe",
    PALOT_DISABLE_GLASS: "1",
  },
  unset: ["ELECTRON_RUN_AS_NODE"],
  viewport: { width: 1440, height: 920 },
});

/** A task opens at its first unread message (START) until it was viewed, then at its live edge (END). */
export const start = (task: Task) => ({
  selector: "p",
  text: `${task.toUpperCase()} START`,
  exact: true,
});
export const end = (task: Task) => ({
  selector: "p",
  text: `${task.toUpperCase()} END`,
  exact: true,
});

/** A task's row in the task list; seeded tasks are settled and sit in the Settled section. */
export const taskRow = (task: Task) => ({
  selector: "[data-palot-task-row]",
  text: `Strobe ${task}`,
});

/** The same row while the task is working or finished and unseen (it moved out of Settled). */
export const taskCard = taskRow;

export const composer = '[aria-label="Message Palot"]';

/**
 * A fresh profile: skip onboarding, wait for Palot to open the newest task, expand the settled tasks and view each
 * of `tasks` once, so later switches open them at their live edge as a returning user sees them. Ends on the last.
 */
export async function openTasks(page: Page, tasks: readonly Task[]) {
  await page.waitFor('[aria-label="Loading Palot"], main', { timeout: 60_000 });
  const url = await page.eval(() => {
    localStorage.setItem(
      "palot.desktop.state.onboarding.completed-profiles",
      JSON.stringify({ version: 1, value: { strobe: 1 } }),
    );
    return location.href.split("#")[0]!;
  });
  // A reload applies the onboarding flag; Palot then opens the newest task.
  const newest = TASKS[TASKS.length - 1]!;
  await page.goto(url, { until: start(newest), timeout: 60_000 });
  const collapsed = await page.eval(
    () => !document.querySelector('[data-palot-task-row][data-placement="settled"]'),
  );
  if (collapsed) {
    await page.click(
      { selector: '[role="treeitem"][aria-label^="Settled,"]' },
      { until: taskRow(TASKS[0]), timeout: 60_000 },
    );
  }
  for (const pass of ["first", "again"] as const) {
    // Reopening the task already shown changes nothing: step to the newest task in between.
    if (pass === "again" && tasks.length === 1 && tasks[0] !== newest) {
      await page.click(taskRow(newest), { until: [end(newest), "idle"], timeout: 60_000 });
    }
    for (const task of tasks) {
      if (pass === "first" && task === newest) continue;
      await page.click(taskRow(task), {
        until: [pass === "first" ? start(task) : end(task), "idle"],
        timeout: 60_000,
      });
    }
  }
  await page.idle();
}

export const transcript = '[aria-label="Task transcript"]';
export const following = `${transcript}[data-bottom-locked="true"]`;
export const scrolledUp = `${transcript}[data-bottom-locked="false"]`;

/** A reply's end marker, shown once the fixture's model sent all of reply `index`. */
export const replyEnd = (index: number) => ({ selector: "p", text: streamEnd(index), exact: true });
/** A line of numbered reply `index` (any line without `line`): shows the reply streaming in view. */
export const replyShown = (index: number, line?: number) => ({
  selector: "p",
  text: replyLine(index, line),
});

/**
 * The fixture's model answers prompts in order, one numbered reply each, and a block's fixture starts it fresh:
 * call `reset()` in setup and `next()` once per prompt a run sends.
 */
export function replyCounter() {
  let sent = 0;
  return {
    reset: () => void (sent = 0),
    next: () => (sent += 1),
    get current() {
      return sent;
    },
  };
}

type Run = Pick<Context<unknown>, "page" | "untimed">;

/** Sends prompt `index` in the open task and times its reply streaming in, to the reply's end marker. */
export async function streamReply({ page, untimed }: Run, index: number) {
  await untimed(() => page.type(composer, `Stream reply ${index}`, { burst: true }));
  await page.press("Enter", { until: [replyEnd(index), "idle"], timeout: 30_000 });
}

/**
 * Sends prompt `index` in the open task, untimed, and returns once 20 lines of its numbered reply streamed in (about
 * 0.4 s), so what a run does next happens mid-stream.
 */
export async function startReply({ page, untimed }: Run, index: number) {
  await untimed(async () => {
    await page.type(composer, `Stream reply ${index}`, { burst: true });
    await page.press("Enter", { until: replyShown(index, 20), timeout: 30_000 });
  });
}

/** Waits for reply `index` to end (a reset's step: the next run starts on a settled task). */
export async function finishReply(page: Page, index: number) {
  await page.waitFor(replyEnd(index), { until: "idle", timeout: 30_000 });
}

/** A sentence typed into the composer, as the input-streaming E2E profile types it. */
export const DRAFT =
  "Keep this exact unsent draft while the reply streams. No lost keys: 0123456789.";

/**
 * Types `DRAFT` into the composer while numbered reply `index` streams, then waits for the reply to end: the run is
 * over when both the draft is in the composer and the reply ended.
 */
export async function typeDuringReply(ctx: Run, index: number) {
  await startReply(ctx, index);
  await ctx.page.type(composer, DRAFT, { delay: 20 });
  await ctx.page.waitFor(replyEnd(index), { until: "idle", timeout: 30_000 });
}

/** Checks the composer holds exactly `DRAFT` (no lost or doubled keys), then empties it for the next run. */
export async function clearDraft(page: Page) {
  const value = await page.eval(
    (selector) => document.querySelector<HTMLTextAreaElement>(selector)?.value,
    composer,
  );
  if (value !== DRAFT)
    throw new Error(`The composer holds ${JSON.stringify(value)}, not the draft`);
  await page.press("ControlOrMeta+a", { selector: composer });
  await page.press("Backspace");
}
