import { Badge } from "@codedeck/ui/components/badge"
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "@codedeck/ui/components/context-menu"
import { Input } from "@codedeck/ui/components/input"
import {
	Sidebar,
	SidebarContent,
	SidebarGroup,
	SidebarGroupAction,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarSeparator,
} from "@codedeck/ui/components/sidebar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@codedeck/ui/components/tooltip"
import { useNavigate, useParams } from "@tanstack/react-router"
import {
	AlertCircleIcon,
	CheckCircle2Icon,
	ChevronDownIcon,
	CircleDotIcon,
	FolderIcon,
	GitBranchIcon,
	Loader2Icon,
	NetworkIcon,
	PencilIcon,
	PlusIcon,
	SearchIcon,
	TimerIcon,
	TrashIcon,
} from "lucide-react"
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { formatElapsed } from "../hooks/use-agents"
import type { Agent, AgentStatus, SidebarProject } from "../lib/types"

// ============================================================
// Constants
// ============================================================

/** How many sessions to show per project before "Show more" */
const SESSIONS_PER_PROJECT = 3

/** How many recent sessions to show */
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

interface AppSidebarProps {
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

export function AppSidebar({
	agents,
	projects,
	onOpenCommandPalette,
	onAddProject,
	showSubAgents,
	subAgentCount,
	onToggleSubAgents,
	onRenameSession,
	onDeleteSession,
}: AppSidebarProps) {
	const navigate = useNavigate()
	const routeParams = useParams({ strict: false }) as { sessionId?: string }
	const selectedSessionId = routeParams.sessionId ?? null

	// Derive sections
	const activeSessions = useMemo(
		() =>
			agents
				.filter((a) => a.status === "running" || a.status === "waiting" || a.status === "failed")
				.sort((a, b) => b.createdAt - a.createdAt),
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
		<Sidebar collapsible="offcanvas">
			{/* Sidebar header — compact row with title and quick actions */}
			<div className="flex h-11 shrink-0 items-center justify-between border-b border-sidebar-border px-3">
				<h1 className="text-sm font-semibold tracking-tight">Codedeck</h1>
				<div className="flex items-center gap-1">
					{subAgentCount > 0 && (
						<Tooltip>
							<TooltipTrigger asChild>
								<button
									type="button"
									onClick={onToggleSubAgents}
									className={`inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs transition-colors ${
										showSubAgents
											? "bg-accent text-accent-foreground"
											: "text-muted-foreground hover:bg-muted hover:text-foreground"
									}`}
								>
									<NetworkIcon className="size-3" />
									<span>{subAgentCount}</span>
								</button>
							</TooltipTrigger>
							<TooltipContent>
								{showSubAgents ? "Hide" : "Show"} sub-agents ({subAgentCount})
							</TooltipContent>
						</Tooltip>
					)}
					<Tooltip>
						<TooltipTrigger asChild>
							<button
								type="button"
								onClick={onOpenCommandPalette}
								className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
							>
								<SearchIcon className="size-3.5" />
							</button>
						</TooltipTrigger>
						<TooltipContent>Search sessions (&#8984;K)</TooltipContent>
					</Tooltip>
					<Tooltip>
						<TooltipTrigger asChild>
							<button
								type="button"
								onClick={() => navigate({ to: "/" })}
								className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
							>
								<PlusIcon className="size-3.5" />
							</button>
						</TooltipTrigger>
						<TooltipContent>New session (&#8984;N)</TooltipContent>
					</Tooltip>
				</div>
			</div>

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
										onSelect={() =>
											navigate({
												to: "/project/$projectSlug/session/$sessionId",
												params: {
													projectSlug: agent.projectSlug,
													sessionId: agent.id,
												},
											})
										}
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
										onSelect={() =>
											navigate({
												to: "/project/$projectSlug/session/$sessionId",
												params: {
													projectSlug: agent.projectSlug,
													sessionId: agent.id,
												},
											})
										}
										onRename={onRenameSession}
										onDelete={onDeleteSession}
										showProject
									/>
								))}
							</SidebarMenu>
						</SidebarGroupContent>
					</SidebarGroup>
				)}

				{/* Projects */}
				{projects.length > 0 && (
					<>
						{(activeSessions.length > 0 || recentSessions.length > 0) && <SidebarSeparator />}
						<SidebarGroup>
							<SidebarGroupLabel>Projects</SidebarGroupLabel>
							{onAddProject && (
								<Tooltip>
									<TooltipTrigger asChild>
										<SidebarGroupAction onClick={onAddProject}>
											<PlusIcon />
											<span className="sr-only">Add Project</span>
										</SidebarGroupAction>
									</TooltipTrigger>
									<TooltipContent side="right">Add project</TooltipContent>
								</Tooltip>
							)}
							<SidebarGroupContent>
								<SidebarMenu>
									{projects.map((project) => (
										<ProjectFolder
											key={project.id}
											project={project}
											agents={agents}
											selectedSessionId={selectedSessionId}
											navigate={navigate}
											onRename={onRenameSession}
											onDelete={onDeleteSession}
										/>
									))}
								</SidebarMenu>
							</SidebarGroupContent>
						</SidebarGroup>
					</>
				)}
			</SidebarContent>

			{/* Empty state */}
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
		</Sidebar>
	)
}

