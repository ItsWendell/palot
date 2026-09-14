import { createStore } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { persistedStorageKey } from "./persisted";

describe("onboarding completion", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.resetModules();
  });

  it("persists completion for the app across launches", async () => {
    const { ONBOARDING_VERSION, onboardingCompletedVersionAtom } = await import("./onboarding");
    createStore().set(onboardingCompletedVersionAtom, ONBOARDING_VERSION);
    vi.resetModules();
    const reloaded = await import("./onboarding");
    expect(
      reloaded.onboardingComplete(createStore().get(reloaded.onboardingCompletedVersionAtom)),
    ).toBe(true);
  });

  it.each(["local", "remote"])(
    "migrates an existing %s profile completion to the app",
    async (profileID) => {
      window.localStorage.setItem(
        persistedStorageKey("onboarding.completed-profiles"),
        JSON.stringify({ version: 1, value: { [profileID]: 1 } }),
      );
      const { onboardingComplete, onboardingCompletedVersionAtom } = await import("./onboarding");
      expect(onboardingComplete(createStore().get(onboardingCompletedVersionAtom))).toBe(true);
      expect(
        JSON.parse(
          window.localStorage.getItem(persistedStorageKey("onboarding.completed-version"))!,
        ),
      ).toEqual({ version: 1, value: 1 });
    },
  );

  it("keeps initial onboarding and version upgrades eligible", async () => {
    const { ONBOARDING_VERSION, onboardingComplete, onboardingCompletedVersionAtom } =
      await import("./onboarding");
    expect(onboardingComplete(createStore().get(onboardingCompletedVersionAtom))).toBe(false);
    expect(onboardingComplete(ONBOARDING_VERSION - 1)).toBe(false);
  });
});
