import { useParams } from "@tanstack/react-router"
import { useAtomValue } from "jotai"
import { useCallback } from "react"
import { agentFamily, sessionNameFamily } from "../atoms/derived/agents"
import { useSessionRevert } from "../hooks/use-commands"
import type { ModelRef } from "../hooks/use-opencode-data"
import { useConfig, useOpenCodeAgents, useProviders, useVcs } from "../hooks/use-opencode-data"
import { useAgentActions } from "../hooks/use-server"
import { useSessionChat } from "../hooks/use-session-chat"
import { createLogger } from "../lib/logger"
import type { Agent, FileAttachment, QuestionAnswer } from "../lib/types"
import { AgentDetail } from "./agent-detail"

const log = createLogger("session-route")

export function SessionRoute() {
	// TanStack Router params — strict: false since we're in a nested route
	const { sessionId } = useParams({ strict: false }) as {
		sessionId?: string
		projectSlug?: string
	}

	const { abort, sendPrompt, renameSession, respondToPermission, replyToQuestion, rejectQuestion } =
		useAgentActions()

	const selectedAgent = useAtomValue(agentFamily(sessionId ?? ""))

	// Resolve parent session name for breadcrumb navigation
	const parentSessionName = useAtomValue(sessionNameFamily(selectedAgent?.parentId ?? ""))

	// Load chat turns for the selected session
	const isSessionActive = selectedAgent?.status === "running" || selectedAgent?.status === "waiting"
	const {
		turns: chatTurns,
		loading: chatLoading,
		loadingEarlier: chatLoadingEarlier,
		hasEarlierMessages: chatHasEarlier,
		loadEarlier: chatLoadEarlier,
	} = useSessionChat(
		selectedAgent?.directory ?? null,
		selectedAgent?.sessionId ?? null,
		isSessionActive,
	)

	// Undo/redo for this session
	const { canUndo, canRedo, undo, redo, isReverted, revertToMessage } = useSessionRevert(
		selectedAgent?.directory ?? null,
		selectedAgent?.sessionId ?? null,
	)

	// Toolbar data — providers, config, VCS, and OpenCode agents
	const directory = selectedAgent?.directory ?? null
	const { data: providers } = useProviders(directory)
	const { data: config } = useConfig(directory)
	const { data: vcs } = useVcs(directory)
	const { agents: openCodeAgents } = useOpenCodeAgents(directory)

	// Handlers
	const handleStopAgent = useCallback(
		async (agent: Agent) => {
			await abort(agent.directory, agent.sessionId)
		},
		[abort],
	)

	const handleApprovePermission = useCallback(
		async (agent: Agent, permissionId: string, response?: "once" | "always") => {
			await respondToPermission(agent.directory, agent.sessionId, permissionId, response ?? "once")
		},
		[respondToPermission],
	)

	const handleDenyPermission = useCallback(
		async (agent: Agent, permissionId: string) => {
			await respondToPermission(agent.directory, agent.sessionId, permissionId, "reject")
		},
		[respondToPermission],
	)

	const handleReplyQuestion = useCallback(
		async (agent: Agent, requestId: string, answers: QuestionAnswer[]) => {
			await replyToQuestion(agent.directory, requestId, answers)
		},
		[replyToQuestion],
	)

	const handleRejectQuestion = useCallback(
		async (agent: Agent, requestId: string) => {
			await rejectQuestion(agent.directory, requestId)
		},
		[rejectQuestion],
	)

	const handleRenameSession = useCallback(
		async (agent: Agent, title: string) => {
			await renameSession(agent.directory, agent.sessionId, title)
		},
		[renameSession],
	)

	const handleSendMessage = useCallback(
		async (
			agent: Agent,
			message: string,
			options?: {
				model?: ModelRef
				agentName?: string
				variant?: string
				files?: FileAttachment[]
			},
		) => {
			log.debug("handleSendMessage", {
				sessionId: agent.sessionId,
				directory: agent.directory,
				messageLength: message.length,
				model: options?.model,
				agentName: options?.agentName,
				variant: options?.variant,
			})
			try {
				await sendPrompt(agent.directory, agent.sessionId, message, {
					model: options?.model,
					agent: options?.agentName || undefined,
					variant: options?.variant,
					files: options?.files,
				})
				log.debug("handleSendMessage completed", { sessionId: agent.sessionId })
			} catch (err) {
				log.error("handleSendMessage failed", { sessionId: agent.sessionId }, err)
				throw err
			}
		},
		[sendPrompt],
	)

	// Not found state
	if (!selectedAgent) {
		return (
			<div className="flex h-full items-center justify-center">
				<div className="text-center">
					<p className="text-sm font-medium text-muted-foreground">Session not found</p>
					<p className="mt-1 text-xs text-muted-foreground/60">
						This session may have been deleted or is not yet loaded
					</p>
				</div>
			</div>
		)
	}

	return (
		<AgentDetail
			agent={selectedAgent}
			chatTurns={chatTurns}
			chatLoading={chatLoading}
			chatLoadingEarlier={chatLoadingEarlier}
			chatHasEarlier={chatHasEarlier}
			onLoadEarlier={chatLoadEarlier}
			onStop={handleStopAgent}
			onApprove={handleApprovePermission}
			onDeny={handleDenyPermission}
			onReplyQuestion={handleReplyQuestion}
			onRejectQuestion={handleRejectQuestion}
			onSendMessage={handleSendMessage}
			onRename={handleRenameSession}
			parentSessionName={parentSessionName}
			isConnected={true}
			providers={providers}
			config={config}
			vcs={vcs}
			openCodeAgents={openCodeAgents}
			canUndo={canUndo}
			canRedo={canRedo}
			onUndo={undo}
			onRedo={redo}
			isReverted={isReverted}
			onRevertToMessage={revertToMessage}
		/>
	)
}
