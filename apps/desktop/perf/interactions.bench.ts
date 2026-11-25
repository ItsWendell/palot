// Acting while a reply streams (the interaction-streaming E2E profile, one stream instead of four): each run starts
// 384 numbered deltas 20 ms apart into a 12-turn task, untimed, and acts once 20 lines are in. Each case has its own
// primary; scroll-anchor correctness stays in the streaming-stability E2E scenario.
//   strobe bench apps/desktop/perf/interactions.bench.ts --base main --head .
import { bench } from "@hona/strobe";
import {
  end,
  finishReply,
  following,
  openTasks,
  palotTarget,
  replyCounter,
  replyFixture,
  replyShown,
  scrolledUp,
  startReply,
  taskCard,
  taskRow,
  transcript,
} from "./palot.ts";

const replies = replyCounter();
const metrics = ["main.script", "main.layout", "main.style", "run.duration"];

export default bench({
  fixture: replyFixture("steady"),
  targets: { palot: palotTarget },
  async setup({ page }) {
    replies.reset();
    await openTasks(page, ["beta", "alpha"]);
  },
  // The runs leave the reply streaming: the next run starts once it ended.
  reset: ({ page }) => finishReply(page, replies.current),
  cases: {
    "switch away and back while a reply streams": {
      primary: "main.work",
      metrics,
      async run(ctx) {
        const index = replies.next();
        await startReply(ctx, index);
        await ctx.page.click(taskRow("beta"), { until: [end("beta"), "frame"] });
        // Working, alpha moved from the settled rows to the Inbox section's cards.
        await ctx.page.click(taskCard("alpha"), { until: [replyShown(index), "frame"] });
      },
    },
    "scroll up and back to the latest while a reply streams": {
      primary: "main.work",
      metrics,
      async run(ctx) {
        await startReply(ctx, replies.next());
        await ctx.page.wheel(transcript, { dy: -900 }, { until: scrolledUp });
        // Reading for a moment while the reply streams in below.
        await ctx.page.wait(500);
        await ctx.page.click(
          { role: "button", text: "Scroll to bottom" },
          { until: [following, "frame"] },
        );
      },
    },
    "stop a task mid-reply": {
      primary: "main.work",
      metrics,
      async run(ctx) {
        await startReply(ctx, replies.next());
        await ctx.page.click('[aria-label="Stop task"]', {
          until: ['[aria-label="Send message"]', "idle"],
        });
      },
      // Stopped: nothing streams on, and the reply never shows its end marker.
      reset: ({ page }) => page.idle(),
    },
  },
});
