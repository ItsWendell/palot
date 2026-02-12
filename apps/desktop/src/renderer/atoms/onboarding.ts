/**
 * Onboarding state atoms.
 *
 * Tracks whether the first-run onboarding has been completed.
 * Persisted to localStorage so returning users skip onboarding.
 */

import { atomWithStorage } from "jotai/utils"

// ============================================================
// Types
// ============================================================

export interface OnboardingState {
	completed: boolean
	completedAt: string | null
	skippedSteps: string[]
	migrationPerformed: boolean
	opencodeVersion: string | null
}

// ============================================================
// Atoms
// ============================================================

export const onboardingStateAtom = atomWithStorage<OnboardingState>("palot:onboarding", {
	completed: false,
	completedAt: null,
	skippedSteps: [],
	migrationPerformed: false,
	opencodeVersion: null,
})
