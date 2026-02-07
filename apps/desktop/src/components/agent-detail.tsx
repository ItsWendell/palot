import { Badge } from "@codedeck/ui/components/badge"
import { Button } from "@codedeck/ui/components/button"
import { ScrollArea } from "@codedeck/ui/components/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@codedeck/ui/components/tabs"
import {
	AlertCircleIcon,
	CheckCircle2Icon,
	CircleDotIcon,
	CirclePauseIcon,
	CloudIcon,
	ContainerIcon,
	EditIcon,
	EyeIcon,
	FileCodeIcon,
	GitBranchIcon,
	Loader2Icon,
	MonitorIcon,
	PauseIcon,
	PlayIcon,
	SearchIcon,
	SquareIcon,
	TerminalIcon,
	TimerIcon,
	WrenchIcon,
	XIcon,
	ZapIcon,
} from "lucide-react"
import type { Activity, Agent, AgentStatus, EnvironmentType } from "../lib/types"

const STATUS_LABEL: Record<AgentStatus, string> = {
	running: "Running",
	waiting: "Waiting",
	paused: "Paused",
	completed: "Completed",
	failed: "Failed",
	idle: "Idle",
}

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

const ENV_LABEL: Record<EnvironmentType, string> = {
	cloud: "Cloud",
	local: "Local",
	vm: "VM",
}

const ENV_ICON: Record<EnvironmentType, typeof CloudIcon> = {
	cloud: CloudIcon,
	local: MonitorIcon,
	vm: ContainerIcon,
}

const ACTIVITY_ICON: Record<Activity["type"], typeof EyeIcon> = {
	read: EyeIcon,
	search: SearchIcon,
	edit: EditIcon,
	run: TerminalIcon,
	think: ZapIcon,
	write: FileCodeIcon,
	tool: WrenchIcon,
}

interface AgentDetailProps {
	agent: Agent
	onClose: () => void
	onStop?: (agent: Agent) => Promise<void>
	onApprove?: (agent: Agent, permissionId: string) => Promise<void>
	onDeny?: (agent: Agent, permissionId: string) => Promise<void>
	isConnected?: boolean
}

