import { useEffect, useMemo } from "react"
import { useAgents } from "./use-agents"

/**
 * Updates the browser tab title when any agent is waiting for user input
 * (permission approval or question response).
 */
export function useWaitingIndicator() {
	const agents = useAgents()

	const hasWaiting = useMemo(() => agents.some((agent) => agent.status === "waiting"), [agents])

	useEffect(() => {
		document.title = hasWaiting ? "(!) Codedeck \u2014 Input needed" : "Codedeck"

		return () => {
			document.title = "Codedeck"
		}
	}, [hasWaiting])
}
