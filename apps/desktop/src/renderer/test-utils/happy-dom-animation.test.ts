import { expect, it, vi } from "vitest";

it("cancels an animation without an unhandled finished rejection", async () => {
  const animation = document.createElement("div").animate({ opacity: [0, 1] }, 1_000);
  const onCancel = vi.fn();
  animation.addEventListener("cancel", onCancel);

  animation.cancel();
  // Reach the rejection-reporting turn, not only the synchronous cancel call.
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(animation.playState).toBe("idle");
  expect(onCancel).toHaveBeenCalledOnce();
});

it("still rejects the caller's original finished promise with AbortError", async () => {
  const animation = document.createElement("div").animate({ opacity: [0, 1] }, 1_000);
  const finished = animation.finished;
  const continuation = finished.then(() => "completed");
  animation.cancel();

  await Promise.all([
    expect(finished).rejects.toMatchObject({ name: "AbortError" }),
    expect(continuation).rejects.toMatchObject({ name: "AbortError" }),
  ]);
});

it("handles cancellation after replay without changing successful completion", async () => {
  const animation = document.createElement("div").animate({ opacity: [0, 1] }, 1_000);
  const completed = animation.finished;
  animation.finish();
  await expect(completed).resolves.toBe(animation);

  animation.play();
  animation.cancel();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(animation.playState).toBe("idle");
});
