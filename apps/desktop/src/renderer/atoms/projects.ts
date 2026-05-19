import { atomWithStorage } from "jotai/utils"

// Pinned project directories — sorted to the top of the project list
export const pinnedProjectsAtom = atomWithStorage<string[]>("palot:pinned-projects", [])

// Hidden project directories — filtered out of the sidebar
export const hiddenProjectsAtom = atomWithStorage<string[]>("palot:hidden-projects", [])

// Display name overrides: directory → custom label shown in the sidebar
export const projectDisplayNamesAtom = atomWithStorage<Record<string, string>>(
	"palot:project-display-names",
	{},
)
