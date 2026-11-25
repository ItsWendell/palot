// Typing while a reply streams (the input-streaming and batch-input steady E2E profiles): a sentence typed into the
// composer, a key every 20 ms or slower, while 384 numbered deltas stream 20 ms apart into a 12-turn task. The run
// ends once the draft is in the composer and the reply ended; reset checks the draft kept every key.
//   strobe bench apps/desktop/perf/typing.bench.ts --base main --head .
import { bench } from "@hona/strobe";
import {
  clearDraft,
  openTasks,
  palotTarget,
  replyCounter,
  replyFixture,
  typeDuringReply,
} from "./palot.ts";

const replies = replyCounter();

export default bench({
  fixture: replyFixture("steady"),
  targets: { palot: palotTarget },
  async setup({ page }) {
    replies.reset();
    await openTasks(page, ["alpha"]);
  },
  cases: {
    "type while a reply streams": {
      primary: "main.work",
      metrics: ["main.script", "main.layout", "main.style", "run.duration"],
      timeout: 60_000,
      run: (ctx) => typeDuringReply(ctx, replies.next()),
      reset: ({ page }) => clearDraft(page),
    },
  },
});
