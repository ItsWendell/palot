// A reply streaming into a long task: 80 Markdown deltas 25 ms apart (headings, tables, code, links) from the fixture's
// scripted model, into a 12-turn history. Per-delta cost that grows with the reply or the history shows up here.
//   strobe bench apps/desktop/perf/stream.bench.ts --base main --head .
import { bench } from "@hona/strobe";
import { openTasks, palotFixture, palotTarget, replyCounter, streamReply } from "./palot.ts";

const replies = replyCounter();

export default bench({
  fixture: palotFixture,
  targets: { palot: palotTarget },
  async setup({ page }) {
    replies.reset();
    await openTasks(page, ["alpha"]);
  },
  cases: {
    "stream a reply into a long task": {
      primary: "main.work",
      metrics: ["main.script", "main.layout", "main.style", "run.duration"],
      // Each run adds its exchange to the task: the history grows by one turn a run on both sides alike.
      resetCheck: false,
      timeout: 60_000,
      run: (ctx) => streamReply(ctx, replies.next()),
    },
  },
});