export function AgentDetail({
	agent,
	onClose,
	onStop,
	onApprove,
	onDeny,
	isConnected,
}: AgentDetailProps) {
	const StatusIcon = STATUS_ICON[agent.status]
	const EnvIcon = ENV_ICON[agent.environment]

	return (
		<div className="flex h-full flex-col">
			{/* Header */}
			<div className="flex items-start gap-3 border-b border-border p-4">
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2">
						<h2 className="truncate text-sm font-semibold">{agent.name}</h2>
						<button
							type="button"
							onClick={onClose}
							className="ml-auto shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
						>
							<XIcon className="size-4" />
						</button>
					</div>

					<div className="mt-2 flex flex-wrap items-center gap-2">
						<Badge variant="outline" className="gap-1.5">
							<StatusIcon
								className={`size-3 ${STATUS_COLOR[agent.status]} ${agent.status === "running" ? "animate-spin" : ""}`}
							/>
							{STATUS_LABEL[agent.status]}
						</Badge>
						<Badge variant="outline" className="gap-1.5">
							<EnvIcon className="size-3" />
							{ENV_LABEL[agent.environment]}
						</Badge>
						<Badge variant="outline" className="gap-1.5">
							<GitBranchIcon className="size-3" />
							{agent.branch}
						</Badge>
					</div>

					<div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
						<span>{agent.duration}</span>
						<span>&middot;</span>
						<span>
							{agent.tokens >= 1000 ? `${(agent.tokens / 1000).toFixed(1)}k` : agent.tokens} tokens
						</span>
						<span>&middot;</span>
						<span>${agent.cost.toFixed(2)}</span>
					</div>
				</div>
			</div>

			{/* Tabs */}
			<Tabs defaultValue="activity" className="flex min-h-0 flex-1 flex-col">
				<TabsList variant="line" className="shrink-0 border-b border-border px-4">
					<TabsTrigger value="activity">Activity</TabsTrigger>
					<TabsTrigger value="diff">Diff</TabsTrigger>
					<TabsTrigger value="terminal">Terminal</TabsTrigger>
				</TabsList>

				<TabsContent value="activity" className="min-h-0 flex-1">
					<ScrollArea className="h-full">
						<div className="space-y-1 p-4">
							{[...agent.activities].reverse().map((activity) => (
								<ActivityItem key={activity.id} activity={activity} />
							))}
						</div>
					</ScrollArea>
				</TabsContent>

				<TabsContent value="diff" className="min-h-0 flex-1">
					<div className="flex h-full items-center justify-center">
						<div className="text-center">
							<FileCodeIcon className="mx-auto mb-2 size-8 text-muted-foreground/40" />
							<p className="text-sm text-muted-foreground">Diff viewer coming soon</p>
						</div>
					</div>
				</TabsContent>

				<TabsContent value="terminal" className="min-h-0 flex-1">
					<div className="flex h-full items-center justify-center">
						<div className="text-center">
							<TerminalIcon className="mx-auto mb-2 size-8 text-muted-foreground/40" />
							<p className="text-sm text-muted-foreground">Terminal coming soon</p>
						</div>
					</div>
				</TabsContent>
			</Tabs>

			{/* Action bar */}
			<div className="border-t border-border p-3">
				{agent.status === "completed" ? (
					<div className="flex gap-2">
						<Button size="sm" className="flex-1">
							Create PR
						</Button>
						<Button size="sm" variant="outline" className="flex-1">
							Apply Locally
						</Button>
					</div>
				) : agent.status === "running" ? (
					<div className="flex gap-2">
						<Button size="sm" variant="outline" className="flex-1">
							<PauseIcon className="mr-1.5 size-3.5" />
							Pause
						</Button>
						<Button
							size="sm"
							variant="destructive"
							className="flex-1"
							onClick={() => onStop?.(agent)}
							disabled={!isConnected}
						>
							<SquareIcon className="mr-1.5 size-3.5" />
							Stop
						</Button>
					</div>
				) : agent.status === "failed" ? (
					<div className="flex gap-2">
						<Button size="sm" className="flex-1">
							<PlayIcon className="mr-1.5 size-3.5" />
							Retry
						</Button>
						<Button size="sm" variant="outline" className="flex-1">
							View Logs
						</Button>
					</div>
				) : agent.status === "waiting" ? (
					<div className="flex gap-2">
						<Button
							size="sm"
							className="flex-1"
							onClick={() => onApprove?.(agent, "")}
							disabled={!isConnected}
						>
							<CheckCircle2Icon className="mr-1.5 size-3.5" />
							Approve
						</Button>
						<Button
							size="sm"
							variant="outline"
							className="flex-1"
							onClick={() => onDeny?.(agent, "")}
							disabled={!isConnected}
						>
							Deny
						</Button>
					</div>
				) : agent.status === "paused" ? (
					<Button size="sm" className="w-full">
						<PlayIcon className="mr-1.5 size-3.5" />
						Resume
					</Button>
				) : null}
			</div>
		</div>
	)
}

function ActivityItem({ activity }: { activity: Activity }) {
	const Icon = ACTIVITY_ICON[activity.type]

	return (
		<div className="flex items-start gap-3 rounded-md px-2 py-2 transition-colors hover:bg-muted/50">
			<span className="mt-0.5 text-xs text-muted-foreground">{activity.timestamp}</span>
			<Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
			<div className="min-w-0 flex-1">
				<p className="text-sm">{activity.description}</p>
				{activity.detail && (
					<p className="mt-0.5 text-xs text-muted-foreground">{activity.detail}</p>
				)}
			</div>
		</div>
	)
}
