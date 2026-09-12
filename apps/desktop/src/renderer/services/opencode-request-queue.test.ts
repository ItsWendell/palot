import { expect, it } from "vitest";
import { createOpenCodeReadQueue } from "./opencode-request-queue";

it("removes cancelled queued reads and releases slots once in FIFO order", async () => {
  const acquire = createOpenCodeReadQueue(1);
  const signal = new AbortController().signal;
  const release = await acquire(signal);
  const cancelled = new AbortController();
  const rejected = expect(acquire(cancelled.signal)).rejects.toThrow();
  let started = false;
  const next = acquire(signal).then((done) => {
    started = true;
    return done;
  });
  cancelled.abort();
  await rejected;
  expect(started).toBe(false);
  release();
  release();
  const done = await next;
  let thirdStarted = false;
  const third = acquire(signal).then((finish) => {
    thirdStarted = true;
    return finish;
  });
  await Promise.resolve();
  expect(thirdStarted).toBe(false);
  done();
  (await third)();
});