// ============================================================
// Sub-components
// ============================================================

function ProjectFolder({
	project,
	agents,
	selectedSessionId,
	navigate,
	onRename,
	onDelete,
}: {
	project: SidebarProject
	agents: Agent[]
	selectedSessionId: string | null
	navigate: ReturnType<typeof useNavigate>
	onRename?: (agent: Agent, title: string) => Promise<void>
	onDelete?: (agent: Agent) => Promise<void>
}) {
	const [expanded, setExpanded] = useState(false)
	const [showAll, setShowAll] = useState(false)

	const projectSessions = useMemo(
		() =>
			agents
				.filter((a) => a.project === project.name)
				.sort((a, b) => b.lastActiveAt - a.lastActiveAt),
		[agents, project.name],
	)

	const visibleSessions = showAll ? projectSessions : projectSessions.slice(0, SESSIONS_PER_PROJECT)
	const hiddenCount = projectSessions.length - SESSIONS_PER_PROJECT

	return (
		<SidebarMenuItem>
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
				{expanded ? (
					<ChevronDownIcon className="size-3 shrink-0 text-muted-foreground" />
				) : (
					<FolderIcon className="size-4 shrink-0" />
				)}
				<span className="truncate font-medium">{project.name}</span>
				<Badge variant="secondary" className="ml-auto shrink-0 px-1.5 py-0 text-[10px]">
					{project.agentCount}
				</Badge>
			</SidebarMenuButton>

			{expanded && (
				<div className="ml-3 border-l border-sidebar-border pl-1">
					{projectSessions.length === 0 ? (
						<p className="px-2 py-1.5 text-xs text-muted-foreground/60">No sessions yet</p>
					) : (
						<SidebarMenu>
							{visibleSessions.map((agent) => (
								<SessionItem
									key={agent.id}
									agent={agent}
									isSelected={agent.id === selectedSessionId}
									onSelect={() =>
										navigate({
											to: "/project/$projectSlug/session/$sessionId",
											params: {
												projectSlug: agent.projectSlug,
												sessionId: agent.id,
											},
										})
									}
									onRename={onRename}
									onDelete={onDelete}
									compact
								/>
							))}
							{hiddenCount > 0 && !showAll && (
								<button
									type="button"
									onClick={() => setShowAll(true)}
									className="w-full cursor-pointer px-2 py-1 text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
								>
									Show {hiddenCount} more...
								</button>
							)}
						</SidebarMenu>
					)}
				</div>
			)}
		</SidebarMenuItem>
	)
}

/**
 * Hook that returns a live-updating duration string for active sessions.
 */
function useLiveDuration(agent: Agent): string {
	const isActive = agent.status === "running" || agent.status === "waiting"

	const [elapsed, setElapsed] = useState(() =>
		isActive ? formatElapsed(agent.createdAt) : agent.duration,
	)

	useEffect(() => {
		if (!isActive) {
			setElapsed(agent.duration)
			return
		}

		setElapsed(formatElapsed(agent.createdAt))
		const id = setInterval(() => {
			setElapsed(formatElapsed(agent.createdAt))
		}, 1_000)
		return () => clearInterval(id)
	}, [isActive, agent.createdAt, agent.duration])

	return elapsed
}

const SessionItem = memo(function SessionItem({
	agent,
	isSelected,
	onSelect,
	onRename,
	onDelete,
	showProject = false,
	compact = false,
}: {
	agent: Agent
	isSelected: boolean
	onSelect: () => void
	onRename?: (agent: Agent, title: string) => Promise<void>
	onDelete?: (agent: Agent) => Promise<void>
	showProject?: boolean
	compact?: boolean
}) {
	const StatusIcon = STATUS_ICON[agent.status]
	const statusColor = STATUS_COLOR[agent.status]
	const isSubAgent = !!agent.parentId
	const duration = useLiveDuration(agent)

	const [isEditing, setIsEditing] = useState(false)
	const [editValue, setEditValue] = useState(agent.name)
	const inputRef = useRef<HTMLInputElement>(null)

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
						{agent.branch && agent.status !== "waiting" && (
							<span className="flex items-center gap-0.5 text-[10px] leading-tight text-muted-foreground/60">
								<GitBranchIcon className="size-2.5" />
								<span className="truncate">{agent.branch}</span>
							</span>
						)}
						{agent.status === "waiting" && agent.currentActivity && (
							<span className="block truncate text-[11px] leading-tight text-yellow-500">
								{agent.currentActivity}
							</span>
						)}
					</div>
				)}

				{!isEditing && (
					<span className="shrink-0 text-xs tabular-nums text-muted-foreground">{duration}</span>
				)}
			</SidebarMenuButton>
		</SidebarMenuItem>
	)

	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>{btn}</ContextMenuTrigger>
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
