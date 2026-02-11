import { useAtomValue } from "jotai"
import { useCallback, useEffect } from "react"
import { agentsAtom } from "../atoms/derived/agents"
import { pendingCountAtom } from "../atoms/derived/waiting"

const isElectron = typeof window !== "undefined" && "codedeck" in window

/**
 * Handles native OS notification integration:
 * 1. Listens for notification clicks (main -> renderer) and navigates to the session
 * 2. Syncs the pending count to the dock badge
 * 3. Auto-dismisses notifications when the user navigates to a session
 */
export function useNotifications(
	navigate: (opts: { to: string; params: Record<string, string> }) => void,
	currentSessionId: string | undefined,
) {
	// --- Badge sync ---
	const pendingCount = useAtomValue(pendingCountAtom)
	const agents = useAtomValue(agentsAtom)

	useEffect(() => {
		if (!isElectron) return
		window.codedeck.updateBadgeCount(pendingCount)
	}, [pendingCount])

	// --- Notification click -> navigate to session ---
	const handleNavigate = useCallback(
		(data: { sessionId: string }) => {
			// Find the agent to get its projectSlug
			const agent = agents.find((a) => a.id === data.sessionId)
			if (agent) {
				navigate({
					to: "/project/$projectSlug/session/$sessionId",
					params: {
						projectSlug: agent.projectSlug,
						sessionId: agent.id,
					},
				})
			}
		},
		[agents, navigate],
	)

	useEffect(() => {
		if (!isElectron) return
		return window.codedeck.onNotificationNavigate(handleNavigate)
	}, [handleNavigate])

	// --- Auto-dismiss when viewing a session ---
	useEffect(() => {
		if (!isElectron || !currentSessionId) return
		window.codedeck.dismissNotification(currentSessionId)
	}, [currentSessionId])
}
