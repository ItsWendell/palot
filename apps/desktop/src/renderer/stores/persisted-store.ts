import { create } from "zustand"
import { persist } from "zustand/middleware"

// ============================================================
// Types
// ============================================================

export type DisplayMode = "default" | "compact" | "verbose"

interface PersistedState {
	/** Chat display density — persisted across reloads */
	displayMode: DisplayMode
	/** Draft message text per session (keyed by sessionId or "__new_chat__") */
	drafts: Record<string, string>

	// ========== Actions ==========
	setDisplayMode: (mode: DisplayMode) => void
	setDraft: (key: string, text: string) => void
	clearDraft: (key: string) => void
}

// ============================================================
// Store
// ============================================================

export const usePersistedStore = create<PersistedState>()(
	persist(
		(set) => ({
			displayMode: "default",
			drafts: {},

			setDisplayMode: (mode) => set({ displayMode: mode }),

			setDraft: (key, text) =>
				set((state) => ({
					drafts: { ...state.drafts, [key]: text },
				})),

			clearDraft: (key) =>
				set((state) => {
					const { [key]: _, ...rest } = state.drafts
					return { drafts: rest }
				}),
		}),
		{
			name: "codedeck-preferences",
			// Only persist data fields, not action functions
			partialize: (state) => ({
				displayMode: state.displayMode,
				drafts: state.drafts,
			}),
		},
	),
)
