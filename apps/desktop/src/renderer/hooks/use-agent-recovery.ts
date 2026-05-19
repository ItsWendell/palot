/**
 * React hook that runs an automatic recovery loop for stalled/unresponsive
 * child sessions in a Hive Mind workflow.
 *
 * Polls every 30s and evaluates each child session's heartbeat status.
 * - STALLED children are aborted and re-prompted to restart.
 * - UNRESPONSIVE children are terminated (abort only).
 * - Throttles via recovery state (max restarts, cooldown period).
 */
import { useAtomValue } from "jotai"
import { useEffect } from "react"
import { recordRecoveryActionAtom, recoveryConfigFamily, recoveryStateFamily } from "../atoms/session-heartbeats"
import { childSessionsFamily } from "../atoms/sub-agents"
import { appStore } from "../atoms/store"
import { evaluateAgentHeartbeat } from "../lib/agent-heartbeat"
import { evaluateRecoveryAction, RESTART_PROMPT } from "../lib/agent-recovery"
import { createLogger } from "../lib/logger"
import { useAgentActions } from "./use-server"

const log = createLogger("use-agent-recovery")

/**
 * Starts an automatic recovery loop for child sessions of the given parent.
 *
 * @param parentSessionId - The Lead Agent session whose children to monitor.
 * @param directory - The project directory (needed for server API calls).
 */
export function useAgentRecovery(parentSessionId: string, directory: string) {
	const config = useAtomValue(recoveryConfigFamily(parentSessionId))
	const { abort, sendPrompt } = useAgentActions()

	useEffect(() => {
		if (!config.enabled || !directory) return

		const runRecovery = async () => {
			const children = appStore.get(childSessionsFamily(parentSessionId))
			const now = Date.now()

			for (const child of children) {
				const heartbeat = evaluateAgentHeartbeat({
					agentStatus: child.agentStatus,
					lastActivityAt: child.lastActivityAt,
					now,
				})
				const state = appStore.get(recoveryStateFamily(child.sessionId))
				const action = evaluateRecoveryAction(heartbeat.status, state, config, now)

				if (action === "restart") {
					try {
						log.info("auto-restarting stalled child", { childId: child.sessionId, name: child.name })
						await abort(child.directory, child.sessionId)
						await sendPrompt(child.directory, child.sessionId, RESTART_PROMPT)
						appStore.set(recordRecoveryActionAtom, { childId: child.sessionId, action: "restart" })
					} catch (err) {
						log.error("auto-recovery restart failed", { childId: child.sessionId }, err)
					}
				} else if (action === "terminate") {
					try {
						log.info("auto-terminating unresponsive child", { childId: child.sessionId, name: child.name })
						await abort(child.directory, child.sessionId)
						appStore.set(recordRecoveryActionAtom, { childId: child.sessionId, action: "terminate" })
					} catch (err) {
						log.error("auto-recovery terminate failed", { childId: child.sessionId }, err)
					}
				}
			}
		}

		const id = setInterval(runRecovery, 30_000)
		runRecovery()

		return () => clearInterval(id)
	}, [parentSessionId, config, directory, abort, sendPrompt])
}
