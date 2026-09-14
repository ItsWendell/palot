import { persistedAtom, persistedStorageKey } from "./persisted";

export const ONBOARDING_VERSION = 1;

export const onboardingCompletedVersionAtom = persistedAtom({
  key: "onboarding.completed-version",
  initialValue: 0,
  validate: (value): value is number =>
    typeof value === "number" && Number.isInteger(value) && value >= 0,
  legacyKeys: [persistedStorageKey("onboarding.completed-profiles")],
  migrate: (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const entries = Object.entries(value as Record<string, unknown>);
    if (
      !entries.every(
        ([profileID, version]) =>
          profileID.length > 0 &&
          typeof version === "number" &&
          Number.isInteger(version) &&
          version > 0,
      )
    )
      return undefined;
    return Math.max(0, ...entries.map(([, version]) => version as number));
  },
});

export function onboardingComplete(completedVersion: number): boolean {
  return completedVersion >= ONBOARDING_VERSION;
}
