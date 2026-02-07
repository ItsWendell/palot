import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from "@codedeck/ui/components/resizable"
import { TooltipProvider } from "@codedeck/ui/components/tooltip"
import { useCallback, useEffect, useMemo, useState } from "react"
import { AgentDetail } from "./components/agent-detail"
import { AgentList } from "./components/agent-list"
import { AppSidebar } from "./components/app-sidebar"
import { CommandPalette } from "./components/command-palette"
import { ConnectServerDialog } from "./components/connect-server-dialog"
import { NewAgentDialog } from "./components/new-agent-dialog"
import {
	useAgents,
	useCommandPaletteOpen,
	useNewAgentDialogOpen,
	useProjectList,
	useSelectedEnvironment,
	useSelectedProject,
	useSelectedSessionId,
	useSelectedStatus,
	useSetCommandPaletteOpen,
	useSetNewAgentDialogOpen,
	useSetSelectedEnvironment,
	useSetSelectedProject,
	useSetSelectedSessionId,
	useSetSelectedStatus,
	useShowSubAgents,
	useToggleSelectedSessionId,
	useToggleShowSubAgents,
} from "./hooks/use-agents"
import { useDiscovery } from "./hooks/use-discovery"
import { useAgentActions, useServerConnection } from "./hooks/use-server"
import { useSessionMessages } from "./hooks/use-session-messages"
import type { Agent } from "./lib/types"

