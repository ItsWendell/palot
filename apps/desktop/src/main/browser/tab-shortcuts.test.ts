import { expect, test } from "vitest";
import { isWorkbenchTabShortcut } from "./tab-shortcuts";

const input = (overrides: Partial<Electron.Input>) => ({
  type: "keyDown",
  key: "w",
  code: "KeyW",
  control: false,
  meta: false,
  alt: false,
  shift: false,
  ...overrides,
});

test("embedded pages give up the platform close key and Ctrl+Tab", () => {
  expect(isWorkbenchTabShortcut(input({ control: true }), "linux")).toBe(true);
  expect(isWorkbenchTabShortcut(input({ meta: true }), "darwin")).toBe(true);
  expect(isWorkbenchTabShortcut(input({ key: "Tab", code: "Tab", control: true }), "darwin")).toBe(
    true,
  );
  expect(
    isWorkbenchTabShortcut(input({ key: "Tab", code: "Tab", control: true, shift: true }), "linux"),
  ).toBe(true);
});

test("pages keep their other keys", () => {
  expect(isWorkbenchTabShortcut(input({ control: true }), "darwin")).toBe(false);
  expect(isWorkbenchTabShortcut(input({ control: true, shift: true }), "linux")).toBe(false);
  expect(isWorkbenchTabShortcut(input({ control: true, type: "keyUp" }), "linux")).toBe(false);
  expect(isWorkbenchTabShortcut(input({ key: "Tab", code: "Tab" }), "linux")).toBe(false);
  expect(isWorkbenchTabShortcut(input({ key: "z", code: "KeyW", control: true }), "linux")).toBe(
    false,
  );
});
