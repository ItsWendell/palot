// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";

const calls: string[] = [];
vi.mock("electron", () => ({
  app: {
    isPackaged: true,
    relaunch: () => calls.push("relaunch"),
    exit: () => calls.push("exit"),
  },
}));
vi.mock("electron-log/main", () => ({ default: { warn: vi.fn() } }));

import { onBeforeRestart, requestAppRestart } from "./app-restart";

afterEach(() => {
  calls.length = 0;
  vi.useRealTimers();
});

it("runs registered cleanup before a packaged restart relaunches and exits", async () => {
  vi.useFakeTimers();
  const remove = onBeforeRestart(async () => {
    await Promise.resolve();
    calls.push("cleanup");
  });
  await requestAppRestart("test");
  await vi.runAllTimersAsync();
  remove();
  expect(calls).toEqual(["cleanup", "relaunch", "exit"]);
});

it("restarts after 5 s when cleanup hangs or fails", async () => {
  vi.useFakeTimers();
  const removeHung = onBeforeRestart(() => new Promise(() => undefined));
  const removeFailed = onBeforeRestart(() => {
    throw new Error("boom");
  });
  const restart = requestAppRestart("test");
  await vi.advanceTimersByTimeAsync(4_999);
  expect(calls).toEqual([]);
  await vi.advanceTimersByTimeAsync(1);
  await restart;
  await vi.runAllTimersAsync();
  removeHung();
  removeFailed();
  expect(calls).toEqual(["relaunch", "exit"]);
});
