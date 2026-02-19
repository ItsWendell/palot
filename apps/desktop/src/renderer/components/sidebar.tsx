import { Collapsible, CollapsibleContent } from "@palot/ui/components/collapsible"
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "@palot/ui/components/context-menu"
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
	AlertCircleIcon,
	BotIcon,
	CheckCircle2Icon,
	ChevronDownIcon,
	ChevronRightIcon,
	CircleDotIcon,
	CommandIcon,
	GitForkIcon,
	Loader2Icon,
	PencilIcon,
	PlusIcon,
	SearchIcon,
	SettingsIcon,
	TimerIcon,
	TrashIcon,
	XIcon,
} from "lucide-react"
import { memo, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react"
import { activeServerConfigAtom } from "../atoms/connection"
import { agentFamily, projectSessionIdsFamily, sandboxMappingsAtom } from "../atoms/derived/agents"
import { automationsEnabledAtom } from "../atoms/feature-flags"
import { projectPaginationFamily } from "../atoms/sessions"
import { appStore } from "../atoms/store"
import type { Agent, AgentStatus, SidebarProject } from "../lib/types"
import { loadMoreProjectSessions, loadProjectSessions } from "../services/connection-manager"
import { ServerIndicator } from "./server-indicator"

// ============================================================
// Constants
// ============================================================

/** How many recent sessions to show in the top-level "Recent" section */
const RECENT_COUNT = 5

const STATUS_ICON: Record<AgentStatus, typeof Loader2Icon> = {
	running: Loader2Icon,
	waiting: TimerIcon,
	paused: CircleDotIcon,
	completed: CheckCircle2Icon,
	failed: AlertCircleIcon,
	idle: CircleDotIcon,
}

const STATUS_COLOR: Record<AgentStatus, string> = {
	running: "text-green-500",
	waiting: "text-yellow-500",
	paused: "text-muted-foreground",
	completed: "text-muted-foreground",
	failed: "text-red-500",
	idle: "text-muted-foreground",
}

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
	const routeParams = useParams({ strict: false }) as { sessionId?: string }
	const selectedSessionId = routeParams.sessionId ?? null
	const automationsEnabled = useAtomValue(automationsEnabledAtom)
	const activeServer = useAtomValue(activeServerConfigAtom)
	const isLocalServer = activeServer.type === "local"

	// --- Project search state ---
	const [projectSearch, setProjectSearch] = useState("")
	const [projectSearchActive, setProjectSearchActive] = useState(false)
	const projectSearchRef = useRef<HTMLInputElement>(null)

	// Filter projects by search query (client-side, case-insensitive)
	const filteredProjects = useMemo(() => {
		if (!projectSearch.trim()) return projects
		const q = projectSearch.toLowerCase()
		return projects.filter(
			(p) => p.name.toLowerCase().includes(q) || p.directory.toLowerCase().includes(q),
		)
	}, [projects, projectSearch])

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
			<SidebarContent className="[-webkit-app-region:no-drag]">
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

				{/* Automations */}
				{automationsEnabled && isLocalServer && (
					<SidebarGroup>
						<SidebarGroupContent>
							<SidebarMenu>
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
							</SidebarMenu>
						</SidebarGroupContent>
					</SidebarGroup>
				)}

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

				{/* Projects */}
				{hasContent && (activeSessions.length > 0 || recentSessions.length > 0) && (
					<SidebarSeparator className="bg-sidebar-border/5" />
				)}
				{hasContent && (
					<SidebarGroup>
						<SidebarGroupLabel>Projects</SidebarGroupLabel>
						{/* Action buttons row */}
						<div className="absolute top-3.5 right-3 flex max-w-[calc(100%-4rem)] items-center gap-0.5 overflow-hidden">
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

						{/* Inline project search */}
						{projectSearchActive && (
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
			</SidebarContent>
			<SidebarFooter className="space-y-0 p-2">
				<ServerIndicator />
				<SidebarMenu>
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

// ============================================================
// Sub-components
// ============================================================

/**
 * Wrapper that subscribes to a single agent via agentFamily and renders
 * a SessionItem. Used by ProjectFolder so each item only re-renders
 * when its own agent changes, not when any agent in the project changes.
 */
const ProjectSessionItem = memo(function ProjectSessionItem({
	sessionId,
	selectedSessionId,
	onRename,
	onDelete,
	onFork,
}: {
	sessionId: string
	selectedSessionId: string | null
	onRename?: (agent: Agent, title: string) => Promise<void>
	onDelete?: (agent: Agent) => Promise<void>
	onFork?: (agent: Agent) => Promise<void>
}) {
	const agent = useAtomValue(agentFamily(sessionId))
	if (!agent) return null
	return (
		<SessionItem
			agent={agent}
			isSelected={agent.id === selectedSessionId}
			onRename={onRename}
			onDelete={onDelete}
			onFork={onFork}
			compact
		/>
	)
})

/**
 * A project folder in the sidebar that lists its sessions as a flat list.
 * Sessions are loaded lazily on first expand from the server.
 * Shows a "Load more" button that fetches additional sessions.
 */
const ProjectFolder = memo(function ProjectFolder({
	project,
	selectedSessionId,
	onRename,
	onDelete,
	onFork,
}: {
	project: SidebarProject
	selectedSessionId: string | null
	onRename?: (agent: Agent, title: string) => Promise<void>
	onDelete?: (agent: Agent) => Promise<void>
	onFork?: (agent: Agent) => Promise<void>
}) {
	const navigate = useNavigate()
	const [expanded, setExpanded] = useState(false)

	// Subscribe to just this project's session IDs
	const sessionIds = useAtomValue(projectSessionIdsFamily(project.directory))

	// Per-project pagination state from the server
	const pagination = useAtomValue(projectPaginationFamily(project.directory))

	// Load sessions on first expand
	useEffect(() => {
		if (!expanded || pagination.loaded || pagination.loading) return

		// Look up sandbox dirs for this project from the discovery data
		const { parentToSandboxes } = appStore.get(sandboxMappingsAtom)
		const sandboxDirs = parentToSandboxes.get(project.directory)

		loadProjectSessions(project.directory, sandboxDirs?.size ? sandboxDirs : undefined, {
			limit: 5,
			roots: true,
		})
	}, [expanded, pagination.loaded, pagination.loading, project.directory])

	// Read agents non-reactively (via appStore.get) for sorting.
	// Individual items render reactively via ProjectSessionItem -> agentFamily.
	const projectSessions = useMemo(() => {
		const agents: Agent[] = []
		for (const id of sessionIds) {
			const agent = appStore.get(agentFamily(id))
			if (agent) agents.push(agent)
		}
		return agents.sort((a, b) => {
			// Active sessions float to top
			const aActive = a.status === "running" || a.status === "waiting" || a.status === "failed"
			const bActive = b.status === "running" || b.status === "waiting" || b.status === "failed"
			if (aActive !== bActive) return aActive ? -1 : 1
			// Within same group, sort by lastActiveAt (matches server's time_updated DESC)
			return b.lastActiveAt - a.lastActiveAt
		})
	}, [sessionIds])

	const handleLoadMore = useCallback(() => {
		loadMoreProjectSessions(project.directory, pagination.currentLimit)
	}, [project.directory, pagination.currentLimit])

	// Show loading state when initial fetch or load-more is in progress
	const isInitialLoading = expanded && !pagination.loaded && !pagination.loading
	const isLoading = pagination.loading || isInitialLoading

	return (
		<SidebarMenuItem>
			<Collapsible open={expanded} onOpenChange={setExpanded}>
				<SidebarMenuButton
					tooltip={project.name}
					onClick={() => {
						setExpanded(!expanded)
						navigate({
							to: "/project/$projectSlug",
							params: { projectSlug: project.slug },
						})
					}}
				>
					<ChevronRightIcon
						className="size-3 shrink-0 text-muted-foreground transition-transform duration-150 ease-out"
						style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}
					/>
					<span className="truncate font-medium">{project.name}</span>
				</SidebarMenuButton>

				<CollapsibleContent
					keepMounted
					className="flex h-[var(--collapsible-panel-height)] flex-col overflow-hidden transition-[height] duration-200 ease-out data-[ending-style]:h-0 data-[starting-style]:h-0 [&[hidden]:not([hidden='until-found'])]:hidden"
				>
					<div className="ml-3 border-l border-sidebar-border/5 pl-1">
						{isLoading && projectSessions.length === 0 ? (
							<p className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-muted-foreground/60">
								<Loader2Icon className="size-3 animate-spin" />
								Loading sessions...
							</p>
						) : pagination.loaded && projectSessions.length === 0 ? (
							<p className="px-2 py-1.5 text-xs text-muted-foreground/60">No sessions yet</p>
						) : (
							<SidebarMenu>
							{projectSessions.map((agent) => (
								<ProjectSessionItem
									key={agent.id}
									sessionId={agent.id}
									selectedSessionId={selectedSessionId}
									onRename={onRename}
									onDelete={onDelete}
									onFork={onFork}
								/>
							))}
								{pagination.loaded && pagination.hasMore && (
									<button
										type="button"
										onClick={handleLoadMore}
										disabled={pagination.loading}
										className="w-full cursor-pointer px-2 py-1 text-left text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:cursor-default disabled:opacity-50"
									>
										{pagination.loading ? (
											<span className="flex items-center gap-1">
												<Loader2Icon className="size-3 animate-spin" />
												Loading...
											</span>
										) : (
											<span className="flex items-center gap-1">
												<ChevronDownIcon className="size-3" />
												Load more sessions
											</span>
										)}
									</button>
								)}
							</SidebarMenu>
						)}
					</div>
				</CollapsibleContent>
			</Collapsible>
		</SidebarMenuItem>
	)
})

// ============================================================
// Session item
// ============================================================

/**
 * Hook that returns a live-updating relative "last active" time string.
 * For active (running/waiting) sessions, ticks every minute.
 * For idle/completed sessions, returns the static duration from the agent atom.
 */
function useLiveLastActive(agent: Agent): string {
	const isActive = agent.status === "running" || agent.status === "waiting"

	const [display, setDisplay] = useState(agent.duration)

	useEffect(() => {
		if (!isActive) {
			setDisplay(agent.duration)
			return
		}

		// Active sessions: show "now" and tick every 60s to stay fresh
		setDisplay("now")
		const id = setInterval(() => setDisplay("now"), 60_000)
		return () => clearInterval(id)
	}, [isActive, agent.duration])

	return display
}

const SessionItem = memo(function SessionItem({
	agent,
	isSelected,
	onRename,
	onDelete,
	onFork,
	showProject = false,
	compact = false,
}: {
	agent: Agent
	isSelected: boolean
	onRename?: (agent: Agent, title: string) => Promise<void>
	onDelete?: (agent: Agent) => Promise<void>
	onFork?: (agent: Agent) => Promise<void>
	showProject?: boolean
	compact?: boolean
}) {
	const navigate = useNavigate()
	const [, startTransition] = useTransition()
	const StatusIcon = STATUS_ICON[agent.status]
	const statusColor = STATUS_COLOR[agent.status]
	const isWorktree = !!agent.worktreePath
	const lastActive = useLiveLastActive(agent)

	const [isEditing, setIsEditing] = useState(false)
	const [editValue, setEditValue] = useState(agent.name)
	const inputRef = useRef<HTMLInputElement>(null)

	const onSelect = useCallback(() => {
		startTransition(() => {
			navigate({
				to: "/project/$projectSlug/session/$sessionId",
				params: { projectSlug: agent.projectSlug, sessionId: agent.id },
			})
		})
	}, [navigate, agent.projectSlug, agent.id])

	const startEditing = useCallback(() => {
		setEditValue(agent.name)
		setIsEditing(true)
	}, [agent.name])

	const confirmRename = useCallback(async () => {
		const trimmed = editValue.trim()
		setIsEditing(false)
		if (trimmed && trimmed !== agent.name && onRename) {
			await onRename(agent, trimmed)
		}
	}, [editValue, agent, onRename])

	const cancelEditing = useCallback(() => {
		setIsEditing(false)
		setEditValue(agent.name)
	}, [agent.name])

	const handleRenameMenuClick = useCallback(
		(e: React.MouseEvent) => {
			e.preventDefault()
			e.stopPropagation()
			startEditing()
		},
		[startEditing],
	)

	const handleForkMenuClick = useCallback(
		(e: React.MouseEvent) => {
			e.preventDefault()
			e.stopPropagation()
			void onFork?.(agent)
		},
		[onFork, agent],
	)

	const handleDeleteMenuClick = useCallback(
		(e: React.MouseEvent) => {
			e.preventDefault()
			e.stopPropagation()
			void onDelete?.(agent)
		},
		[onDelete, agent],
	)

	useEffect(() => {
		if (isEditing && inputRef.current) {
			inputRef.current.focus()
			inputRef.current.select()
		}
	}, [isEditing])

	const tooltipLabel = showProject ? agent.project : agent.name

	const btn = (
		<SidebarMenuItem>
			<SidebarMenuButton
				isActive={isSelected}
				tooltip={tooltipLabel}
				size={compact ? "sm" : "default"}
				onClick={isEditing ? undefined : onSelect}
			>
				{isWorktree ? (
					<GitForkIcon
						className={`shrink-0 ${statusColor} ${agent.status === "running" ? "animate-pulse" : ""}`}
					/>
				) : (
					<StatusIcon
						className={`shrink-0 ${statusColor} ${agent.status === "running" ? "animate-spin" : ""}`}
					/>
				)}

				{isEditing ? (
					<Input
						ref={inputRef}
						value={editValue}
						onChange={(e) => setEditValue(e.target.value)}
						onKeyDown={(e) => {
							e.stopPropagation()
							if (e.key === "Enter") confirmRename()
							if (e.key === "Escape") cancelEditing()
						}}
						onBlur={confirmRename}
						onClick={(e) => e.stopPropagation()}
						className={`h-auto min-w-0 flex-1 border-none bg-transparent p-0 shadow-none focus-visible:ring-0 ${compact ? "text-xs" : "text-[13px]"}`}
					/>
				) : (
					<div className="min-w-0 flex-1">
						<span className={`block truncate leading-tight ${compact ? "text-xs" : "text-[13px]"}`}>
							{agent.name}
						</span>

						{agent.status === "waiting" && agent.currentActivity && (
							<span className="block truncate text-[11px] leading-tight text-yellow-500">
								{agent.currentActivity}
							</span>
						)}
					</div>
				)}

				{!isEditing && (
					<span className="shrink-0 text-xs tabular-nums text-muted-foreground">{lastActive}</span>
				)}
			</SidebarMenuButton>
		</SidebarMenuItem>
	)

	return (
		<ContextMenu>
			<ContextMenuTrigger render={btn} />
			<ContextMenuContent>
				{onRename && (
					<ContextMenuItem
						onClick={handleRenameMenuClick}
						className="hover:bg-secondary hover:text-secondary-foreground data-[highlighted]:bg-secondary data-[highlighted]:text-secondary-foreground"
					>
						<PencilIcon className="size-4" />
						Rename
					</ContextMenuItem>
				)}
				{onFork && (
					<ContextMenuItem
						onClick={handleForkMenuClick}
						className="hover:bg-secondary hover:text-secondary-foreground data-[highlighted]:bg-secondary data-[highlighted]:text-secondary-foreground"
					>
						<GitForkIcon className="size-4" />
						Fork
					</ContextMenuItem>
				)}
				{(onRename || onFork) && onDelete && <ContextMenuSeparator />}
				{onDelete && (
					<ContextMenuItem variant="destructive" onClick={handleDeleteMenuClick}>
						<TrashIcon className="size-4" />
						Delete
					</ContextMenuItem>
				)}
			</ContextMenuContent>
		</ContextMenu>
	)
})
