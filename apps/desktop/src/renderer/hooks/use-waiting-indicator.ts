import { useAtomValue } from "jotai"
import { useEffect } from "react"
import { hasWaitingAtom } from "../atoms/derived/waiting"

/**
 * Updates the browser tab title when any agent is waiting for user input.
 */
export function useWaitingIndicator() {
	const hasWaiting = useAtomValue(hasWaitingAtom)

	useEffect(() => {
		document.title = hasWaiting ? "(!) Palot \u2014 Input needed" : "Palot"

		return () => {
			document.title = "Palot"
		}
	}, [hasWaiting])
}
