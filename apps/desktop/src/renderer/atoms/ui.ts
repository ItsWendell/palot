import { atom } from "jotai"

export const commandPaletteOpenAtom = atom(false)
export const showSubAgentsAtom = atom(false)

// Toggle helper (write-only atom)
export const toggleShowSubAgentsAtom = atom(null, (get, set) => {
	set(showSubAgentsAtom, !get(showSubAgentsAtom))
})

/**
 * The session ID currently being viewed in the main content area.
 * Set by the router/session view when the user navigates to a session.
 * Used by metrics atoms to skip expensive recomputation for background sessions.
 */
export const viewedSessionIdAtom = atom<string | null>(null)
