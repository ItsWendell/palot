import { createStore } from "jotai";
import { beforeEach, describe, expect, it } from "vitest";
import { persistedStorageKey } from "./persisted";
import {
  ONBOARDING_VERSION,
  onboardingComplete,
  onboardingCompletedProfilesAtom,
} from "./onboarding";

describe("onboarding completion", () => {
  beforeEach(() => window.localStorage.clear());

  it("tracks completion independently for each OpenCode profile", () => {
    const store = createStore();

    store.set(onboardingCompletedProfilesAtom, { local: ONBOARDING_VERSION });

    expect(onboardingComplete(store.get(onboardingCompletedProfilesAtom), "local")).toBe(true);
    expect(onboardingComplete(store.get(onboardingCompletedProfilesAtom), "remote")).toBe(false);
    expect(
      JSON.parse(
        window.localStorage.getItem(persistedStorageKey("onboarding.completed-profiles")) ?? "null",
      ),
    ).toEqual({ version: 1, value: { local: ONBOARDING_VERSION } });
  });

  it("reopens onboarding when its product version advances", () => {
    expect(onboardingComplete({ local: ONBOARDING_VERSION - 1 }, "local")).toBe(false);
  });
});
