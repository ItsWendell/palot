// Palot sitting idle on a long task for 5 s: what it costs to leave open. Background polling, timers and animations
// that run without the user show up here; compare builds before adding any.
//   strobe bench apps/desktop/perf/idle.bench.ts --base main --head .
import { bench } from "@hona/strobe";
import { openTasks, palotFixture, palotTarget } from "./palot.ts";

export default bench({
  fixture: palotFixture,
  targets: { palot: palotTarget },
  setup: ({ page }) => openTasks(page, ["alpha"]),
  cases: {
    "idle on a long task": {
      primary: "cpu.work",
      // cpu.wakes needs a native target or deep mode; these come from the attached page and the process tree.
      metrics: ["main.work", "cpu.renderer", "cpu.browser", "cpu.gpu"],
      run: ({ page }) => page.wait(5_000),
    },
  },
});
