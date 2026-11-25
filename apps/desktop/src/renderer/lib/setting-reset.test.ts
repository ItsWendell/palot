import { expect, it, vi } from "vitest";
import { sameSettingValue, settingReset } from "./setting-reset";

it("compares setting values structurally", () => {
  expect(sameSettingValue({ a: 1, b: [1, { c: true }] }, { b: [1, { c: true }], a: 1 })).toBe(true);
  expect(sameSettingValue({ a: 1 }, { a: 1, b: undefined })).toBe(true);
  expect(sameSettingValue({ a: 1 }, { a: 2 })).toBe(false);
  expect(sameSettingValue([1, 2], [2, 1])).toBe(false);
  expect(sameSettingValue(null, 0)).toBe(false);
});

it("resets to the default it was built with", () => {
  const set = vi.fn();
  const state = settingReset<number | null>(7, 3, set);
  expect(state.changed).toBe(true);
  state.onReset();
  expect(set).toHaveBeenCalledWith(3);
  expect(settingReset(3, 3, set).changed).toBe(false);
});
