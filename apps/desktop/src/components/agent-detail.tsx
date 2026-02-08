import {
	Confirmation,
	ConfirmationAction,
	ConfirmationActions,
	ConfirmationRequest,
	ConfirmationTitle,
} from "@codedeck/ui/components/ai-elements/confirmation"
import { Badge } from "@codedeck/ui/components/badge"
import { Button } from "@codedeck/ui/components/button"
import { Input } from "@codedeck/ui/components/input"
import { Popover, PopoverContent, PopoverTrigger } from "@codedeck/ui/components/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@codedeck/ui/components/tooltip"
import { useNavigate, useParams } from "@tanstack/react-router"
import {
	ArrowLeftIcon,
	CheckCircle2Icon,
	CheckIcon,
	CircleDotIcon,
	CopyIcon,
	Loader2Icon,
	PencilIcon,
	SquareIcon,
	TerminalIcon,
	XIcon,
} from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import type {
	ConfigData,
	ModelRef,
	ProvidersData,
	SdkAgent,
	VcsData,
} from "../hooks/use-opencode-data"
import { useServerConnection } from "../hooks/use-server"
import type { ChatTurn } from "../hooks/use-session-chat"
import type { Agent, AgentStatus, FileAttachment } from "../lib/types"
import { ChatView } from "./chat"

const STATUS_LABEL: Record<AgentStatus, string> = {
	running: "Running",
	waiting: "Waiting",
	paused: "Paused",
	completed: "Completed",
	failed: "Failed",
	idle: "Idle",
}

const STATUS_DOT_COLOR: Record<AgentStatus, string> = {
	running: "bg-green-500 animate-pulse",
	waiting: "bg-yellow-500 animate-pulse",
	paused: "bg-muted-foreground",
	completed: "bg-blue-500",
	failed: "bg-red-500",
	idle: "bg-muted-foreground/50",
}

interface AgentDetailProps {
	agent: Agent
	/** Structured chat turns (for Chat tab) */
	chatTurns: ChatTurn[]
	chatLoading?: boolean
	/** Whether earlier messages are currently being loaded */
	chatLoadingEarlier?: boolean
	/** Whether there are earlier messages that can be loaded */
	chatHasEarlier?: boolean
	/** Callback to load earlier messages */
	onLoadEarlier?: () => void
	onStop?: (agent: Agent) => Promise<void>
	onApprove?: (agent: Agent, permissionId: string) => Promise<void>
	onDeny?: (agent: Agent, permissionId: string) => Promise<void>
	onSendMessage?: (
		agent: Agent,
		message: string,
		options?: { model?: ModelRef; agentName?: string; variant?: string; files?: FileAttachment[] },
	) => Promise<void>
	onRename?: (agent: Agent, title: string) => Promise<void>
	/** Display name of the parent session (for breadcrumb) */
	parentSessionName?: string
	isConnected?: boolean
	/** Provider data for model selector */
	providers?: ProvidersData | null
	/** Config data (default model, default agent) */
	config?: ConfigData | null
	/** VCS data for status bar */
	vcs?: VcsData | null
	/** Available OpenCode agents for agent selector */
	openCodeAgents?: SdkAgent[]
}

