import { SidebarInset, SidebarProvider } from "@codedeck/ui/components/sidebar"
import { TooltipProvider } from "@codedeck/ui/components/tooltip"
import { Outlet, useNavigate, useParams } from "@tanstack/react-router"
import { useCallback, useEffect, useMemo } from "react"
import {
	useAgents,
	useCommandPaletteOpen,
	useProjectList,
	useSetCommandPaletteOpen,
	useShowSubAgents,
	useToggleShowSubAgents,
} from "../hooks/use-agents"
import { useDiscovery } from "../hooks/use-discovery"
import { useAgentActions, useServerConnection } from "../hooks/use-server"
import { useThemeEffect } from "../hooks/use-theme"
import { useWaitingIndicator } from "../hooks/use-waiting-indicator"
import type { Agent } from "../lib/types"
import { pickDirectory } from "../services/backend"
import { loadProjectSessions } from "../services/connection-manager"
import { AppBar } from "./app-bar"
import { AppBarProvider } from "./app-bar-context"
import { CommandPalette } from "./command-palette"
import { AppSidebar } from "./sidebar"
import { UpdateBanner } from "./update-banner"

export function RootLayout() {
	useDiscovery()
	useServerConnection()
	useWaitingIndicator()
	useThemeEffect()

	const agents = useAgents()
	const projects = useProjectList()
	const showSubAgents = useShowSubAgents()
	const toggleShowSubAgents = useToggleShowSubAgents()
	const commandPaletteOpen = useCommandPaletteOpen()
	const setCommandPaletteOpen = useSetCommandPaletteOpen()
	const navigate = useNavigate()
	const params = useParams({ strict: false })
	const sessionId = (params as Record<string, string | undefined>).sessionId

	const visibleAgents = useMemo(() => {
		if (showSubAgents) return agents
		return agents.filter((agent) => !agent.parentId)
	}, [agents, showSubAgents])

	const subAgentCount = useMemo(() => agents.filter((a) => a.parentId).length, [agents])

	const { renameSession, deleteSession } = useAgentActions()

	const handleRenameSession = useCallback(
		async (agent: Agent, title: string) => {
			await renameSession(agent.directory, agent.sessionId, title)
		},
		[renameSession],
	)

	const handleDeleteSession = useCallback(
		async (agent: Agent) => {
			await deleteSession(agent.directory, agent.sessionId)
		},
		[deleteSession],
	)

	// ========== Add project ==========

	const handleAddProject = useCallback(async () => {
		const directory = await pickDirectory()
		if (!directory) return
		// Load sessions for the new directory — this implicitly registers
		// the project with the OpenCode server via the x-opencode-directory header
		await loadProjectSessions(directory)
		// Navigate to the new project's page (slug will be derived by useProjectList)
		navigate({ to: "/" })
	}, [navigate])

	// ========== Keyboard navigation ==========

	const handleKeyDown = useCallback(
		(e: KeyboardEvent) => {
			const target = e.target as HTMLElement
			if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
				return
			}

			if (e.key === "Escape") {
				e.preventDefault()
				navigate({ to: "/" })
				return
			}

			if ((e.key === "j" || e.key === "k") && !e.metaKey && !e.ctrlKey && !e.altKey) {
				e.preventDefault()
				const currentIndex = visibleAgents.findIndex((a) => a.id === sessionId)
				let nextIndex: number
				if (e.key === "j") {
					nextIndex = currentIndex < visibleAgents.length - 1 ? currentIndex + 1 : 0
				} else {
					nextIndex = currentIndex > 0 ? currentIndex - 1 : visibleAgents.length - 1
				}
				const agent = visibleAgents[nextIndex]
				if (agent) {
					navigate({
						to: "/project/$projectSlug/session/$sessionId",
						params: {
							projectSlug: agent.projectSlug,
							sessionId: agent.id,
						},
					})
				}
				return
			}

			if ((e.metaKey || e.ctrlKey) && e.key === "n") {
				e.preventDefault()
				navigate({ to: "/" })
				return
			}

			if ((e.metaKey || e.ctrlKey) && e.key === "k") {
				e.preventDefault()
				setCommandPaletteOpen(true)
				return
			}
		},
		[sessionId, visibleAgents, navigate, setCommandPaletteOpen],
	)

	useEffect(() => {
		document.addEventListener("keydown", handleKeyDown)
		return () => document.removeEventListener("keydown", handleKeyDown)
	}, [handleKeyDown])

	// ========== Layout ==========

	return (
		<TooltipProvider>
			<AppBarProvider>
				<div className="flex h-screen flex-col bg-background text-foreground">
					<UpdateBanner />
					<SidebarProvider embedded defaultOpen={true} className="flex-col">
						{/* Fixed app bar — spans full width, above sidebar + content */}
						<AppBar
							onOpenCommandPalette={() => setCommandPaletteOpen(true)}
							showSubAgents={showSubAgents}
							subAgentCount={subAgentCount}
							onToggleSubAgents={toggleShowSubAgents}
						/>

						{/* Sidebar + main content below the app bar */}
						<div className="flex min-h-0 flex-1">
							<AppSidebar
								agents={visibleAgents}
								projects={projects}
								onOpenCommandPalette={() => setCommandPaletteOpen(true)}
								onAddProject={handleAddProject}
								showSubAgents={showSubAgents}
								subAgentCount={subAgentCount}
								onToggleSubAgents={toggleShowSubAgents}
								onRenameSession={handleRenameSession}
								onDeleteSession={handleDeleteSession}
							/>
							<SidebarInset>
								<Outlet />
							</SidebarInset>
						</div>
					</SidebarProvider>
				</div>
				<CommandPalette
					open={commandPaletteOpen}
					onOpenChange={setCommandPaletteOpen}
					agents={agents}
				/>
			</AppBarProvider>
		</TooltipProvider>
	)
}
