/**
 * useMem9Memory — stores agent completions as Mem9 memories
 * and provides recall context before spawning.
 */

import { useAtomValue } from "jotai"
import { useEffect, useRef } from "react"
import { childSessionsFamily } from "../atoms/sub-agents"
import { messagesFamily } from "../atoms/messages"
import { partsFamily } from "../atoms/parts"
import { appStore } from "../atoms/store"
import { mem9Recall, mem9Store, mem9Status } from "../services/backend"
import { createLogger } from "../lib/logger"
import type { AgentStatus } from "../lib/types"

const log = createLogger("mem9-hook")

/**
 * Reactively stores each child session's completion output as a Mem9 memory.
 * Runs alongside useSubAgentCompletion — same transition detection logic.
 */
export function useMem9MemoryStorage(
	parentSessionId: string,
	projectPath: string | undefined,
): void {
	const children = useAtomValue(childSessionsFamily(parentSessionId))
	const configuredRef = useRef(false)
	const recordedRef = useRef(new Set<string>())
	const prevStatusRef = useRef(new Map<string, AgentStatus>())

	// Check if Mem9 is configured on first mount
	useEffect(() => {
		mem9Status()
			.then((s) => {
				configuredRef.current = s.configured
			})
			.catch((err) => {
				configuredRef.current = false
				log.warn("Failed to check Mem9 status", {
					error: err instanceof Error ? err.message : String(err),
				})
			})
	}, [])

	useEffect(() => {
		if (!projectPath || !configuredRef.current) return

		for (const child of children) {
			const prev = prevStatusRef.current.get(child.sessionId)
			const curr = child.agentStatus

				if (
					prev === "running" &&
					(curr === "completed" || curr === "idle" || curr === "failed") &&
					!recordedRef.current.has(child.sessionId)
				) {
				recordedRef.current.add(child.sessionId)

				// Extract assistant response text
				const messages = appStore.get(messagesFamily(child.sessionId))
				const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant")
				let content = `Agent ${child.name} completed.`
				if (lastAssistant) {
					const parts = appStore.get(partsFamily(lastAssistant.id))
					const text = parts
						.filter((p) => p.type === "text")
						.map((p) => ("text" in p ? p.text : ""))
						.join(" ")
						.trim()
					if (text) content = text.slice(0, 2000)
				}

				// Store asynchronously — fire and forget
					mem9Store({
						content,
						source: `session:${child.sessionId}`,
						tags: ["agent-output", child.name.toLowerCase().replace(/\s+/g, "-")],
					metadata: {
						agentName: child.name,
						sessionId: child.sessionId,
						parentSessionId,
							status: curr,
						},
					}).then((result) => {
						if (result) {
							log.info("Stored agent output as memory", { id: result.id, agent: child.name })
						}
					}).catch((err) => {
						log.warn("Failed to store agent output as Mem9 memory", {
							agent: child.name,
							sessionId: child.sessionId,
							error: err instanceof Error ? err.message : String(err),
						})
					})
				}

			prevStatusRef.current.set(child.sessionId, curr)
		}
	}, [children, projectPath, parentSessionId])
}

/**
 * Recall relevant memories for a spawn context.
 * This is NOT a hook — it's a standalone async utility.
 * Returns formatted context string or null if no relevant memories found.
 */
export async function recallForSpawn(query: string, limit = 5): Promise<string | null> {
	const status = await mem9Status()
	if (!status.configured) return null
	return mem9Recall(query, limit)
}
