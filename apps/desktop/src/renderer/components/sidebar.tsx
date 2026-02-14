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
	CheckCircle2Icon,
	ChevronRightIcon,
	CircleDotIcon,
	GitBranchIcon,
	GitForkIcon,
	Loader2Icon,
	NetworkIcon,
	PencilIcon,
	PlusIcon,
	SearchIcon,
	SettingsIcon,
	TimerIcon,
	TrashIcon,
} from "lucide-react"
import { memo, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react"
import { agentFamily, projectSessionIdsFamily } from "../atoms/derived/agents"
import { appStore } from "../atoms/store"
import type { Agent, AgentStatus, SidebarProject } from "../lib/types"

// ============================================================
// Constants
// ============================================================

/** How many sessions to show per project before "Show more" */
const SESSIONS_PER_PROJECT = 3

/** How many recent sessions to show */
const RECENT_COUNT = 5

/** How many sessions to show per time group before progressive "load more" */
const SESSIONS_PER_GROUP_PAGE = 10

/** Time bucket labels in display order */
type TimeBucket = "today" | "thisWeek" | "thisMonth" | "older"

const TIME_BUCKET_LABELS: Record<TimeBucket, string> = {
	today: "Today",
	thisWeek: "This Week",
	thisMonth: "This Month",
	older: "Older",
}

/** All buckets in display order */
const TIME_BUCKET_ORDER: TimeBucket[] = ["today", "thisWeek", "thisMonth", "older"]

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
// Time bucketing
// ============================================================

interface TimeBucketGroup {
	bucket: TimeBucket
	label: string
	sessions: Agent[]
}

/**
 * Partition a sorted session list into time-based groups.
 * Sessions are assumed to be pre-sorted (active first, then by createdAt desc).
 * Only non-empty buckets are returned.
 */
function groupByTimeBucket(sessions: Agent[]): TimeBucketGroup[] {
	const now = new Date()
	const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()

	// Start of this week (Monday)
	const dayOfWeek = now.getDay()
	const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1
	const weekStart = new Date(
		now.getFullYear(),
		now.getMonth(),
		now.getDate() - mondayOffset,
	).getTime()

	const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime()

	const buckets: Record<TimeBucket, Agent[]> = {
		today: [],
		thisWeek: [],
		thisMonth: [],
		older: [],
	}

	for (const session of sessions) {
		const t = session.createdAt
		if (t >= todayStart) {
			buckets.today.push(session)
		} else if (t >= weekStart) {
			buckets.thisWeek.push(session)
		} else if (t >= monthStart) {
			buckets.thisMonth.push(session)
		} else {
			buckets.older.push(session)
		}
	}

	// Only return non-empty groups
	return TIME_BUCKET_ORDER.filter((b) => buckets[b].length > 0).map((b) => ({
		bucket: b,
		label: TIME_BUCKET_LABELS[b],
		sessions: buckets[b],
	}))
}

// ============================================================
// Props
// ============================================================

interface AppSidebarContentProps {
	agents: Agent[]
	projects: SidebarProject[]
	onOpenCommandPalette: () => void
	onAddProject?: () => void
	showSubAgents: boolean
	subAgentCount: number
	onToggleSubAgents: () => void
	onRenameSession?: (agent: Agent, title: string) => Promise<void>
	onDeleteSession?: (agent: Agent) => Promise<void>
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
	showSubAgents,
	subAgentCount,
	onToggleSubAgents,
	onRenameSession,
	onDeleteSession,
}: AppSidebarContentProps) {
	const navigate = useNavigate()
	const routeParams = useParams({ strict: false }) as { sessionId?: string }
	const selectedSessionId = routeParams.sessionId ?? null

	// Derive sections
	const activeSessions = useMemo(
		() =>
			agents
				.filter((a) => a.status === "running" || a.status === "waiting" || a.status === "failed")
				.sort((a, b) => b.createdAt - a.createdAt), // createdAt for stable order during parallel work
		[agents],
	)

	const activeIds = useMemo(() => new Set(activeSessions.map((a) => a.id)), [activeSessions])

	const recentSessions = useMemo(
		() =>
			agents
				.filter((a) => !activeIds.has(a.id))
				.sort((a, b) => b.lastActiveAt - a.lastActiveAt)
				.slice(0, RECENT_COUNT),
		[agents, activeIds],
	)

	return (
		<>
			{/* Scrollable content */}
			<SidebarContent>
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
										showProject
									/>
								))}
							</SidebarMenu>
						</SidebarGroupContent>
					</SidebarGroup>
				)}

				{/* Projects -- always render so search/sub-agent actions are accessible */}
				{(activeSessions.length > 0 || recentSessions.length > 0) && (
					<SidebarSeparator className="bg-sidebar-border/5" />
				)}
				<SidebarGroup>
					<SidebarGroupLabel>Projects</SidebarGroupLabel>
					{/* Action buttons row -- positioned like SidebarGroupAction but holds multiple icons */}
					<div className="absolute top-3.5 right-3 flex items-center gap-0.5">
						{subAgentCount > 0 && (
							<Tooltip>
								<TooltipTrigger
									render={
										<button
											type="button"
											onClick={onToggleSubAgents}
											className={`inline-flex items-center gap-0.5 rounded-md px-1 py-0.5 text-[10px] transition-colors ${
												showSubAgents
													? "bg-sidebar-accent text-sidebar-accent-foreground"
													: "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
											}`}
										/>
									}
								>
									<NetworkIcon className="size-3.5" />
									<span>{subAgentCount}</span>
								</TooltipTrigger>
								<TooltipContent side="bottom">
									{showSubAgents ? "Hide" : "Show"} sub-agents ({subAgentCount})
								</TooltipContent>
							</Tooltip>
						)}
						<Tooltip>
							<TooltipTrigger
								render={
									<button
										type="button"
										onClick={onOpenCommandPalette}
										className="text-sidebar-foreground ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex aspect-square w-5 items-center justify-center rounded-md p-0 transition-colors"
									/>
								}
							>
								<SearchIcon className="size-4 shrink-0" />
								<span className="sr-only">Search sessions</span>
							</TooltipTrigger>
							<TooltipContent side="bottom">Search sessions (&#8984;K)</TooltipContent>
						</Tooltip>
						{onAddProject && (
							<Tooltip>
								<TooltipTrigger
									render={
										<button
											type="button"
											onClick={onAddProject}
											className="text-sidebar-foreground ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex aspect-square w-5 items-center justify-center rounded-md p-0 transition-colors"
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
					<SidebarGroupContent>
						<SidebarMenu>
							{projects.map((project) => (
								<ProjectFolder
									key={project.id}
									project={project}
									selectedSessionId={selectedSessionId}
									onRename={onRenameSession}
									onDelete={onDeleteSession}
								/>
							))}
						</SidebarMenu>
					</SidebarGroupContent>
				</SidebarGroup>
			</SidebarContent>
			<SidebarFooter className="p-2">
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
			{agents.length === 0 && projects.length === 0 && (
				<div className="flex flex-1 items-center justify-center p-4">
					<div className="space-y-2 text-center">
						<p className="text-sm text-muted-foreground">No sessions yet</p>
						<p className="text-xs text-muted-foreground/60">
							Start an OpenCode server to see your projects
						</p>
					</div>
				</div>
			)}
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
}: {
	sessionId: string
	selectedSessionId: string | null
	onRename?: (agent: Agent, title: string) => Promise<void>
	onDelete?: (agent: Agent) => Promise<void>
}) {
	const agent = useAtomValue(agentFamily(sessionId))
	if (!agent) return null
	return (
		<SessionItem
			agent={agent}
			isSelected={agent.id === selectedSessionId}
			onRename={onRename}
			onDelete={onDelete}
			compact
		/>
	)
})

const ProjectFolder = memo(function ProjectFolder({
	project,
	selectedSessionId,
	onRename,
	onDelete,
}: {
	project: SidebarProject
	selectedSessionId: string | null
	onRename?: (agent: Agent, title: string) => Promise<void>
	onDelete?: (agent: Agent) => Promise<void>
}) {
	const navigate = useNavigate()
	const [expanded, setExpanded] = useState(false)

	// Subscribe to just this project's session IDs. Other projects
	// adding/removing sessions won't cause this component to re-render.
	const sessionIds = useAtomValue(projectSessionIdsFamily(project.directory))

	// Read agents non-reactively (via appStore.get) for sorting and time bucketing.
	// Individual items render reactively via ProjectSessionItem -> agentFamily.
	// This means sort order updates when sessionIds changes (new/removed sessions)
	// or when the component re-renders for other reasons. Status changes within
	// a session are reflected in the SessionItem itself, not in the sort order
	// (which is acceptable since active sessions already float to top via the
	// Active Now section above).
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
			// Within same group, sort by createdAt for stable order
			return b.createdAt - a.createdAt
		})
	}, [sessionIds])

	const timeGroups = useMemo(() => groupByTimeBucket(projectSessions), [projectSessions])

	// When there are few enough sessions, skip time grouping entirely
	const useFlat = projectSessions.length <= SESSIONS_PER_PROJECT

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
						{projectSessions.length === 0 ? (
							<p className="px-2 py-1.5 text-xs text-muted-foreground/60">No sessions yet</p>
						) : useFlat ? (
							/* Few sessions: flat list, no time headers */
							<SidebarMenu>
								{projectSessions.map((agent) => (
									<ProjectSessionItem
										key={agent.id}
										sessionId={agent.id}
										selectedSessionId={selectedSessionId}
										onRename={onRename}
										onDelete={onDelete}
									/>
								))}
							</SidebarMenu>
						) : (
							/* Many sessions: time-grouped with progressive pagination */
							<div className="flex flex-col">
								{timeGroups.map((group, idx) => (
									<SessionTimeGroup
										key={group.bucket}
										group={group}
										selectedSessionId={selectedSessionId}
										onRename={onRename}
										onDelete={onDelete}
										defaultExpanded={idx === 0}
									/>
								))}
							</div>
						)}
					</div>
				</CollapsibleContent>
			</Collapsible>
		</SidebarMenuItem>
	)
})

