/**
 * Sidebar shell layout: wraps child routes with the sidebar + SidebarInset chrome.
 * Reads from SidebarSlotContext to allow child routes to override sidebar content.
 */
import { Button } from "@palot/ui/components/button"
import {
	Sidebar,
	SidebarHeader,
	SidebarInset,
	SidebarProvider,
	useSidebar,
} from "@palot/ui/components/sidebar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@palot/ui/components/tooltip"
import { Outlet, useNavigate } from "@tanstack/react-router"
import { PanelLeftIcon, PlusIcon } from "lucide-react"
import { useCallback, useMemo } from "react"
import {
	useAgents,
	useProjectList,
	useSetCommandPaletteOpen,
	useShowSubAgents,
	useToggleShowSubAgents,
} from "../hooks/use-agents"
import { useAgentActions } from "../hooks/use-server"
import type { Agent } from "../lib/types"
import { pickDirectory } from "../services/backend"
import { loadProjectSessions } from "../services/connection-manager"
import { APP_BAR_HEIGHT, AppBar } from "./app-bar"
import { AppSidebarContent } from "./sidebar"
import { useSidebarSlot } from "./sidebar-slot-context"
import { UpdateBanner } from "./update-banner"

// ============================================================
// Constants
// ============================================================

const isMac =
	typeof window !== "undefined" && "palot" in window && window.palot.platform === "darwin"
const isElectronEnv = typeof window !== "undefined" && "palot" in window

/** Pixel offset from the left edge where window controls (toggle + new session) start */
const WINDOW_CONTROLS_LEFT = isMac && isElectronEnv ? 93 : 8
/** Total width reserved for traffic lights + window control buttons */
const WINDOW_CONTROLS_INSET = isMac && isElectronEnv ? 160 : 72

// ============================================================
// WindowControls
// ============================================================

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

// ============================================================
// SidebarLayout
// ============================================================

export function SidebarLayout() {
	const navigate = useNavigate()
	const { content: slotContent, footer: slotFooter } = useSidebarSlot()

	// ---- Sidebar-specific data ----
	const agents = useAgents()
	const projects = useProjectList()
	const showSubAgents = useShowSubAgents()
	const toggleShowSubAgents = useToggleShowSubAgents()
	const setCommandPaletteOpen = useSetCommandPaletteOpen()
	const { renameSession, deleteSession } = useAgentActions()

	const visibleAgents = useMemo(() => {
		if (showSubAgents) return agents
		return agents.filter((agent) => !agent.parentId)
	}, [agents, showSubAgents])

	const subAgentCount = useMemo(() => agents.filter((a) => a.parentId).length, [agents])

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

	const handleAddProject = useCallback(async () => {
		const directory = await pickDirectory()
		if (!directory) return
		await loadProjectSessions(directory)
		navigate({ to: "/" })
	}, [navigate])

	return (
		<div
			className="relative flex h-screen text-foreground"
			style={
				{
					"--window-controls-inset": `${WINDOW_CONTROLS_INSET}px`,
				} as React.CSSProperties
			}
		>
			<SidebarProvider embedded defaultOpen={true}>
				<Sidebar collapsible="offcanvas" variant="sidebar">
					{/* Sidebar header -- reserves space to match the app bar height so
					 * sidebar content aligns with the main content area. Also clears
					 * the traffic lights + the absolutely-positioned toggle button. */}
					<SidebarHeader
						className="flex-row items-center gap-1 shrink-0"
						style={{
							height: APP_BAR_HEIGHT,
							// Make header draggable on Electron (acts as title bar above sidebar)
							// @ts-expect-error -- vendor-prefixed CSS property
							WebkitAppRegion: "drag",
						}}
					/>
					{slotContent ?? (
						<AppSidebarContent
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
					)}
					{/* Footer: false = hide, ReactNode = render it, null = let default handle it.
					 * When default sidebar is active, AppSidebarContent renders its own footer. */}
					{slotFooter !== false && slotFooter}
				</Sidebar>
				<SidebarInset>
					<UpdateBanner />
					<AppBar />
					{/* Flex-1 + min-h-0 wrapper: pages use h-full which would
					    resolve to 100% of SidebarInset, ignoring AppBar height.
					    This container takes remaining space after AppBar and
					    constrains page content correctly. */}
					<div data-slot="content-area" className="relative min-h-0 flex-1">
						<Outlet />
					</div>
				</SidebarInset>
				{/* Rendered last so it paints on top of the sidebar and app bar,
				    whose transition properties create stacking contexts. */}
				<WindowControls />
			</SidebarProvider>
		</div>
	)
}
