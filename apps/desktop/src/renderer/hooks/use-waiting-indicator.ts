import { useEffect } from "react"
import { useAppStore } from "../stores/app-store"

/**
 * Updates the browser tab title when any agent is waiting for user input
 * (permission approval or question response).
 *
 * Uses a direct store selector instead of `useAgents()` to avoid
 * re-deriving the full agents array on every session/discovery change.
 */
export function useWaitingIndicator() {
	const hasWaiting = useAppStore((s) => {
		for (const entry of Object.values(s.sessions)) {
			if (entry.permissions.length > 0 || entry.questions.length > 0) return true
		}
		return false
	})

	useEffect(() => {
		document.title = hasWaiting ? "(!) Codedeck \u2014 Input needed" : "Codedeck"

		return () => {
			document.title = "Codedeck"
		}
	}, [hasWaiting])
}
