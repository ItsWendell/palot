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
import { useAtomValue } from "jotai"
import { PanelLeftIcon, PlusIcon } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { activeServerConfigAtom, serverConnectedAtom } from "../atoms/connection"
import { useAgents, useProjectList, useSetCommandPaletteOpen } from "../hooks/use-agents"
import { useAgentActions } from "../hooks/use-server"
import type { Agent } from "../lib/types"
import { AddProjectDialog } from "./add-project-dialog"
import { AddProjectModal } from "./add-project-modal"
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
// NarrowWindowCollapser
// ============================================================

/**
 * Watches the window width and auto-collapses the sidebar when it drops below
 * COLLAPSE_THRESHOLD px, restoring it when the window grows back above the threshold.
 * Must be rendered inside a <SidebarProvider>.
 */
const COLLAPSE_THRESHOLD = 600

function NarrowWindowCollapser() {
	const { open, setOpen } = useSidebar()
	// Track whether the last collapse was triggered by us (vs. the user manually toggling)
	const collapsedByUsRef = useRef(false)

	useEffect(() => {
		const check = () => {
			const narrow = window.innerWidth < COLLAPSE_THRESHOLD
			if (narrow && open) {
				collapsedByUsRef.current = true
				setOpen(false)
			} else if (!narrow && !open && collapsedByUsRef.current) {
				// Only re-open if WE collapsed it — don't override the user's manual close
				collapsedByUsRef.current = false
				setOpen(true)
			} else if (!narrow) {
				// Window grew back — reset the flag regardless so we don't re-open unexpectedly
				if (!open) collapsedByUsRef.current = false
			}
		}

		check()
		window.addEventListener("resize", check)
		return () => window.removeEventListener("resize", check)
	}, [open, setOpen])

	return null
}

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
				<TooltipTrigger
					render={
						<Button
							variant="ghost"
							size="icon"
							className="size-7 shrink-0"
							onClick={toggleSidebar}
						/>
					}
				>
					<PanelLeftIcon className="size-3.5" />
				</TooltipTrigger>
				<TooltipContent>Toggle sidebar (&#8984;B)</TooltipContent>
			</Tooltip>
			<Tooltip>
				<TooltipTrigger
					render={
						<Button
							variant="ghost"
							size="icon"
							className="size-7 shrink-0"
							onClick={() => navigate({ to: "/" })}
						/>
					}
				>
					<PlusIcon className="size-3.5" />
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
	const setCommandPaletteOpen = useSetCommandPaletteOpen()
	const { renameSession, deleteSession, forkSession } = useAgentActions()
	const serverConnected = useAtomValue(serverConnectedAtom)

	// Sub-agents are filtered at the API level (roots: true)
	const visibleAgents = agents

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

	const handleForkSession = useCallback(
		async (agent: Agent) => {
			const forked = await forkSession(agent.directory, agent.sessionId)
			if (forked) {
				navigate({
					to: "/project/$projectSlug/session/$sessionId",
					params: { projectSlug: agent.projectSlug, sessionId: forked.id },
				})
			}
		},
		[forkSession, navigate],
	)

	const handleOpenCommandPalette = useCallback(() => {
		setCommandPaletteOpen(true)
	}, [setCommandPaletteOpen])

	// Add project: local servers use custom modal, remote servers use a dialog
	const activeServer = useAtomValue(activeServerConfigAtom)
	const [addProjectOpen, setAddProjectOpen] = useState(false)
	const [addProjectModalOpen, setAddProjectModalOpen] = useState(false)

	const handleAddProject = useCallback(() => {
		if (activeServer.type === "local") {
			setAddProjectModalOpen(true)
		} else {
			setAddProjectOpen(true)
		}
	}, [activeServer.type])

	const handleProjectAdded = useCallback(
		(_directory: string) => {
			navigate({ to: "/" })
		},
		[navigate],
	)

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
				<NarrowWindowCollapser />
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
						onOpenCommandPalette={handleOpenCommandPalette}
						onAddProject={handleAddProject}
						onRenameSession={handleRenameSession}
						onDeleteSession={handleDeleteSession}
						onForkSession={handleForkSession}
						serverConnected={serverConnected}
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
					<div data-slot="content-area" className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
						<Outlet />
					</div>
				</SidebarInset>
				{/* Rendered last so it paints on top of the sidebar and app bar,
				    whose transition properties create stacking contexts. */}
				<WindowControls />
			</SidebarProvider>
			<AddProjectDialog
				open={addProjectOpen}
				onOpenChange={setAddProjectOpen}
				onAdded={handleProjectAdded}
			/>
			<AddProjectModal
				open={addProjectModalOpen}
				onOpenChange={setAddProjectModalOpen}
			/>
		</div>
	)
}
