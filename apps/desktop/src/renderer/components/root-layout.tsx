import { Button } from "@codedeck/ui/components/button"
import { SidebarInset, SidebarProvider, useSidebar } from "@codedeck/ui/components/sidebar"
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@codedeck/ui/components/tooltip"
import { Outlet, useNavigate, useParams } from "@tanstack/react-router"
import { PanelLeftIcon, PlusIcon } from "lucide-react"
import { useCallback, useEffect, useMemo } from "react"
import {
	useAgents,
	useCommandPaletteOpen,
	useProjectList,
	useSetCommandPaletteOpen,
	useShowSubAgents,
	useToggleShowSubAgents,
} from "../hooks/use-agents"
import { useChromeTier } from "../hooks/use-chrome-tier"
import { useDiscovery } from "../hooks/use-discovery"
import { useNotifications } from "../hooks/use-notifications"
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

const isMac =
	typeof window !== "undefined" && "codedeck" in window && window.codedeck.platform === "darwin"
const isElectronEnv = typeof window !== "undefined" && "codedeck" in window

/** Pixel offset from the left edge where window controls (toggle + new session) start */
const WINDOW_CONTROLS_LEFT = isMac && isElectronEnv ? 93 : 8
/** Total width reserved for traffic lights + window control buttons */
const WINDOW_CONTROLS_INSET = isMac && isElectronEnv ? 160 : 72

/**
 * Absolutely positioned window controls (sidebar toggle + new session) that
 * stay next to the macOS traffic lights regardless of sidebar state.
 * Must be rendered inside a SidebarProvider.
 */
function WindowControls() {
	const { toggleSidebar } = useSidebar()
	const navigate = useNavigate()

	return (
		<div
			className="absolute z-50 flex items-center gap-0.5"
			style={{
				top: 8,
				left: WINDOW_CONTROLS_LEFT,
				// @ts-expect-error -- vendor-prefixed CSS property
				WebkitAppRegion: "no-drag",
			}}
		>
			<Tooltip>
				<TooltipTrigger asChild>
					<Button variant="ghost" size="icon" className="size-7 shrink-0" onClick={toggleSidebar}>
						<PanelLeftIcon className="size-3.5" />
					</Button>
				</TooltipTrigger>
				<TooltipContent>Toggle sidebar (&#8984;B)</TooltipContent>
			</Tooltip>
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						variant="ghost"
						size="icon"
						className="size-7 shrink-0"
						onClick={() => navigate({ to: "/" })}
					>
						<PlusIcon className="size-3.5" />
					</Button>
				</TooltipTrigger>
				<TooltipContent>New session (&#8984;N)</TooltipContent>
			</Tooltip>
		</div>
	)
}

export function RootLayout() {
	useDiscovery()
	useServerConnection()
	useWaitingIndicator()
	useThemeEffect()
	useChromeTier()

	const agents = useAgents()
	const projects = useProjectList()
	const showSubAgents = useShowSubAgents()
	const toggleShowSubAgents = useToggleShowSubAgents()
	const commandPaletteOpen = useCommandPaletteOpen()
	const setCommandPaletteOpen = useSetCommandPaletteOpen()
	const navigate = useNavigate()
	const params = useParams({ strict: false })
	const sessionId = (params as Record<string, string | undefined>).sessionId

	// Native OS notifications: badge sync, click-to-navigate, auto-dismiss
	useNotifications(navigate, sessionId)

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
				<div
					className="relative flex h-screen text-foreground"
					style={
						{
							"--window-controls-inset": `${WINDOW_CONTROLS_INSET}px`,
						} as React.CSSProperties
					}
				>
					<SidebarProvider embedded defaultOpen={true}>
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
							<UpdateBanner />
							<AppBar />
							{/* Flex-1 + min-h-0 wrapper: pages use h-full which would
						    resolve to 100% of SidebarInset, ignoring AppBar height.
						    This container takes remaining space after AppBar and
						    constrains page content correctly. */}
							<div className="relative min-h-0 flex-1">
								<Outlet />
							</div>
						</SidebarInset>
						{/* Rendered last so it paints on top of the sidebar and app bar,
						    whose transition properties create stacking contexts. */}
						<WindowControls />
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