export function AgentDetail({
	agent,
	chatTurns,
	chatLoading,
	onStop,
	onApprove,
	onDeny,
	onSendMessage,
	onRename,
	parentSessionName,
	isConnected,
	providers,
	config,
	vcs,
	openCodeAgents,
	chatLoadingEarlier,
	chatHasEarlier,
	onLoadEarlier,
}: AgentDetailProps) {
	const navigate = useNavigate()
	const { projectSlug } = useParams({ strict: false }) as { projectSlug?: string }

	const [isEditingTitle, setIsEditingTitle] = useState(false)
	const [titleValue, setTitleValue] = useState(agent.name)
	const titleInputRef = useRef<HTMLInputElement>(null)

	const startEditingTitle = useCallback(() => {
		if (!onRename) return
		setTitleValue(agent.name)
		setIsEditingTitle(true)
	}, [agent.name, onRename])

	const confirmTitle = useCallback(async () => {
		const trimmed = titleValue.trim()
		setIsEditingTitle(false)
		if (trimmed && trimmed !== agent.name && onRename) {
			await onRename(agent, trimmed)
		}
	}, [titleValue, agent, onRename])

	const cancelEditingTitle = useCallback(() => {
		setIsEditingTitle(false)
		setTitleValue(agent.name)
	}, [agent.name])

	useEffect(() => {
		if (isEditingTitle && titleInputRef.current) {
			titleInputRef.current.focus()
			titleInputRef.current.select()
		}
	}, [isEditingTitle])

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
					className="flex items-center gap-1.5 border-b border-border bg-muted/30 px-4 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
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

			{/* Compact top bar */}
			<div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-4">
				{/* Session name — click to edit */}
				{isEditingTitle ? (
					<Input
						ref={titleInputRef}
						value={titleValue}
						onChange={(e) => setTitleValue(e.target.value)}
						onKeyDown={(e) => {
							e.stopPropagation()
							if (e.key === "Enter") confirmTitle()
							if (e.key === "Escape") cancelEditingTitle()
						}}
						onBlur={confirmTitle}
						className="h-7 min-w-0 flex-shrink border-none bg-transparent p-0 text-sm font-semibold shadow-none focus-visible:ring-0"
					/>
				) : (
					<button
						type="button"
						onClick={onRename ? startEditingTitle : undefined}
						className={`group flex min-w-0 items-center gap-1.5 ${onRename ? "cursor-pointer" : "cursor-default"}`}
					>
						<h2 className="min-w-0 truncate text-sm font-semibold">{agent.name}</h2>
						{onRename && (
							<PencilIcon className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
						)}
					</button>
				)}

				{/* Project badge */}
				<Badge variant="secondary" className="shrink-0 text-[11px] font-normal">
					{agent.project}
				</Badge>

				{/* Status dot + label */}
				<div className="ml-auto flex items-center gap-3">
					<div className="flex items-center gap-1.5 text-xs text-muted-foreground">
						<span
							className={`inline-block size-1.5 rounded-full ${STATUS_DOT_COLOR[agent.status]}`}
						/>
						{STATUS_LABEL[agent.status]}
					</div>

					{/* Duration / tokens */}
					{agent.duration && (
						<span className="text-xs text-muted-foreground/60">{agent.duration}</span>
					)}

					{/* Open in terminal */}
					<AttachCommand sessionId={agent.sessionId} directory={agent.directory} />

					{/* Stop button (when running) */}
					{agent.status === "running" && (
						<Button
							size="sm"
							variant="ghost"
							className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-red-400"
							onClick={() => onStop?.(agent)}
							disabled={!isConnected}
						>
							<SquareIcon className="size-3" />
							Stop
						</Button>
					)}

					{/* Close button */}
					<button
						type="button"
						onClick={() =>
							navigate({
								to: projectSlug ? "/project/$projectSlug" : "/",
								params: projectSlug ? { projectSlug } : undefined,
							})
						}
						className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
					>
						<XIcon className="size-3.5" />
					</button>
				</div>
			</div>

			{/* Chat — full height, no tabs */}
			<div className="min-h-0 flex-1">
				<ChatView
					turns={chatTurns}
					loading={chatLoading ?? false}
					loadingEarlier={chatLoadingEarlier ?? false}
					hasEarlierMessages={chatHasEarlier ?? false}
					onLoadEarlier={onLoadEarlier}
					agent={agent}
					isConnected={isConnected ?? false}
					onSendMessage={onSendMessage}
					providers={providers}
					config={config}
					vcs={vcs}
					openCodeAgents={openCodeAgents}
				/>
			</div>

			{/* Permission requests (when waiting) */}
			{agent.status === "waiting" && (
				<div className="border-t border-border p-3">
					<PermissionRequests
						agent={agent}
						onApprove={onApprove}
						onDeny={onDeny}
						isConnected={isConnected}
					/>
				</div>
			)}
		</div>
	)
}

/**
 * Popover with the `opencode attach` command for opening this session in a terminal.
 */
function AttachCommand({ sessionId, directory }: { sessionId: string; directory: string }) {
	const { url } = useServerConnection()
	const [copied, setCopied] = useState(false)
	const [open, setOpen] = useState(false)

	const command = `opencode attach ${url ?? "http://127.0.0.1:4101"} --session ${sessionId} --dir ${directory}`

	const handleOpen = useCallback(
		async (nextOpen: boolean) => {
			if (nextOpen) {
				await navigator.clipboard.writeText(command)
				setCopied(true)
				setTimeout(() => setCopied(false), 2000)
			}
			setOpen(nextOpen)
		},
		[command],
	)

	const handleCopy = useCallback(async () => {
		await navigator.clipboard.writeText(command)
		setCopied(true)
		setTimeout(() => setCopied(false), 2000)
	}, [command])

	return (
		<Popover open={open} onOpenChange={handleOpen}>
			<Tooltip>
				<TooltipTrigger asChild>
					<PopoverTrigger asChild>
						<button
							type="button"
							className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
						>
							<TerminalIcon className="size-3.5" />
						</button>
					</PopoverTrigger>
				</TooltipTrigger>
				<TooltipContent>Open in terminal</TooltipContent>
			</Tooltip>
			<PopoverContent align="end" className="w-auto max-w-sm p-3">
				<div className="flex flex-col gap-2">
					<div className="flex items-center gap-1.5">
						<CheckIcon className="size-3 text-green-500" />
						<p className="text-xs font-medium">Copied to clipboard</p>
					</div>
					<div className="flex items-center gap-1.5">
						<code className="flex-1 rounded-md bg-muted px-2.5 py-1.5 font-mono text-[11px] leading-relaxed text-foreground select-all">
							{command}
						</code>
						<Button size="sm" variant="ghost" className="h-7 w-7 shrink-0 p-0" onClick={handleCopy}>
							{copied ? (
								<CheckIcon className="size-3.5 text-green-500" />
							) : (
								<CopyIcon className="size-3.5" />
							)}
						</Button>
					</div>
					<p className="text-[11px] leading-normal text-muted-foreground">
						Paste in your terminal to attach. Both views will stay in sync.
					</p>
				</div>
			</PopoverContent>
		</Popover>
	)
}

/**
 * Renders pending permission requests for a waiting agent.
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
				<CircleDotIcon className="size-3.5" />
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
	permission: { id: string; title: string; metadata?: Record<string, unknown> }
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
