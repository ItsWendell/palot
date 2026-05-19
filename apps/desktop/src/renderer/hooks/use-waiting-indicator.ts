import { useAtomValue } from "jotai"
import { useEffect } from "react"
import { hasWaitingAtom } from "../atoms/derived/waiting"

/**
 * Updates the browser tab title when any agent is waiting for user input.
 */
export function useWaitingIndicator() {
	const hasWaiting = useAtomValue(hasWaitingAtom)

	useEffect(() => {
		document.title = hasWaiting ? "(!) Nexus Builder \u2014 Input needed" : "Nexus Builder"

		return () => {
			document.title = "Nexus Builder"
		}
	}, [hasWaiting])
}
