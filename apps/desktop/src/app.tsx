import { TooltipProvider } from "@codedeck/ui/components/tooltip"
import { useCallback, useEffect, useMemo, useState } from "react"
import { AgentDetail } from "./components/agent-detail"
import { CommandPalette } from "./components/command-palette"
import { NewSessionDialog } from "./components/new-session-dialog"
import { Sidebar } from "./components/sidebar"
import {
	useAgents,
	useCommandPaletteOpen,
	useNewAgentDialogOpen,
	useProjectList,
	useSelectedSessionId,
	useSetCommandPaletteOpen,
	useSetNewAgentDialogOpen,
	useSetSelectedSessionId,
	useShowSubAgents,
	useToggleSelectedSessionId,
	useToggleShowSubAgents,
} from "./hooks/use-agents"
import { useDiscovery } from "./hooks/use-discovery"
import { useAgentActions, useServerConnection } from "./hooks/use-server"
import { useSessionChat } from "./hooks/use-session-chat"
import { useSessionMessages } from "./hooks/use-session-messages"
import type { Agent } from "./lib/types"
import { ensureServerForProject } from "./services/connection-manager"

export function App() {
	// Auto-discover projects/sessions from local OpenCode storage
	useDiscovery()

	const agents = useAgents()
	const projects = useProjectList()
	useServerConnection() // Exposes server state to the store
	const { abort, createSession, sendPrompt, respondToPermission } = useAgentActions()

	// UI state
	const selectedSessionId = useSelectedSessionId()
	const commandPaletteOpen = useCommandPaletteOpen()
	const newSessionDialogOpen = useNewAgentDialogOpen()
	const showSubAgents = useShowSubAgents()
	const toggleShowSubAgents = useToggleShowSubAgents()

	// UI setters
	const setSelectedSessionId = useSetSelectedSessionId()
	const toggleSelectedSessionId = useToggleSelectedSessionId()
	const setCommandPaletteOpen = useSetCommandPaletteOpen()
	const setNewSessionDialogOpen = useSetNewAgentDialogOpen()

	// Pre-selected project for new session dialog
	const [newSessionProject, setNewSessionProject] = useState<string | null>(null)

	// Agents with sub-agent filter applied
	const visibleAgents = useMemo(() => {
		if (showSubAgents) return agents
		return agents.filter((agent) => !agent.parentId)
	}, [agents, showSubAgents])

	const subAgentCount = useMemo(() => agents.filter((a) => a.parentId).length, [agents])

	const selectedAgent = useMemo(
		() => agents.find((a) => a.id === selectedSessionId) || null,
		[agents, selectedSessionId],
	)

	// Resolve parent session name for breadcrumb navigation
	const parentSessionName = useMemo(() => {
		if (!selectedAgent?.parentId) return undefined
		const parent = agents.find((a) => a.id === selectedAgent.parentId)
		return parent?.name
	}, [agents, selectedAgent?.parentId])

	// ========== Handlers ==========

	const handleNewSession = useCallback(() => {
		setNewSessionProject(null)
		setNewSessionDialogOpen(true)
	}, [setNewSessionDialogOpen])

	const handleNewSessionForProject = useCallback(
		(projectName: string) => {
			setNewSessionProject(projectName)
			setNewSessionDialogOpen(true)
		},
		[setNewSessionDialogOpen],
	)

	const handleSelectSession = useCallback(
		(id: string) => {
			toggleSelectedSessionId(id)
		},
		[toggleSelectedSessionId],
	)

	/**
	 * Navigate to a session by ID — used for sub-agent navigation.
	 * Unlike toggleSelectedSessionId, this always selects (never deselects).
	 */
	const handleNavigateToSession = useCallback(
		(sessionId: string) => {
			setSelectedSessionId(sessionId)
		},
		[setSelectedSessionId],
	)

	/**
	 * Launch a new session for a project directory.
	 * Auto-starts the server if needed — the user never picks a server.
	 */
	const handleLaunchSession = useCallback(
		async (directory: string, prompt: string) => {
			const serverId = await ensureServerForProject(directory)
			const session = await createSession(serverId, prompt.slice(0, 80))
			if (session) {
				await sendPrompt(serverId, session.id, prompt)
				setSelectedSessionId(session.id)
			}
		},
		[createSession, sendPrompt, setSelectedSessionId],
	)

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

	/**
	 * Send a message to an existing session.
	 * Auto-starts the server if the session is offline.
	 */
	const handleSendMessage = useCallback(
		async (agent: Agent, message: string) => {
			let { serverId } = agent
			if (!serverId) {
				// Offline session — auto-start the server for its project
				serverId = await ensureServerForProject(agent.directory)
			}
			await sendPrompt(serverId, agent.sessionId, message)
		},
		[sendPrompt],
	)

	// Always allow interaction — auto-start handles server lifecycle transparently
	const isAgentConnected = true

	// Load messages for the selected session
	const { activities: sessionActivities, loading: activitiesLoading } = useSessionMessages(
		selectedAgent?.serverId ?? null,
		selectedAgent?.sessionId ?? null,
	)
	const isSessionActive = selectedAgent?.status === "running" || selectedAgent?.status === "waiting"
	const { turns: chatTurns, loading: chatLoading } = useSessionChat(
		selectedAgent?.serverId ?? null,
		selectedAgent?.sessionId ?? null,
		isSessionActive,
	)

	const detailActivities =
		sessionActivities.length > 0 ? sessionActivities : (selectedAgent?.activities ?? [])

	// ========== Keyboard navigation ==========

	useEffect(() => {
		function handleKeyDown(e: KeyboardEvent) {
			const target = e.target as HTMLElement
			if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
				return
			}

			if (e.key === "Escape" && selectedSessionId) {
				e.preventDefault()
				setSelectedSessionId(null)
				return
			}

			if (e.key === "j" || e.key === "k") {
				e.preventDefault()
				const currentIndex = visibleAgents.findIndex((a) => a.id === selectedSessionId)
				let nextIndex: number
				if (e.key === "j") {
					nextIndex = currentIndex < visibleAgents.length - 1 ? currentIndex + 1 : 0
				} else {
					nextIndex = currentIndex > 0 ? currentIndex - 1 : visibleAgents.length - 1
				}
				if (visibleAgents[nextIndex]) {
					setSelectedSessionId(visibleAgents[nextIndex].id)
				}
				return
			}

			if ((e.metaKey || e.ctrlKey) && e.key === "n") {
				e.preventDefault()
				handleNewSession()
				return
			}

			if ((e.metaKey || e.ctrlKey) && e.key === "k") {
				e.preventDefault()
				setCommandPaletteOpen(true)
				return
			}
		}

		document.addEventListener("keydown", handleKeyDown)
		return () => document.removeEventListener("keydown", handleKeyDown)
	}, [
		selectedSessionId,
		visibleAgents,
		setSelectedSessionId,
		handleNewSession,
		setCommandPaletteOpen,
	])

	// ========== Layout ==========

	return (
		<TooltipProvider>
			<div className="flex h-screen bg-background text-foreground">
				{/* Unified sidebar — replaces old sidebar + agent list */}
				<div className="w-[280px] shrink-0 border-r border-border">
					<Sidebar
						agents={visibleAgents}
						projects={projects}
						selectedSessionId={selectedSessionId}
						onSelectSession={handleSelectSession}
						onNewSession={handleNewSession}
						onNewSessionForProject={handleNewSessionForProject}
						onOpenCommandPalette={() => setCommandPaletteOpen(true)}
						showSubAgents={showSubAgents}
						subAgentCount={subAgentCount}
						onToggleSubAgents={toggleShowSubAgents}
					/>
				</div>

				{/* Detail panel — takes remaining space */}
				<div className="min-w-0 flex-1">
					{selectedAgent ? (
						<AgentDetail
							agent={selectedAgent}
							activities={detailActivities}
							activitiesLoading={activitiesLoading}
							chatTurns={chatTurns}
							chatLoading={chatLoading}
							onClose={() => setSelectedSessionId(null)}
							onStop={handleStopAgent}
							onApprove={handleApprovePermission}
							onDeny={handleDenyPermission}
							onSendMessage={handleSendMessage}
							onNavigateToSession={handleNavigateToSession}
							parentSessionName={parentSessionName}
							isConnected={isAgentConnected}
						/>
					) : (
						<EmptyDetail onNewSession={handleNewSession} />
					)}
				</div>
			</div>

			{/* Dialogs */}
			<CommandPalette
				open={commandPaletteOpen}
				onOpenChange={setCommandPaletteOpen}
				agents={agents}
				onNewSession={handleNewSession}
				onSelectAgent={handleSelectSession}
			/>
			<NewSessionDialog
				open={newSessionDialogOpen}
				onOpenChange={setNewSessionDialogOpen}
				preSelectedProject={newSessionProject}
				projects={projects}
				onLaunch={handleLaunchSession}
			/>
		</TooltipProvider>
	)
}

