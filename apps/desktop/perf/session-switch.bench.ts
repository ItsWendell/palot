// Switching between two long tasks (12 turns each: Markdown, tables and code), as the session-switch-performance E2E
// scenario does. Each switch opens the task at its live edge.
//   strobe bench apps/desktop/perf/session-switch.bench.ts --base main --head .
import { bench } from "@hona/strobe";
import { end, openTasks, palotFixture, palotTarget, taskRow } from "./palot.ts";

export default bench({
  fixture: palotFixture,
  targets: { palot: palotTarget },
  setup: ({ page }) => openTasks(page, ["beta", "alpha"]),
  cases: {
    "switch to a long task": {
      primary: "main.work",
      metrics: ["main.script", "main.layout", "main.style", "run.duration"],
      run: ({ page }) => page.click(taskRow("beta"), { until: [end("beta"), "idle"] }),
      reset: ({ page }) => page.click(taskRow("alpha"), { until: [end("alpha"), "idle"] }),
    },
  },
});
