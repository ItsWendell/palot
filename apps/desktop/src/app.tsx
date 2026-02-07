import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from "@codedeck/ui/components/resizable"
import { TooltipProvider } from "@codedeck/ui/components/tooltip"
import { useCallback, useMemo } from "react"
import { AgentDetail } from "./components/agent-detail"
import { AgentList } from "./components/agent-list"
import { AppSidebar } from "./components/app-sidebar"
import { CommandPalette } from "./components/command-palette"
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
	useToggleSelectedSessionId,
} from "./hooks/use-agents"
import { MOCK_AGENTS, MOCK_PROJECTS } from "./lib/mock-data"
import type { Agent } from "./lib/types"

/**
 * Whether to use mock data (when no OpenCode servers are connected).
 * In development without a running server, this provides the demo UI.
 * Once real servers connect via the store, real data takes over.
 */
const USE_MOCK_DATA = true

export function App() {
	const storeAgents = useAgents()
	const storeProjects = useProjectList()

	// UI state — individual selectors for minimal re-renders
	const selectedProject = useSelectedProject()
	const selectedStatus = useSelectedStatus()
	const selectedEnvironment = useSelectedEnvironment()
	const selectedSessionId = useSelectedSessionId()
	const commandPaletteOpen = useCommandPaletteOpen()
	const newAgentDialogOpen = useNewAgentDialogOpen()

	// UI setters — stable function references
	const setSelectedProject = useSetSelectedProject()
	const setSelectedStatus = useSetSelectedStatus()
	const setSelectedEnvironment = useSetSelectedEnvironment()
	const setSelectedSessionId = useSetSelectedSessionId()
	const toggleSelectedSessionId = useToggleSelectedSessionId()
	const setCommandPaletteOpen = useSetCommandPaletteOpen()
	const setNewAgentDialogOpen = useSetNewAgentDialogOpen()

	// Use store data if available, otherwise fall back to mock
	const agents: Agent[] = USE_MOCK_DATA && storeAgents.length === 0 ? MOCK_AGENTS : storeAgents
	const projects = USE_MOCK_DATA && storeProjects.length === 0 ? MOCK_PROJECTS : storeProjects

	// Filter agents
	const filteredAgents = useMemo(() => {
		return agents.filter((agent) => {
			if (selectedProject && agent.project !== selectedProject) return false
			if (selectedStatus && agent.status !== selectedStatus) return false
			if (selectedEnvironment && agent.environment !== selectedEnvironment) return false
			return true
		})
	}, [agents, selectedProject, selectedStatus, selectedEnvironment])

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

	return (
		<TooltipProvider>
			<div className="flex h-screen bg-background text-foreground">
				{/* Fixed-width sidebar */}
				<div className="w-[220px] shrink-0 border-r border-border">
					<AppSidebar
						projects={projects}
						agents={agents}
						selectedProject={selectedProject}
						selectedStatus={selectedStatus}
						selectedEnvironment={selectedEnvironment}
						onSelectProject={setSelectedProject}
						onSelectStatus={setSelectedStatus}
						onSelectEnvironment={setSelectedEnvironment}
						onNewAgent={handleNewAgent}
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
								/>
							</ResizablePanel>
							<ResizableHandle />
							<ResizablePanel id="agent-detail" defaultSize={45} minSize={25}>
								<AgentDetail agent={selectedAgent} onClose={() => setSelectedSessionId(null)} />
							</ResizablePanel>
						</ResizablePanelGroup>
					) : (
						<AgentList
							agents={filteredAgents}
							selectedAgentId={selectedSessionId}
							onSelectAgent={handleSelectAgent}
							onNewAgent={handleNewAgent}
							onOpenCommandPalette={() => setCommandPaletteOpen(true)}
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
			/>
		</TooltipProvider>
	)
}
