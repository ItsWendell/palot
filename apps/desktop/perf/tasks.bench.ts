// Many long tasks open in one session: a run visits all six seeded tasks (12 turns each) once and ends where it began.
// What a run leaves behind should not grow: run it for leaks with
//   strobe bench apps/desktop/perf/tasks.bench.ts --head . --probes memory --repeat 10
// and compare builds with
//   strobe bench apps/desktop/perf/tasks.bench.ts --base main --head .
import { bench } from "@hona/strobe";
import { TASKS } from "./environment.ts";
import { end, openTasks, palotFixture, palotTarget, taskRow } from "./palot.ts";

// Starts and ends on alpha, so every run starts from the same screen without a reset.
const tour = [...TASKS.slice(1), TASKS[0]];

export default bench({
  fixture: palotFixture,
  targets: { palot: palotTarget },
  setup: ({ page }) => openTasks(page, TASKS),
  cases: {
    "visit six long tasks": {
      primary: "main.work",
      metrics: [
        "main.script",
        "main.style",
        "run.duration",
        "js.heap.used",
        "dom.nodes",
        "memory.app.private",
      ],
      timeout: 120_000,
      async run({ page }) {
        for (const task of tour) await page.click(taskRow(task), { until: [end(task), "frame"] });
        await page.idle();
      },
    },
  },
});
