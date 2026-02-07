import {
	Confirmation,
	ConfirmationAction,
	ConfirmationActions,
	ConfirmationRequest,
	ConfirmationTitle,
} from "@codedeck/ui/components/ai-elements/confirmation"
import { Badge } from "@codedeck/ui/components/badge"
import { Button } from "@codedeck/ui/components/button"
import { ScrollArea } from "@codedeck/ui/components/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@codedeck/ui/components/tabs"
import { useNavigate, useParams } from "@tanstack/react-router"
import {
	AlertCircleIcon,
	ArrowLeftIcon,
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
import { useState } from "react"
import type { ChatTurn } from "../hooks/use-session-chat"
import type { Activity, Agent, AgentStatus, EnvironmentType, Permission } from "../lib/types"
import { ChatView } from "./chat"

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
	/** Flattened activity list (for Activity tab) */
	activities: Activity[]
	activitiesLoading?: boolean
	/** Structured chat turns (for Chat tab) */
	chatTurns: ChatTurn[]
	chatLoading?: boolean
	onStop?: (agent: Agent) => Promise<void>
	onApprove?: (agent: Agent, permissionId: string) => Promise<void>
	onDeny?: (agent: Agent, permissionId: string) => Promise<void>
	onSendMessage?: (agent: Agent, message: string) => Promise<void>
	/** Display name of the parent session (for breadcrumb) */
	parentSessionName?: string
	isConnected?: boolean
}

export function AgentDetail({
	agent,
	activities,
	activitiesLoading,
	chatTurns,
	chatLoading,
	onStop,
	onApprove,
	onDeny,
	onSendMessage,
	parentSessionName,
	isConnected,
}: AgentDetailProps) {
	const navigate = useNavigate()
	const { projectSlug } = useParams({ strict: false }) as { projectSlug?: string }

	const StatusIcon = STATUS_ICON[agent.status]
	const EnvIcon = ENV_ICON[agent.environment]

	return (
		<div className="flex h-full flex-col">
			{/* Sub-agent breadcrumb — navigate back to parent */}
			{agent.parentId && (
				<button
					type="button"
					onClick={() =>
						navigate({
							to: "/project/$projectSlug/session/$sessionId",
							params: { projectSlug: projectSlug ?? agent.projectSlug, sessionId: agent.parentId! },
						})
					}
					className="flex items-center gap-1.5 border-b border-border bg-muted/30 px-4 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
				>
					<ArrowLeftIcon className="size-3" />
					<span>
						Back to{" "}
						<span className="font-medium text-foreground">
							{parentSessionName || "parent session"}
						</span>
					</span>
				</button>
			)}

			{/* Header */}
			<div className="flex items-start gap-3 border-b border-border p-4">
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2">
						<h2 className="truncate text-sm font-semibold">{agent.name}</h2>
						<button
							type="button"
							onClick={() =>
								navigate({
									to: projectSlug ? "/project/$projectSlug" : "/",
									params: projectSlug ? { projectSlug } : undefined,
								})
							}
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
						{agent.branch && (
							<Badge variant="outline" className="gap-1.5">
								<GitBranchIcon className="size-3" />
								{agent.branch}
							</Badge>
						)}
					</div>

					<div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
						<span>{agent.duration}</span>
						{agent.tokens > 0 && (
							<>
								<span>&middot;</span>
								<span>
									{agent.tokens >= 1000 ? `${(agent.tokens / 1000).toFixed(1)}k` : agent.tokens}{" "}
									tokens
								</span>
							</>
						)}
						{agent.cost > 0 && (
							<>
								<span>&middot;</span>
								<span>${agent.cost.toFixed(2)}</span>
							</>
						)}
					</div>
				</div>
			</div>

			{/* Tabs — Chat is now the default */}
			<Tabs defaultValue="chat" className="flex min-h-0 flex-1 flex-col">
				<TabsList variant="line" className="shrink-0 border-b border-border px-4">
					<TabsTrigger value="chat">Chat</TabsTrigger>
					<TabsTrigger value="activity">
						Activity
						{activities.length > 0 && (
							<span className="ml-1.5 text-muted-foreground">({activities.length})</span>
						)}
					</TabsTrigger>
					<TabsTrigger value="diff">Diff</TabsTrigger>
				</TabsList>

				{/* Chat tab — turn-based conversation view with integrated input */}
				<TabsContent value="chat" className="min-h-0 flex-1">
					<ChatView
						turns={chatTurns}
						loading={chatLoading ?? false}
						agent={agent}
						isConnected={isConnected ?? false}
						onSendMessage={onSendMessage}
					/>
				</TabsContent>

				{/* Activity tab — raw flat log of tool calls */}
				<TabsContent value="activity" className="min-h-0 flex-1">
					<ScrollArea className="h-full">
						<div className="space-y-1 p-4">
							{activitiesLoading ? (
								<div className="flex items-center justify-center py-8">
									<Loader2Icon className="size-5 animate-spin text-muted-foreground" />
									<span className="ml-2 text-sm text-muted-foreground">Loading activity...</span>
								</div>
							) : activities.length > 0 ? (
								[...activities]
									.reverse()
									.map((activity) => <ActivityItem key={activity.id} activity={activity} />)
							) : (
								<div className="flex items-center justify-center py-8">
									<p className="text-sm text-muted-foreground">No activity yet</p>
								</div>
							)}
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
			</Tabs>

			{/* Action bar — permissions, stop, etc. (no message input here anymore) */}
			<ActionBar
				agent={agent}
				onStop={onStop}
				onApprove={onApprove}
				onDeny={onDeny}
				isConnected={isConnected}
			/>
		</div>
	)
}