/**
 * Empty state when no session is selected.
 */
function EmptyDetail({ onNewSession }: { onNewSession: () => void }) {
	return (
		<div className="flex h-full items-center justify-center">
			<div className="space-y-4 text-center">
				<div className="mx-auto flex size-16 items-center justify-center rounded-full bg-muted">
					<svg
						aria-hidden="true"
						className="size-8 text-muted-foreground"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
					>
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							strokeWidth={1.5}
							d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
						/>
					</svg>
				</div>
				<div>
					<p className="text-sm font-medium text-muted-foreground">No session selected</p>
					<p className="mt-1 text-xs text-muted-foreground/60">
						Select a session from the sidebar or start a new one
					</p>
				</div>
				<button
					type="button"
					onClick={onNewSession}
					className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
				>
					New Session
				</button>
				<div className="text-xs text-muted-foreground/40">
					<kbd className="rounded border border-border bg-muted px-1 py-0.5 text-[10px]">
						&#8984;N
					</kbd>{" "}
					new session{" · "}
					<kbd className="rounded border border-border bg-muted px-1 py-0.5 text-[10px]">
						&#8984;K
					</kbd>{" "}
					search{" · "}
					<kbd className="rounded border border-border bg-muted px-1 py-0.5 text-[10px]">J</kbd>
					<kbd className="ml-0.5 rounded border border-border bg-muted px-1 py-0.5 text-[10px]">
						K
					</kbd>{" "}
					navigate
				</div>
			</div>
		</div>
	)
}
