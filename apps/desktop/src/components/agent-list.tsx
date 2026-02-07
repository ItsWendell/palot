import { Badge } from "@codedeck/ui/components/badge"
import { Button } from "@codedeck/ui/components/button"
import { Kbd } from "@codedeck/ui/components/kbd"
import { ScrollArea } from "@codedeck/ui/components/scroll-area"
import { Tooltip, TooltipContent, TooltipTrigger } from "@codedeck/ui/components/tooltip"
import {
	AlertCircleIcon,
	CheckCircle2Icon,
	CircleDotIcon,
	CirclePauseIcon,
	CloudIcon,
	ContainerIcon,
	Loader2Icon,
	MonitorIcon,
	PlusIcon,
	TimerIcon,
} from "lucide-react"
import type { Agent, AgentStatus, EnvironmentType } from "../lib/types"

const STATUS_ICON: Record<AgentStatus, typeof Loader2Icon> = {
	running: Loader2Icon,
	waiting: TimerIcon,
	paused: CirclePauseIcon,
	completed: CheckCircle2Icon,
	failed: AlertCircleIcon,
	idle: CircleDotIcon,
}

const STATUS_COLOR: Record<AgentStatus, string> = {
	running: "text-green-500",
	waiting: "text-yellow-500",
	paused: "text-muted-foreground",
	completed: "text-blue-500",
	failed: "text-red-500",
	idle: "text-muted-foreground",
}

const ENV_ICON: Record<EnvironmentType, typeof CloudIcon> = {
	cloud: CloudIcon,
	local: MonitorIcon,
	vm: ContainerIcon,
}

interface AgentListProps {
	agents: Agent[]
	selectedAgentId: string | null
	onSelectAgent: (id: string) => void
	onNewAgent: () => void
	onOpenCommandPalette: () => void
}

export function AgentList({
	agents,
	selectedAgentId,
	onSelectAgent,
	onNewAgent,
	onOpenCommandPalette,
}: AgentListProps) {
	// Sort: failed first, then running, waiting, idle, paused, completed
	const sortOrder: Record<AgentStatus, number> = {
		failed: 0,
		waiting: 1,
		running: 2,
		idle: 3,
		paused: 4,
		completed: 5,
	}

	const sortedAgents = [...agents].sort((a, b) => sortOrder[a.status] - sortOrder[b.status])

	return (
		<div className="flex h-full flex-col">
			{/* Header */}
			<header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
				<span className="text-sm font-medium">
					All Agents
					<span className="ml-1.5 text-muted-foreground">({agents.length})</span>
				</span>
				<div className="flex-1" />
				<Tooltip>
					<TooltipTrigger asChild>
						<button
							type="button"
							onClick={onOpenCommandPalette}
							className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
						>
							<Kbd>&#8984;K</Kbd>
						</button>
					</TooltipTrigger>
					<TooltipContent>
						<p>Command palette</p>
					</TooltipContent>
				</Tooltip>
			</header>

			{/* Agent List */}
			{agents.length === 0 ? (
				<EmptyState onNewAgent={onNewAgent} />
			) : (
				<ScrollArea className="flex-1">
					<div className="p-2">
						{sortedAgents.map((agent) => (
							<AgentListItem
								key={agent.id}
								agent={agent}
								isSelected={agent.id === selectedAgentId}
								onSelect={() => onSelectAgent(agent.id)}
							/>
						))}
					</div>
				</ScrollArea>
			)}
		</div>
	)
}

function AgentListItem({
	agent,
	isSelected,
	onSelect,
}: {
	agent: Agent
	isSelected: boolean
	onSelect: () => void
}) {
	const StatusIcon = STATUS_ICON[agent.status]
	const EnvIcon = ENV_ICON[agent.environment]
	const statusColor = STATUS_COLOR[agent.status]

	return (
		<button
			type="button"
			onClick={onSelect}
			className={`flex w-full cursor-pointer items-start gap-3 rounded-lg p-3 text-left transition-colors ${
				isSelected ? "bg-accent text-accent-foreground" : "hover:bg-muted/50"
			}`}
		>
			<StatusIcon
				className={`mt-0.5 size-4 shrink-0 ${statusColor} ${agent.status === "running" ? "animate-spin" : ""}`}
			/>

			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<span className="truncate text-sm font-medium">{agent.name}</span>
				</div>
				<div className="mt-0.5 flex items-center gap-2">
					{agent.currentActivity && (
						<span className="truncate text-xs text-muted-foreground">{agent.currentActivity}</span>
					)}
				</div>
			</div>

			<div className="flex shrink-0 flex-col items-end gap-1">
				<span className="text-xs text-muted-foreground">{agent.duration}</span>
				<div className="flex items-center gap-1">
					<Badge variant="outline" className="h-5 gap-1 px-1.5 text-[10px] font-normal">
						<EnvIcon className="size-3" />
					</Badge>
				</div>
			</div>
		</button>
	)
}

function EmptyState({ onNewAgent }: { onNewAgent: () => void }) {
	return (
		<div className="flex flex-1 items-center justify-center">
			<div className="space-y-3 text-center">
				<div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-muted">
					<svg
						aria-hidden="true"
						className="size-6 text-muted-foreground"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
					>
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							strokeWidth={1.5}
							d="M12 4v16m8-8H4"
						/>
					</svg>
				</div>
				<p className="text-sm font-medium text-muted-foreground">No agents running yet</p>
				<p className="text-xs text-muted-foreground/60">Create a new agent to get started</p>
				<Button variant="outline" size="sm" className="mt-2" onClick={onNewAgent}>
					<PlusIcon className="mr-1.5 size-3.5" />
					New Agent
				</Button>
			</div>
		</div>
	)
}
