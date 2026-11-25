// A bursty reply (the batch-input burst E2E profile): the typing bench's 384 numbered deltas, delivered in bursts of
// 16 every 320 ms, into a 12-turn task. Same text and pace as typing.bench.ts; only the clustering differs, so the
// two show what a burst of deltas costs, not a product A/B.
//   strobe bench apps/desktop/perf/burst.bench.ts --base main --head .
import { bench } from "@hona/strobe";
import {
  clearDraft,
  openTasks,
  palotTarget,
  replyCounter,
  replyFixture,
  streamReply,
  typeDuringReply,
} from "./palot.ts";

const replies = replyCounter();

export default bench({
  fixture: replyFixture("burst"),
  targets: { palot: palotTarget },
  async setup({ page }) {
    replies.reset();
    await openTasks(page, ["alpha"]);
  },
  cases: {
    "stream a bursty reply into a long task": {
      primary: "main.work",
      metrics: ["main.script", "main.layout", "main.style", "run.duration"],
      timeout: 60_000,
      run: (ctx) => streamReply(ctx, replies.next()),
    },
    "type while a bursty reply streams": {
      primary: "main.work",
      metrics: ["main.script", "main.layout", "main.style", "run.duration"],
      timeout: 60_000,
      run: (ctx) => typeDuringReply(ctx, replies.next()),
      reset: ({ page }) => clearDraft(page),
    },
  },
});
