import { atom } from "jotai"

export const commandPaletteOpenAtom = atom(false)
export const showSubAgentsAtom = atom(false)

// Toggle helper (write-only atom)
export const toggleShowSubAgentsAtom = atom(null, (get, set) => {
	set(showSubAgentsAtom, !get(showSubAgentsAtom))
})
