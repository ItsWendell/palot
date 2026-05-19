import { Input } from "@palot/ui/components/input"
import {
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarSeparator,
} from "@palot/ui/components/sidebar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@palot/ui/components/tooltip"
import { useNavigate, useParams } from "@tanstack/react-router"
import { useAtomValue } from "jotai"
import {
	BookOpenIcon,
	BotIcon,
	BrainIcon,
	CommandIcon,
	GraduationCapIcon,
	LayoutDashboardIcon,
	PlusIcon,
	SearchIcon,
	SettingsIcon,
	XIcon,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { activeServerConfigAtom } from "../atoms/connection"
import { automationsEnabledAtom } from "../atoms/feature-flags"
import { projectDisplayNamesAtom } from "../atoms/projects"
import type { Agent, SidebarProject } from "../lib/types"
import { CostTracker } from "./cost-tracker"
import { MultiAgentPanel } from "./multi-agent-panel"
import { ServerIndicator } from "./server-indicator"
import { ProjectFolder } from "./sidebar-project-folder"
import { SessionItem } from "./sidebar-session-item"

// ============================================================
// Constants
// ============================================================

/** How many recent sessions to show in the top-level "Recent" section */
const RECENT_COUNT = 5

// ============================================================
// Props
// ============================================================

interface AppSidebarContentProps {
	agents: Agent[]
	projects: SidebarProject[]
	onOpenCommandPalette: () => void
	onAddProject?: () => void
	onRenameSession?: (agent: Agent, title: string) => Promise<void>
	onDeleteSession?: (agent: Agent) => Promise<void>
	onForkSession?: (agent: Agent) => Promise<void>
	serverConnected: boolean
}

// ============================================================
// Main component
// ============================================================

/**
 * Default sidebar content: Active Now, Recent, Projects groups + Settings footer.
 * Rendered inside the `<Sidebar>` shell provided by `SidebarLayout`.
 */
export function AppSidebarContent({
	agents,
	projects,
	onOpenCommandPalette,
	onAddProject,
	onRenameSession,
	onDeleteSession,
	onForkSession,
	serverConnected,
}: AppSidebarContentProps) {
	const navigate = useNavigate()
	const routeParams = useParams({ strict: false }) as { sessionId?: string; projectSlug?: string }
	const selectedSessionId = routeParams.sessionId ?? null
	const selectedProjectSlug = routeParams.projectSlug ?? null
	const automationsEnabled = useAtomValue(automationsEnabledAtom)
	const activeServer = useAtomValue(activeServerConfigAtom)
	const isLocalServer = activeServer.type === "local"

	// --- Project search state ---
	const [projectSearch, setProjectSearch] = useState("")
	const [projectSearchActive, setProjectSearchActive] = useState(false)
	const projectSearchRef = useRef<HTMLInputElement>(null)
	const displayNames = useAtomValue(projectDisplayNamesAtom)

	// Auto-show search input when there are more than 5 projects
	const shouldAutoSearch = projects.length > 5
	const showSearchInput = shouldAutoSearch || projectSearchActive

	// Filter projects by search query (client-side, case-insensitive)
	// Also checks custom display name overrides
	const filteredProjects = useMemo(() => {
		if (!projectSearch.trim()) return projects
		const q = projectSearch.toLowerCase()
		return projects.filter((p) => {
			const label = (displayNames[p.directory] ?? p.name).toLowerCase()
			return label.includes(q) || p.directory.toLowerCase().includes(q)
		})
	}, [projects, projectSearch, displayNames])

	const toggleProjectSearch = useCallback(() => {
		setProjectSearchActive((prev) => {
			if (prev) {
				setProjectSearch("")
				return false
			}
			return true
		})
	}, [])

	// Auto-focus search input when activated
	useEffect(() => {
		if (projectSearchActive && projectSearchRef.current) {
			projectSearchRef.current.focus()
		}
	}, [projectSearchActive])

	// Derive sections — filter out sub-agents (parentId) from sidebar display
	const activeSessions = useMemo(
		() =>
			agents
				.filter(
					(a) =>
						!a.parentId &&
						(a.status === "running" || a.status === "waiting" || a.status === "failed"),
				)
				.sort((a, b) => b.createdAt - a.createdAt),
		[agents],
	)

	const activeIds = useMemo(() => new Set(activeSessions.map((a) => a.id)), [activeSessions])

	const recentSessions = useMemo(
		() =>
			agents
				.filter((a) => !a.parentId && !activeIds.has(a.id))
				.sort((a, b) => b.lastActiveAt - a.lastActiveAt)
				.slice(0, RECENT_COUNT),
		[agents, activeIds],
	)

	const hasContent = agents.length > 0 || projects.length > 0
	const showEmptyState = !hasContent

	return (
		<>
			{/* Scrollable content */}
			<SidebarContent>
				{/* Empty state */}
				{showEmptyState && (
					<div className="flex flex-1 items-center justify-center p-4">
						<div className="space-y-2 text-center">
							{!serverConnected ? (
								<>
									<p className="text-sm text-muted-foreground">Server offline</p>
									<p className="text-xs text-muted-foreground/60">
										Check your connection in Settings
									</p>
								</>
							) : (
								<>
									<p className="text-sm text-muted-foreground">No projects yet</p>
									<p className="text-xs text-muted-foreground/60">Add a project to get started</p>
								</>
							)}
						</div>
					</div>
				)}

			{/* New Session + Automations */}
			<SidebarGroup>
				<SidebarGroupContent>
					<SidebarMenu>
						<SidebarMenuItem>
							<SidebarMenuButton
								tooltip="New Session"
								onClick={() => navigate({ to: "/" })}
								className="text-muted-foreground"
							>
								<PlusIcon className="size-4" />
								<span>New Session</span>
							</SidebarMenuButton>
						</SidebarMenuItem>
						{automationsEnabled && isLocalServer && (
							<SidebarMenuItem>
								<SidebarMenuButton
									tooltip="Automations"
									onClick={() => navigate({ to: "/automations" })}
									className="text-muted-foreground"
								>
									<BotIcon className="size-4" />
									<span>Automations</span>
								</SidebarMenuButton>
							</SidebarMenuItem>
						)}
					</SidebarMenu>
				</SidebarGroupContent>
			</SidebarGroup>

				{/* Active Now */}
				{activeSessions.length > 0 && (
					<SidebarGroup>
						<SidebarGroupLabel>Active Now</SidebarGroupLabel>
						<SidebarGroupContent>
							<SidebarMenu>
							{activeSessions.map((agent) => (
								<SessionItem
									key={agent.id}
									agent={agent}
									isSelected={agent.id === selectedSessionId}
									onRename={onRenameSession}
									onDelete={onDeleteSession}
									onFork={onForkSession}
									showProject
								/>
							))}
							</SidebarMenu>
						</SidebarGroupContent>
					</SidebarGroup>
				)}

				{/* Hive Mind — sub-agent panel for the selected session */}
				{selectedSessionId && (
					<MultiAgentPanel parentSessionId={selectedSessionId} />
				)}

				{/* Projects */}
				{hasContent && activeSessions.length > 0 && (
					<SidebarSeparator className="bg-sidebar-border/5" />
				)}
				{hasContent && (
					<SidebarGroup>
						<SidebarGroupLabel>Projects</SidebarGroupLabel>
						{/* Action buttons row */}
						<div className="absolute top-3.5 right-3 flex max-w-[calc(100%-4rem)] items-center gap-0.5 overflow-hidden">
							{!shouldAutoSearch && (
							<Tooltip>
								<TooltipTrigger
									render={
										<button
											type="button"
											onClick={toggleProjectSearch}
											className={`text-sidebar-foreground ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex aspect-square w-5 items-center justify-center rounded-md p-0 transition-colors ${
												projectSearchActive
													? "bg-sidebar-accent text-sidebar-accent-foreground"
													: ""
											}`}
										/>
									}
								>
									{projectSearchActive ? (
										<XIcon className="size-4 shrink-0" />
									) : (
										<SearchIcon className="size-4 shrink-0" />
									)}
									<span className="sr-only">Search projects</span>
								</TooltipTrigger>
								<TooltipContent side="bottom">
									{projectSearchActive ? "Close search" : "Search projects"}
								</TooltipContent>
							</Tooltip>
						)}
							<Tooltip>
								<TooltipTrigger
									render={
										<button
											type="button"
											onClick={onOpenCommandPalette}
											className="text-sidebar-foreground ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex aspect-square w-5 shrink-0 items-center justify-center rounded-md p-0 transition-colors"
										/>
									}
								>
									<CommandIcon className="size-4 shrink-0" />
									<span className="sr-only">Command palette</span>
								</TooltipTrigger>
								<TooltipContent side="bottom">Command palette (&#8984;K)</TooltipContent>
							</Tooltip>
							{onAddProject && (
								<Tooltip>
									<TooltipTrigger
										render={
											<button
												type="button"
												onClick={onAddProject}
												className="text-sidebar-foreground ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex aspect-square w-5 shrink-0 items-center justify-center rounded-md p-0 transition-colors"
											/>
										}
									>
										<PlusIcon className="size-4 shrink-0" />
										<span className="sr-only">Add Project</span>
									</TooltipTrigger>
									<TooltipContent side="bottom">Add project</TooltipContent>
								</Tooltip>
							)}
						</div>

						{/* Inline project search — always visible when >5 projects, toggleable otherwise */}
						{showSearchInput && (
							<div className="px-2 pb-1">
								<Input
									ref={projectSearchRef}
									value={projectSearch}
									onChange={(e) => setProjectSearch(e.target.value)}
									onKeyDown={(e) => {
										if (e.key === "Escape") {
											toggleProjectSearch()
										}
									}}
									placeholder="Filter projects..."
									className="h-7 text-xs"
								/>
							</div>
						)}

						<SidebarGroupContent>
							<SidebarMenu>
							{filteredProjects.map((project) => (
								<ProjectFolder
									key={project.id}
									project={project}
									selectedSessionId={selectedSessionId}
									selectedProjectSlug={selectedProjectSlug}
									onRename={onRenameSession}
									onDelete={onDeleteSession}
									onFork={onForkSession}
								/>
							))}
								{projectSearch && filteredProjects.length === 0 && (
									<p className="px-2 py-1.5 text-xs text-muted-foreground/60">
										No projects match &ldquo;{projectSearch}&rdquo;
									</p>
								)}
							</SidebarMenu>
						</SidebarGroupContent>
					</SidebarGroup>
				)}

				{/* Recent */}
				{recentSessions.length > 0 && (
					<SidebarGroup>
						<SidebarGroupLabel>Recent</SidebarGroupLabel>
						<SidebarGroupContent>
							<SidebarMenu>
							{recentSessions.map((agent) => (
								<SessionItem
									key={agent.id}
									agent={agent}
									isSelected={agent.id === selectedSessionId}
									onRename={onRenameSession}
									onDelete={onDeleteSession}
									onFork={onForkSession}
									showProject
								/>
							))}
							</SidebarMenu>
						</SidebarGroupContent>
					</SidebarGroup>
				)}
			</SidebarContent>
			<SidebarFooter className="space-y-0 p-2">
				<ServerIndicator />
				<SidebarMenu>
					<CostTracker />
					<SidebarMenuItem>
						<SidebarMenuButton
							tooltip="Agent Library"
							onClick={() => navigate({ to: "/agents" })}
							className="text-muted-foreground"
						>
							<LayoutDashboardIcon className="size-4" />
							<span>Agents</span>
						</SidebarMenuButton>
					</SidebarMenuItem>
					<SidebarMenuItem>
						<SidebarMenuButton
							tooltip="Skills"
							onClick={() => navigate({ to: "/skills" })}
							className="text-muted-foreground"
						>
							<GraduationCapIcon className="size-4" />
							<span>Skills</span>
						</SidebarMenuButton>
					</SidebarMenuItem>
					<SidebarMenuItem>
						<SidebarMenuButton
							tooltip="Knowledge"
							onClick={() => navigate({ to: "/knowledge" })}
							className="text-muted-foreground"
						>
							<BookOpenIcon className="size-4" />
							<span>Knowledge</span>
						</SidebarMenuButton>
					</SidebarMenuItem>
					<SidebarMenuItem>
						<SidebarMenuButton
							tooltip="Brain"
							onClick={() => navigate({ to: "/brain" })}
							className="text-muted-foreground"
						>
							<BrainIcon className="size-4" />
							<span>Brain</span>
						</SidebarMenuButton>
					</SidebarMenuItem>
					<SidebarMenuItem>
						<SidebarMenuButton
							tooltip="Settings"
							onClick={() => navigate({ to: "/settings" })}
							className="text-muted-foreground"
						>
							<SettingsIcon className="size-4" />
							<span>Settings</span>
						</SidebarMenuButton>
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarFooter>
		</>
	)
}
