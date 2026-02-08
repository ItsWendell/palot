import { Badge } from "@codedeck/ui/components/badge"
import { Button } from "@codedeck/ui/components/button"
import { ScrollArea } from "@codedeck/ui/components/scroll-area"
import { Separator } from "@codedeck/ui/components/separator"
import { Tooltip, TooltipContent, TooltipTrigger } from "@codedeck/ui/components/tooltip"
import { useNavigate, useParams } from "@tanstack/react-router"
import {
	AlertCircleIcon,
	CheckCircle2Icon,
	ChevronDownIcon,
	ChevronRightIcon,
	CircleDotIcon,
	GitBranchIcon,
	Loader2Icon,
	NetworkIcon,
	PlusIcon,
	SearchIcon,
	TimerIcon,
} from "lucide-react"
import { useMemo, useState } from "react"
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

interface SidebarProps {
	agents: Agent[]
	projects: SidebarProject[]
	onOpenCommandPalette: () => void
	showSubAgents: boolean
	subAgentCount: number
	onToggleSubAgents: () => void
}

// ============================================================
// Main component
// ============================================================

export function Sidebar({
	agents,
	projects,
	onOpenCommandPalette,
	showSubAgents,
	subAgentCount,
	onToggleSubAgents,
}: SidebarProps) {
	const navigate = useNavigate()
	const routeParams = useParams({ strict: false }) as { sessionId?: string }
	const selectedSessionId = routeParams.sessionId ?? null

	// Derive sections
	const activeSessions = useMemo(
		() =>
			agents
				.filter((a) => a.status === "running" || a.status === "waiting" || a.status === "failed")
				.sort((a, b) => b.lastActiveAt - a.lastActiveAt),
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
		<aside className="flex h-full flex-col bg-sidebar">
			{/* Header */}
			<div className="flex h-12 shrink-0 items-center justify-between border-b border-sidebar-border px-4">
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
					<Button
						size="icon"
						variant="ghost"
						className="size-7"
						onClick={() => navigate({ to: "/" })}
					>
						<PlusIcon className="size-3.5" />
					</Button>
				</div>
			</div>
			{/* Scrollable content — override Radix ScrollArea's display:table inner div */}
			<ScrollArea className="flex-1 [&>[data-radix-scroll-area-viewport]>div]:!block">
				<nav className="space-y-1 overflow-hidden p-2">
					{/* Active Now */}
					{activeSessions.length > 0 && (
						<SidebarSection label="Active Now">
							{activeSessions.map((agent) => (
								<SessionItem
									key={agent.id}
									agent={agent}
									isSelected={agent.id === selectedSessionId}
									onSelect={() =>
										navigate({
											to: "/project/$projectSlug/session/$sessionId",
											params: { projectSlug: agent.projectSlug, sessionId: agent.id },
										})
									}
									showProject
								/>
							))}
						</SidebarSection>
					)}

					{/* Recent */}
					{recentSessions.length > 0 && (
						<SidebarSection label="Recent">
							{recentSessions.map((agent) => (
								<SessionItem
									key={agent.id}
									agent={agent}
									isSelected={agent.id === selectedSessionId}
									onSelect={() =>
										navigate({
											to: "/project/$projectSlug/session/$sessionId",
											params: { projectSlug: agent.projectSlug, sessionId: agent.id },
										})
									}
									showProject
								/>
							))}
						</SidebarSection>
					)}

					{/* Projects */}
					{projects.length > 0 && (
						<>
							{(activeSessions.length > 0 || recentSessions.length > 0) && (
								<Separator className="my-2" />
							)}
							<SidebarSection label="Projects">
								{projects.map((project) => (
									<ProjectFolder
										key={project.id}
										project={project}
										agents={agents}
										selectedSessionId={selectedSessionId}
										navigate={navigate}
									/>
								))}
							</SidebarSection>
						</>
					)}
				</nav>
			</ScrollArea>

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
		</aside>
	)
}

// ============================================================
// Sub-components
// ============================================================

function SidebarSection({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div className="space-y-0.5">
			<h2 className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
				{label}
			</h2>
			{children}
		</div>
	)
}

function ProjectFolder({
	project,
	agents,
	selectedSessionId,
	navigate,
}: {
	project: SidebarProject
	agents: Agent[]
	selectedSessionId: string | null
	navigate: ReturnType<typeof useNavigate>
}) {
	const [expanded, setExpanded] = useState(false)
	const [showAll, setShowAll] = useState(false)

	// All sessions for this project (always shown, even if also in Active/Recent)
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
		<div>
			<div className="flex items-center overflow-hidden">
				<button
					type="button"
					onClick={() => {
						setExpanded(!expanded)
						navigate({
							to: "/project/$projectSlug",
							params: { projectSlug: project.slug },
						})
					}}
					className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 overflow-hidden rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-sidebar-accent/50"
				>
					{expanded ? (
						<ChevronDownIcon className="size-3 shrink-0 text-muted-foreground" />
					) : (
						<ChevronRightIcon className="size-3 shrink-0 text-muted-foreground" />
					)}
					<span className="truncate font-medium">{project.name}</span>
					<Badge variant="secondary" className="ml-auto shrink-0 px-1.5 py-0 text-[10px]">
						{project.agentCount}
					</Badge>
				</button>
			</div>

			{expanded && (
				<div className="ml-3 border-l border-sidebar-border pl-1">
					{projectSessions.length === 0 ? (
						<p className="px-2 py-1.5 text-xs text-muted-foreground/60">No sessions yet</p>
					) : (
						<>
							{visibleSessions.map((agent) => (
								<SessionItem
									key={agent.id}
									agent={agent}
									isSelected={agent.id === selectedSessionId}
									onSelect={() =>
										navigate({
											to: "/project/$projectSlug/session/$sessionId",
											params: { projectSlug: agent.projectSlug, sessionId: agent.id },
										})
									}
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
						</>
					)}
				</div>
			)}
		</div>
	)
}

function SessionItem({
	agent,
	isSelected,
	onSelect,
	showProject = false,
	compact = false,
}: {
	agent: Agent
	isSelected: boolean
	onSelect: () => void
	showProject?: boolean
	compact?: boolean
}) {
	const StatusIcon = STATUS_ICON[agent.status]
	const statusColor = STATUS_COLOR[agent.status]
	const isSubAgent = !!agent.parentId

	const btn = (
		<button
			type="button"
			onClick={onSelect}
			className={`flex w-full cursor-pointer items-center gap-2 overflow-hidden rounded-md text-left transition-colors ${
				compact ? "px-2 py-1.5" : "px-2 py-2"
			} ${isSelected ? "bg-accent text-accent-foreground" : "hover:bg-muted/50"}`}
		>
			{isSubAgent ? (
				<GitBranchIcon className={`size-4 shrink-0 ${statusColor}`} />
			) : (
				<StatusIcon
					className={`size-4 shrink-0 ${statusColor} ${agent.status === "running" ? "animate-spin" : ""}`}
				/>
			)}

			<span
				className={`min-w-0 flex-1 truncate leading-tight ${compact ? "text-xs" : "text-[13px]"}`}
			>
				{agent.name}
			</span>

			<span className="shrink-0 text-xs tabular-nums text-muted-foreground">{agent.duration}</span>
		</button>
	)

	if (showProject || compact) {
		return (
			<Tooltip>
				<TooltipTrigger asChild>{btn}</TooltipTrigger>
				<TooltipContent side="right" align="center">
					{showProject ? agent.project : agent.name}
				</TooltipContent>
			</Tooltip>
		)
	}

	return btn
}
