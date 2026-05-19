import type React from "react"
import { useCallback, useState } from "react"
import { contextCompactionActionFamily } from "../../atoms/context-compaction"
import { messagesFamily } from "../../atoms/messages"
import { setProjectModelAtom } from "../../atoms/preferences"
import { appStore } from "../../atoms/store"
import type { ConfigData, ModelRef, ProvidersData } from "../../hooks/use-opencode-data"
import {
	evaluateContextCompactionPolicy,
	type ContextCompactionPolicyResult,
} from "../../lib/context-compaction-policy"
import { createLogger } from "../../lib/logger"
import { computeContextUsage, type ModelLimitInfo } from "../../lib/session-metrics"
import type { Agent, FileAttachment } from "../../lib/types"
import { getProjectClient } from "../../services/connection-manager"
import { getBrainContextSummary, writeBrainFile, isElectron } from "../../services/backend"
import type { DiffComment } from "../review/diff-comment-model"
import type { ScrollHandle } from "./chat-scroll"
import type { PromptMention } from "./prompt-mentions"
import type { PromptTextController } from "./prompt-input-bridges"
import { prepareChatMessage } from "./chat-send"

const log = createLogger("chat-view")

export function useChatSend({
	agent,
	isConnected,
	onSendMessage,
	effectiveModel,
	providers,
	compaction,
	selectedAgent,
	selectedVariant,
	handleSlashCommand,
	slashCommandRef,
	clearDraft,
	setMentions,
	diffComments,
	setDiffComments,
	scrollRef,
}: {
	agent: Agent
	isConnected: boolean
	onSendMessage?: (
		agent: Agent,
		message: string,
		options?: { model?: ModelRef; agentName?: string; variant?: string; files?: FileAttachment[] },
	) => Promise<void>
	effectiveModel: ModelRef | null
	providers?: ProvidersData | null
	compaction?: ConfigData["compaction"]
	selectedAgent: string | null
	selectedVariant?: string
	handleSlashCommand: (text: string) => Promise<boolean | string>
	slashCommandRef: React.RefObject<PromptTextController | null>
	clearDraft: () => void
	setMentions: React.Dispatch<React.SetStateAction<PromptMention[]>>
	diffComments: DiffComment[]
	setDiffComments: React.Dispatch<React.SetStateAction<DiffComment[]>>
	scrollRef: React.RefObject<ScrollHandle | null>
}) {
	const [sending, setSending] = useState(false)

	const evaluateContextPolicy = useCallback((): ContextCompactionPolicyResult | null => {
		const messages = appStore.get(messagesFamily(agent.sessionId))
		const getModelLimit = (providerID: string, modelID: string): ModelLimitInfo | undefined => {
			if (!providers?.providers) return undefined
			for (const provider of providers.providers) {
				if (provider.id !== providerID) continue
				const model = provider.models[modelID]
				if (model?.limit?.context) return model.limit
			}
			return undefined
		}
		const usage = computeContextUsage(
			messages,
			getModelLimit,
			compaction ? { auto: compaction.auto, reserved: compaction.reserved } : undefined,
		)
		if (!usage) return null
		const actionState = appStore.get(contextCompactionActionFamily(agent.sessionId))
		return evaluateContextCompactionPolicy({
			usage,
			isCompacting: actionState.state === "AUTO_COMPACTING",
			wasCompacted: actionState.state === "COMPACTED" && Date.now() - actionState.updatedAt < 10_000,
			autoCompactionEnabled: compaction?.auto !== false,
		})
	}, [agent.sessionId, providers, compaction])

	const compactIfNeeded = useCallback(async () => {
		const policy = evaluateContextPolicy()
		if (!policy) return
		if (policy.shouldBlockNewWork && !policy.shouldAutoCompact) {
			throw new Error(policy.operatorMessage)
		}
		if (!policy.shouldAutoCompact) return

		const client = getProjectClient(agent.directory)
		if (!client) throw new Error("Not connected to OpenCode server")

		// Save a context snapshot to brain before compacting so goals/blockers survive
		let contextSnapshot: string | undefined
		if (isElectron && agent.directory) {
			try {
				const summary = await getBrainContextSummary(agent.directory, agent.sessionId)
				if (summary.trim()) {
					contextSnapshot = summary
					const snapshotContent = [
						`---\nsessionId: ${agent.sessionId}\ncreatedAt: ${new Date().toISOString()}\n---`,
						"",
						summary,
					].join("\n")
					await writeBrainFile(
						`compaction-snapshot-${agent.sessionId}`,
						snapshotContent,
						agent.directory,
					)
				}
			} catch {
				// Non-fatal: proceed without snapshot
			}
		}

		appStore.set(contextCompactionActionFamily(agent.sessionId), {
			state: "AUTO_COMPACTING",
			updatedAt: Date.now(),
		})
		try {
			await client.session.summarize({ sessionID: agent.sessionId })
			appStore.set(contextCompactionActionFamily(agent.sessionId), {
				state: "COMPACTED",
				updatedAt: Date.now(),
				pendingContextRestore: contextSnapshot,
			})
		} catch (err) {
			appStore.set(contextCompactionActionFamily(agent.sessionId), {
				state: null,
				updatedAt: Date.now(),
				error: err instanceof Error ? err.message : "Failed to compact context",
			})
			throw err
		}
	}, [agent.directory, agent.sessionId, evaluateContextPolicy])

	const handleSend = useCallback(
		async (text: string, files?: FileAttachment[]) => {
			log.debug("handleSend called", {
				textLength: text.trim().length,
				hasOnSendMessage: !!onSendMessage,
				sending,
				sessionId: agent.sessionId,
			})
			if (!text.trim() || !onSendMessage || sending) {
				log.warn("handleSend bailed", {
					emptyText: !text.trim(),
					noOnSendMessage: !onSendMessage,
					sending,
				})
				return
			}

			if (text.trim().startsWith("/")) {
				const result = await handleSlashCommand(text)
				if (result === true) {
					// Fully handled built-in (undo/redo/compact) — clear input and stop.
					slashCommandRef.current?.setText("")
					clearDraft()
					setMentions([])
					return
				}
				if (typeof result === "string") {
					// Skill resolved — replace the raw slash command with the skill prompt
					// and fall through to onSendMessage so model/agent/compaction apply.
					text = result
				}
				// result === false: not a recognized command — fall through with original text
			}

			setSending(true)
			try {
				await compactIfNeeded()

				// If context was just compacted, prepend the saved snapshot to restore goals/blockers
				const compactionState = appStore.get(contextCompactionActionFamily(agent.sessionId))
				if (compactionState.pendingContextRestore) {
					text = `[Context restored after compaction]\n${compactionState.pendingContextRestore}\n\n---\n\n${text}`
					appStore.set(contextCompactionActionFamily(agent.sessionId), {
						...compactionState,
						pendingContextRestore: undefined,
					})
				}

				if (effectiveModel && agent.directory) {
					appStore.set(setProjectModelAtom, {
						directory: agent.directory,
						model: {
							...effectiveModel,
							variant: selectedVariant,
							agent: selectedAgent || undefined,
						},
					})
				}

				log.debug("handleSend calling onSendMessage", {
					sessionId: agent.sessionId,
					directory: agent.directory,
					model: effectiveModel,
					agentName: selectedAgent,
					variant: selectedVariant,
					hasFiles: !!(files && files.length > 0),
				})

				const prepared = prepareChatMessage({
					text,
					diffComments,
					effectiveModel,
					selectedAgent,
					selectedVariant,
					files,
				})

				await onSendMessage(agent, prepared.text, prepared.options)
				log.debug("handleSend onSendMessage completed", { sessionId: agent.sessionId })
				clearDraft()
				setMentions([])
				if (diffComments.length > 0) {
					setDiffComments([])
				}
				requestAnimationFrame(() => {
					scrollRef.current?.scrollToBottom("smooth")
				})
			} catch (err) {
				log.error("handleSend failed", { sessionId: agent.sessionId }, err)
			} finally {
				setSending(false)
			}
		},
		[
			onSendMessage,
			sending,
			agent,
			effectiveModel,
			selectedAgent,
			selectedVariant,
			clearDraft,
			handleSlashCommand,
			slashCommandRef,
			setMentions,
			diffComments,
			setDiffComments,
			scrollRef,
			compactIfNeeded,
		],
	)

	return {
		sending,
		canSend: isConnected && !sending,
		handleSend,
	}
}
