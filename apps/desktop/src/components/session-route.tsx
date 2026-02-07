import { useParams } from "@tanstack/react-router"
import { useCallback, useMemo } from "react"
import { useAgents } from "../hooks/use-agents"
import { useAgentActions } from "../hooks/use-server"
import { useSessionChat } from "../hooks/use-session-chat"
import { useSessionMessages } from "../hooks/use-session-messages"
import type { Agent } from "../lib/types"
import { ensureServerForProject } from "../services/connection-manager"
import { AgentDetail } from "./agent-detail"

export function SessionRoute() {
	// TanStack Router params — strict: false since we're in a nested route
	const { sessionId } = useParams({ strict: false }) as {
		sessionId?: string
		projectSlug?: string
	}

	const agents = useAgents()
	const { abort, sendPrompt, respondToPermission } = useAgentActions()

	const selectedAgent = useMemo(
		() => agents.find((a) => a.id === sessionId) ?? null,
		[agents, sessionId],
	)

	// Resolve parent session name for breadcrumb navigation
	const parentSessionName = useMemo(() => {
		if (!selectedAgent?.parentId) return undefined
		const parent = agents.find((a) => a.id === selectedAgent.parentId)
		return parent?.name
	}, [agents, selectedAgent?.parentId])

	// Load messages for the selected session
	const { activities, loading: activitiesLoading } = useSessionMessages(
		selectedAgent?.serverId ?? null,
		selectedAgent?.sessionId ?? null,
	)
	const isSessionActive = selectedAgent?.status === "running" || selectedAgent?.status === "waiting"
	const { turns: chatTurns, loading: chatLoading } = useSessionChat(
		selectedAgent?.serverId ?? null,
		selectedAgent?.sessionId ?? null,
		isSessionActive,
	)

	const detailActivities = activities.length > 0 ? activities : (selectedAgent?.activities ?? [])

	// Handlers
	const handleStopAgent = useCallback(
		async (agent: Agent) => {
			await abort(agent.serverId, agent.sessionId)
		},
		[abort],
	)

	const handleApprovePermission = useCallback(
		async (agent: Agent, permissionId: string) => {
			await respondToPermission(agent.serverId, agent.sessionId, permissionId, "once")
		},
		[respondToPermission],
	)

	const handleDenyPermission = useCallback(
		async (agent: Agent, permissionId: string) => {
			await respondToPermission(agent.serverId, agent.sessionId, permissionId, "reject")
		},
		[respondToPermission],
	)

	const handleSendMessage = useCallback(
		async (agent: Agent, message: string) => {
			let { serverId } = agent
			if (!serverId) {
				serverId = await ensureServerForProject(agent.directory)
			}
			await sendPrompt(serverId, agent.sessionId, message)
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
			activities={detailActivities}
			activitiesLoading={activitiesLoading}
			chatTurns={chatTurns}
			chatLoading={chatLoading}
			onStop={handleStopAgent}
			onApprove={handleApprovePermission}
			onDeny={handleDenyPermission}
			onSendMessage={handleSendMessage}
			parentSessionName={parentSessionName}
			isConnected={true}
		/>
	)
}