/**
 * A collapsible time-bucket group within a project folder.
 * First group ("Today") is expanded by default; others are collapsed.
 * Uses progressive pagination so only N sessions render at a time.
 */
const SessionTimeGroup = memo(function SessionTimeGroup({
	group,
	selectedSessionId,
	onRename,
	onDelete,
	defaultExpanded,
}: {
	group: TimeBucketGroup
	selectedSessionId: string | null
	onRename?: (agent: Agent, title: string) => Promise<void>
	onDelete?: (agent: Agent) => Promise<void>
	defaultExpanded: boolean
}) {
	const [expanded, setExpanded] = useState(defaultExpanded)
	const [visibleCount, setVisibleCount] = useState(SESSIONS_PER_GROUP_PAGE)

	const visibleSessions = group.sessions.slice(0, visibleCount)
	const remaining = group.sessions.length - visibleCount

	const showMore = useCallback(() => {
		setVisibleCount((prev) => prev + SESSIONS_PER_GROUP_PAGE)
	}, [])

	return (
		<Collapsible open={expanded} onOpenChange={setExpanded}>
			<button
				type="button"
				onClick={() => setExpanded(!expanded)}
				className="flex w-full cursor-pointer items-center gap-1 px-2 py-1 text-left"
			>
				<ChevronRightIcon
					className="size-2.5 shrink-0 text-muted-foreground/60 transition-transform duration-150 ease-out"
					style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}
				/>
				<span className="text-[11px] font-medium text-muted-foreground/60">{group.label}</span>
				<span className="text-[10px] tabular-nums text-muted-foreground/40">
					{group.sessions.length}
				</span>
			</button>
			<CollapsibleContent className="flex h-[var(--collapsible-panel-height)] flex-col overflow-hidden transition-[height] duration-150 ease-out data-[ending-style]:h-0 data-[starting-style]:h-0 [&[hidden]:not([hidden='until-found'])]:hidden">
				<SidebarMenu>
					{visibleSessions.map((agent) => (
						<SessionItem
							key={agent.id}
							agent={agent}
							isSelected={agent.id === selectedSessionId}
							onRename={onRename}
							onDelete={onDelete}
							compact
						/>
					))}
					{remaining > 0 && (
						<button
							type="button"
							onClick={showMore}
							className="w-full cursor-pointer px-2 py-1 text-left text-[11px] text-muted-foreground transition-colors hover:text-foreground"
						>
							Show {Math.min(remaining, SESSIONS_PER_GROUP_PAGE)} more
							{remaining > SESSIONS_PER_GROUP_PAGE && ` of ${remaining}`}...
						</button>
					)}
				</SidebarMenu>
			</CollapsibleContent>
		</Collapsible>
	)
})

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
	showProject = false,
	compact = false,
}: {
	agent: Agent
	isSelected: boolean
	onRename?: (agent: Agent, title: string) => Promise<void>
	onDelete?: (agent: Agent) => Promise<void>
	showProject?: boolean
	compact?: boolean
}) {
	const navigate = useNavigate()
	const [, startTransition] = useTransition()
	const StatusIcon = STATUS_ICON[agent.status]
	const statusColor = STATUS_COLOR[agent.status]
	const isSubAgent = !!agent.parentId
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
				{isSubAgent ? (
					<GitBranchIcon className={`shrink-0 ${statusColor}`} />
				) : isWorktree ? (
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
					<ContextMenuItem onSelect={startEditing}>
						<PencilIcon className="size-4" />
						Rename
					</ContextMenuItem>
				)}
				{onRename && onDelete && <ContextMenuSeparator />}
				{onDelete && (
					<ContextMenuItem variant="destructive" onSelect={() => onDelete(agent)}>
						<TrashIcon className="size-4" />
						Delete
					</ContextMenuItem>
				)}
			</ContextMenuContent>
		</ContextMenu>
	)
})