export function App() {
	// Auto-discover projects/sessions from local OpenCode storage
	useDiscovery()

	const agents = useAgents()
	const projects = useProjectList()
	const { hasConnections, connectedServers, connect } = useServerConnection()
	const { abort, createSession, sendPrompt, respondToPermission } = useAgentActions()

	// UI state — individual selectors for minimal re-renders
	const selectedProject = useSelectedProject()
	const selectedStatus = useSelectedStatus()
	const selectedEnvironment = useSelectedEnvironment()
	const selectedSessionId = useSelectedSessionId()
	const commandPaletteOpen = useCommandPaletteOpen()
	const newAgentDialogOpen = useNewAgentDialogOpen()
	const showSubAgents = useShowSubAgents()
	const toggleShowSubAgents = useToggleShowSubAgents()

	// UI setters — stable function references
	const setSelectedProject = useSetSelectedProject()
	const setSelectedStatus = useSetSelectedStatus()
	const setSelectedEnvironment = useSetSelectedEnvironment()
	const setSelectedSessionId = useSetSelectedSessionId()
	const toggleSelectedSessionId = useToggleSelectedSessionId()
	const setCommandPaletteOpen = useSetCommandPaletteOpen()
	const setNewAgentDialogOpen = useSetNewAgentDialogOpen()

	// Connect server dialog
	const [connectDialogOpen, setConnectDialogOpen] = useState(false)

	// Agents with sub-agent filter applied (used for counts and further filtering)
	const visibleAgents = useMemo(() => {
		if (showSubAgents) return agents
		return agents.filter((agent) => !agent.parentId)
	}, [agents, showSubAgents])

	// Sub-agent count for the toggle label
	const subAgentCount = useMemo(() => agents.filter((a) => a.parentId).length, [agents])

	// Filter agents by project/status/environment
	const filteredAgents = useMemo(() => {
		return visibleAgents.filter((agent) => {
			if (selectedProject && agent.project !== selectedProject) return false
			if (selectedStatus && agent.status !== selectedStatus) return false
			if (selectedEnvironment && agent.environment !== selectedEnvironment) return false
			return true
		})
	}, [visibleAgents, selectedProject, selectedStatus, selectedEnvironment])

	const selectedAgent = useMemo(
		() => agents.find((a) => a.id === selectedSessionId) || null,
		[agents, selectedSessionId],
	)

	const handleNewAgent = useCallback(() => {
		setNewAgentDialogOpen(true)
	}, [setNewAgentDialogOpen])

	const handleSelectAgent = useCallback(
		(id: string) => {
			toggleSelectedSessionId(id)
		},
		[toggleSelectedSessionId],
	)

	const handleConnect = useCallback(
		async (url: string, directory: string) => {
			await connect(url, directory)
		},
		[connect],
	)

	const handleLaunchAgent = useCallback(
		async (serverId: string, prompt: string) => {
			const session = await createSession(serverId, prompt.slice(0, 80))
			if (session) {
				await sendPrompt(serverId, session.id, prompt)
			}
		},
		[createSession, sendPrompt],
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

	const handleSendMessage = useCallback(
		async (agent: Agent, message: string) => {
			await sendPrompt(agent.serverId, agent.sessionId, message)
		},
		[sendPrompt],
	)

	// Load messages for the selected session
	const { activities: sessionActivities, loading: activitiesLoading } = useSessionMessages(
		selectedAgent?.serverId ?? null,
		selectedAgent?.sessionId ?? null,
	)

	// Use real activities from messages if available, otherwise fall back to agent's mock activities
	const detailActivities =
		sessionActivities.length > 0 ? sessionActivities : (selectedAgent?.activities ?? [])

	// Keyboard navigation
	useEffect(() => {
		function handleKeyDown(e: KeyboardEvent) {
			// Don't capture when typing in inputs
			const target = e.target as HTMLElement
			if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
				return
			}

			// Escape — close detail panel
			if (e.key === "Escape" && selectedSessionId) {
				e.preventDefault()
				setSelectedSessionId(null)
				return
			}

			// J/K — navigate agent list
			if (e.key === "j" || e.key === "k") {
				e.preventDefault()
				const currentIndex = filteredAgents.findIndex((a) => a.id === selectedSessionId)
				let nextIndex: number

				if (e.key === "j") {
					nextIndex = currentIndex < filteredAgents.length - 1 ? currentIndex + 1 : 0
				} else {
					nextIndex = currentIndex > 0 ? currentIndex - 1 : filteredAgents.length - 1
				}

				if (filteredAgents[nextIndex]) {
					setSelectedSessionId(filteredAgents[nextIndex].id)
				}
				return
			}

			// Cmd+N — new agent
			if ((e.metaKey || e.ctrlKey) && e.key === "n") {
				e.preventDefault()
				handleNewAgent()
				return
			}

			// Cmd+Shift+C — connect server
			if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "C") {
				e.preventDefault()
				setConnectDialogOpen(true)
				return
			}
		}

		document.addEventListener("keydown", handleKeyDown)
		return () => document.removeEventListener("keydown", handleKeyDown)
	}, [selectedSessionId, filteredAgents, setSelectedSessionId, handleNewAgent])

	return (
		<TooltipProvider>
			<div className="flex h-screen bg-background text-foreground">
				{/* Fixed-width sidebar */}
				<div className="w-[220px] shrink-0 border-r border-border">
					<AppSidebar
						projects={projects}
						agents={visibleAgents}
						selectedProject={selectedProject}
						selectedStatus={selectedStatus}
						selectedEnvironment={selectedEnvironment}
						onSelectProject={setSelectedProject}
						onSelectStatus={setSelectedStatus}
						onSelectEnvironment={setSelectedEnvironment}
						onNewAgent={handleNewAgent}
						onConnectServer={() => setConnectDialogOpen(true)}
						hasConnections={hasConnections}
					/>
				</div>

				{/* Resizable agent list + detail */}
				<div className="min-w-0 flex-1">
					{selectedAgent ? (
						<ResizablePanelGroup orientation="horizontal">
							<ResizablePanel id="agent-list" defaultSize={55} minSize={30}>
								<AgentList
									agents={filteredAgents}
									selectedAgentId={selectedSessionId}
									onSelectAgent={handleSelectAgent}
									onNewAgent={handleNewAgent}
									onOpenCommandPalette={() => setCommandPaletteOpen(true)}
									showSubAgents={showSubAgents}
									subAgentCount={subAgentCount}
									onToggleSubAgents={toggleShowSubAgents}
								/>
							</ResizablePanel>
							<ResizableHandle />
							<ResizablePanel id="agent-detail" defaultSize={45} minSize={25}>
								<AgentDetail
									agent={selectedAgent}
									activities={detailActivities}
									activitiesLoading={activitiesLoading}
									onClose={() => setSelectedSessionId(null)}
									onStop={handleStopAgent}
									onApprove={handleApprovePermission}
									onDeny={handleDenyPermission}
									onSendMessage={handleSendMessage}
									isConnected={hasConnections}
								/>
							</ResizablePanel>
						</ResizablePanelGroup>
					) : (
						<AgentList
							agents={filteredAgents}
							selectedAgentId={selectedSessionId}
							onSelectAgent={handleSelectAgent}
							onNewAgent={handleNewAgent}
							onOpenCommandPalette={() => setCommandPaletteOpen(true)}
							showSubAgents={showSubAgents}
							subAgentCount={subAgentCount}
							onToggleSubAgents={toggleShowSubAgents}
						/>
					)}
				</div>
			</div>

			{/* Dialogs — rendered outside the flex layout */}
			<CommandPalette
				open={commandPaletteOpen}
				onOpenChange={setCommandPaletteOpen}
				agents={agents}
				onNewAgent={handleNewAgent}
				onSelectAgent={handleSelectAgent}
			/>
			<NewAgentDialog
				open={newAgentDialogOpen}
				onOpenChange={setNewAgentDialogOpen}
				projects={projects}
				connectedServers={connectedServers.map((s) => ({
					id: s.id,
					name: s.directory.split("/").pop() || s.directory,
					directory: s.directory,
				}))}
				onLaunch={handleLaunchAgent}
			/>
			<ConnectServerDialog
				open={connectDialogOpen}
				onOpenChange={setConnectDialogOpen}
				onConnect={handleConnect}
			/>
		</TooltipProvider>
	)
}