/**
 * Status-dependent action buttons at the bottom of the detail panel.
 * Permission approve/deny, stop, retry, etc.
 */
function ActionBar({
	agent,
	onStop,
	onApprove,
	onDeny,
	isConnected,
}: {
	agent: Agent
	onStop?: (agent: Agent) => Promise<void>
	onApprove?: (agent: Agent, permissionId: string) => Promise<void>
	onDeny?: (agent: Agent, permissionId: string) => Promise<void>
	isConnected?: boolean
}) {
	// Only show action bar for statuses that have actions
	const showActionBar =
		agent.status === "running" ||
		agent.status === "waiting" ||
		agent.status === "failed" ||
		agent.status === "paused"

	if (!showActionBar) return null

	return (
		<div className="border-t border-border p-3">
			{agent.status === "running" ? (
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
				<PermissionRequests
					agent={agent}
					onApprove={onApprove}
					onDeny={onDeny}
					isConnected={isConnected}
				/>
			) : agent.status === "paused" ? (
				<Button size="sm" className="w-full">
					<PlayIcon className="mr-1.5 size-3.5" />
					Resume
				</Button>
			) : null}
		</div>
	)
}

function ActivityItem({ activity }: { activity: Activity }) {
	const Icon = ACTIVITY_ICON[activity.type]

	return (
		<div className="flex items-start gap-3 rounded-md px-2 py-2 transition-colors hover:bg-muted/50">
			<span className="mt-0.5 shrink-0 text-xs text-muted-foreground tabular-nums">
				{activity.timestamp}
			</span>
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

/**
 * Renders pending permission requests for a waiting agent.
 * Each permission gets its own approve/deny buttons with the real permission ID.
 */
function PermissionRequests({
	agent,
	onApprove,
	onDeny,
	isConnected,
}: {
	agent: Agent
	onApprove?: (agent: Agent, permissionId: string) => Promise<void>
	onDeny?: (agent: Agent, permissionId: string) => Promise<void>
	isConnected?: boolean
}) {
	const permissions = agent.permissions

	if (permissions.length === 0) {
		return (
			<div className="flex items-center gap-2 text-sm text-muted-foreground">
				<TimerIcon className="size-3.5" />
				<span>Waiting for permission request...</span>
			</div>
		)
	}

	return (
		<div className="space-y-2">
			{permissions.map((permission) => (
				<PermissionItem
					key={permission.id}
					agent={agent}
					permission={permission}
					onApprove={onApprove}
					onDeny={onDeny}
					isConnected={isConnected}
				/>
			))}
		</div>
	)
}

function PermissionItem({
	agent,
	permission,
	onApprove,
	onDeny,
	isConnected,
}: {
	agent: Agent
	permission: Permission
	onApprove?: (agent: Agent, permissionId: string) => Promise<void>
	onDeny?: (agent: Agent, permissionId: string) => Promise<void>
	isConnected?: boolean
}) {
	const [responding, setResponding] = useState(false)

	async function handleApprove() {
		if (!onApprove || responding) return
		setResponding(true)
		try {
			await onApprove(agent, permission.id)
		} finally {
			setResponding(false)
		}
	}

	async function handleDeny() {
		if (!onDeny || responding) return
		setResponding(true)
		try {
			await onDeny(agent, permission.id)
		} finally {
			setResponding(false)
		}
	}

	const tool = permission.metadata?.tool as string | undefined
	const command = permission.metadata?.command as string | undefined

	return (
		<Confirmation approval={{ id: permission.id }} state="approval-requested">
			<ConfirmationTitle>{permission.title}</ConfirmationTitle>
			<ConfirmationRequest>
				{(tool || command) && (
					<p className="truncate text-xs text-muted-foreground">
						{tool && <span>{tool}</span>}
						{command && (
							<code className="ml-1 rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
								{command.length > 80 ? `${command.slice(0, 80)}...` : command}
							</code>
						)}
					</p>
				)}
			</ConfirmationRequest>
			<ConfirmationActions>
				<ConfirmationAction
					variant="outline"
					onClick={handleDeny}
					disabled={!isConnected || responding}
				>
					Deny
				</ConfirmationAction>
				<ConfirmationAction onClick={handleApprove} disabled={!isConnected || responding}>
					{responding ? (
						<Loader2Icon className="mr-1.5 size-3.5 animate-spin" />
					) : (
						<CheckCircle2Icon className="mr-1.5 size-3.5" />
					)}
					Approve
				</ConfirmationAction>
			</ConfirmationActions>
		</Confirmation>
	)
}
