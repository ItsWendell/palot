import { persistedAtom } from "./persisted";

export const ONBOARDING_VERSION = 1;

export const onboardingCompletedProfilesAtom = persistedAtom({
  key: "onboarding.completed-profiles",
  initialValue: {} as Record<string, number>,
  validate: (value): value is Record<string, number> => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    return Object.entries(value as Record<string, unknown>).every(
      ([profileID, version]) =>
        profileID.length > 0 &&
        typeof version === "number" &&
        Number.isInteger(version) &&
        version > 0,
    );
  },
});

export function onboardingComplete(completed: Record<string, number>, profileID: string): boolean {
  return (completed[profileID] ?? 0) >= ONBOARDING_VERSION;
}
