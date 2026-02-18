import { Button } from "@palot/ui/components/button"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@palot/ui/components/dropdown-menu"
import { Input } from "@palot/ui/components/input"
import { Popover, PopoverContent, PopoverTrigger } from "@palot/ui/components/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@palot/ui/components/tooltip"
import { cn } from "@palot/ui/lib/utils"
import { useNavigate, useParams } from "@tanstack/react-router"
import { useAtom, useAtomValue } from "jotai"
import {
	ArrowLeftIcon,
	CheckIcon,
	ChevronDownIcon,
	CopyIcon,
	ExternalLinkIcon,
	FileDiffIcon,
	GitForkIcon,
	PencilIcon,
	SquareIcon,
	TerminalIcon,
	XIcon,
} from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import type { OpenInTarget } from "../../preload/api"
import { reviewPanelOpenAtom, reviewPanelSettingsAtom, sessionDiffStatsFamily } from "../atoms/ui"
import type {
	ConfigData,
	ModelRef,
	ProvidersData,
	SdkAgent,
	VcsData,
} from "../hooks/use-opencode-data"
import { useServerConnection } from "../hooks/use-server"
import type { ChatTurn } from "../hooks/use-session-chat"
import type { Agent, AgentStatus, FileAttachment, QuestionAnswer } from "../lib/types"
import { fetchOpenInTargets, isElectron, openInTarget } from "../services/backend"
import { useSetAppBarContent } from "./app-bar-context"
import { ChatView } from "./chat"
import { PalotWordmark } from "./palot-wordmark"
import { ReviewPanel } from "./review/review-panel"
import { SessionMetricsBar } from "./session-metrics-bar"
import { WorktreeActions } from "./worktree-actions"

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
	onApprove?: (agent: Agent, permissionId: string, response?: "once" | "always") => Promise<void>
	onDeny?: (agent: Agent, permissionId: string) => Promise<void>
	onReplyQuestion?: (agent: Agent, requestId: string, answers: QuestionAnswer[]) => Promise<void>
	onRejectQuestion?: (agent: Agent, requestId: string) => Promise<void>
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
	/** Whether undo is available */
	canUndo?: boolean
	/** Whether redo is available */
	canRedo?: boolean
	/** Undo handler — returns the undone user message text */
	onUndo?: () => Promise<string | undefined>
	/** Redo handler */
	onRedo?: () => Promise<void>
	/** Whether the session is in a reverted state */
	isReverted?: boolean
	/** Revert to a specific message (for per-turn undo) */
	onRevertToMessage?: (messageId: string) => Promise<void>
}

export function AgentDetail({
	agent,
	chatTurns,
	chatLoading,
	onStop,
	onApprove,
	onDeny,
	onReplyQuestion,
	onRejectQuestion,
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
	canUndo,
	canRedo,
	onUndo,
	onRedo,
	isReverted,
	onRevertToMessage,
}: AgentDetailProps) {
	const navigate = useNavigate()
	const { projectSlug } = useParams({ strict: false }) as { projectSlug?: string }
	const setAppBarContent = useSetAppBarContent()

	const [isEditingTitle, setIsEditingTitle] = useState(false)
	const [titleValue, setTitleValue] = useState(agent.name)
	const titleInputRef = useRef<HTMLInputElement>(null)

	// Review panel state
	const [reviewPanelOpen, setReviewPanelOpen] = useAtom(reviewPanelOpenAtom)
	const [reviewSettings, setReviewSettings] = useAtom(reviewPanelSettingsAtom)

	// Keyboard shortcut: Cmd+Shift+D to toggle review panel
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "d") {
				e.preventDefault()
				setReviewPanelOpen((prev) => !prev)
			}
			if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "f") {
				e.preventDefault()
				if (reviewPanelOpen) {
					setReviewSettings((prev) => ({ ...prev, expanded: !prev.expanded }))
				}
			}
		}
		document.addEventListener("keydown", handleKeyDown)
		return () => document.removeEventListener("keydown", handleKeyDown)
	}, [setReviewPanelOpen, setReviewSettings, reviewPanelOpen])

	// Close review panel when navigating to a session with no diffs
	const prevSessionIdRef = useRef(agent.sessionId)
	const diffStats = useAtomValue(sessionDiffStatsFamily(agent.sessionId))
	useEffect(() => {
		if (prevSessionIdRef.current !== agent.sessionId) {
			prevSessionIdRef.current = agent.sessionId
			if (diffStats.fileCount === 0) {
				setReviewPanelOpen(false)
			}
		}
	}, [agent.sessionId, diffStats.fileCount, setReviewPanelOpen])

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

	// ===== Inject session info into AppBar right section =====
	useEffect(() => {
		setAppBarContent(
			<SessionAppBarContent
				agent={agent}
				isEditingTitle={isEditingTitle}
				titleValue={titleValue}
				titleInputRef={titleInputRef}
				onTitleValueChange={setTitleValue}
				onStartEditing={startEditingTitle}
				onConfirmTitle={confirmTitle}
				onCancelEditing={cancelEditingTitle}
				onStop={onStop}
				onRename={onRename}
				isConnected={isConnected}
				projectSlug={projectSlug}
				reviewPanelOpen={reviewPanelOpen}
				onToggleReviewPanel={() => setReviewPanelOpen((prev) => !prev)}
			/>,
		)

		// Clean up when unmounting
		return () => setAppBarContent(null)
	}, [
		agent,
		isEditingTitle,
		titleValue,
		startEditingTitle,
		confirmTitle,
		cancelEditingTitle,
		onStop,
		onRename,
		isConnected,
		projectSlug,
		setAppBarContent,
		reviewPanelOpen,
		setReviewPanelOpen,
	])

	const chatContent = (
		<>
			{/* Sub-agent breadcrumb -- navigate back to parent */}
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

			{/* Chat -- full height */}
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
					onStop={onStop}
					providers={providers}
					config={config}
					vcs={vcs}
					openCodeAgents={openCodeAgents}
					onApprove={onApprove}
					onDeny={onDeny}
					onReplyQuestion={onReplyQuestion}
					onRejectQuestion={onRejectQuestion}
					canUndo={canUndo}
					canRedo={canRedo}
					onUndo={onUndo}
					onRedo={onRedo}
					isReverted={isReverted}
					onRevertToMessage={onRevertToMessage}
					reviewPanelOpen={reviewPanelOpen}
				/>
			</div>
		</>
	)

	return (
		<div className="flex h-full">
			{/* Chat panel -- takes remaining space */}
			<div className="min-w-0 flex-1 flex flex-col">{chatContent}</div>

			{/* Review panel -- slides in/out from right */}
			<div
				className="shrink-0 overflow-hidden border-l border-border transition-[width] duration-250 ease-in-out"
				style={{ width: reviewPanelOpen ? (reviewSettings.expanded ? "100%" : "40%") : 0 }}
			>
				{/* Keep ReviewPanel mounted so it retains state, just hidden at 0 width */}
				<div className="h-full" style={{ minWidth: reviewSettings.expanded ? "100vw" : "40vw" }}>
					<ReviewPanel sessionId={agent.sessionId} directory={agent.directory} />
				</div>
			</div>
		</div>
	)
}

// ============================================================
// Session header content injected into the AppBar
// ============================================================

function SessionAppBarContent({
	agent,
	isEditingTitle,
	titleValue,
	titleInputRef,
	onTitleValueChange,
	onStartEditing,
	onConfirmTitle,
	onCancelEditing,
	onStop,
	onRename,
	isConnected,
	projectSlug,
	reviewPanelOpen,
	onToggleReviewPanel,
}: {
	agent: Agent
	isEditingTitle: boolean
	titleValue: string
	titleInputRef: React.RefObject<HTMLInputElement | null>
	onTitleValueChange: (v: string) => void
	onStartEditing: () => void
	onConfirmTitle: () => void
	onCancelEditing: () => void
	onStop?: (agent: Agent) => Promise<void>
	onRename?: (agent: Agent, title: string) => Promise<void>
	isConnected?: boolean
	projectSlug?: string
	reviewPanelOpen: boolean
	onToggleReviewPanel: () => void
}) {
	const navigate = useNavigate()
	const diffStats = useAtomValue(sessionDiffStatsFamily(agent.sessionId))

	return (
		<div className="flex h-full w-full min-w-0 items-center gap-2.5">
			{/* App name */}
			<PalotWordmark className="hidden h-[11px] w-auto shrink-0 text-muted-foreground/70 md:block" />

			{/* Separator */}
			<div className="hidden h-3 w-px shrink-0 bg-border/60 md:block" />

			{/* Breadcrumb: project / [branch badge] / session name */}
			<div
				className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden"
				style={{
					// @ts-expect-error -- vendor-prefixed CSS property
					WebkitAppRegion: "no-drag",
				}}
			>
				{/* Project name */}
				<span className="hidden shrink-0 text-xs leading-none text-muted-foreground sm:inline">
					{agent.project}
				</span>

				{/* Worktree branch badge */}
				{agent.worktreeBranch && <WorktreeBranchBadge branch={agent.worktreeBranch} />}

				<span className="hidden shrink-0 text-xs leading-none text-muted-foreground/40 sm:inline">
					/
				</span>

				{/* Session name — click to edit */}
				{isEditingTitle ? (
					<div className="inline-grid min-w-0 max-w-full flex-1 items-center">
						{/* Ghost span — sizes the grid column to match the text width */}
						<span className="invisible col-start-1 row-start-1 truncate text-xs font-semibold leading-none">
							{titleValue}
						</span>
						<Input
							ref={titleInputRef}
							value={titleValue}
							onChange={(e) => onTitleValueChange(e.target.value)}
							onKeyDown={(e) => {
								e.stopPropagation()
								if (e.key === "Enter") onConfirmTitle()
								if (e.key === "Escape") onCancelEditing()
							}}
							onBlur={onConfirmTitle}
							className="col-start-1 row-start-1 h-7 min-w-0 border-none bg-transparent p-0 text-xs font-semibold leading-none shadow-none focus-visible:ring-0"
						/>
					</div>
				) : (
					<button
						type="button"
						onClick={onRename ? onStartEditing : undefined}
						className={`group flex min-w-0 flex-1 items-center gap-1.5 ${onRename ? "cursor-pointer" : "cursor-default"}`}
					>
						<h2 className="min-w-0 flex-1 truncate text-xs font-semibold leading-none">
							{agent.name}
						</h2>
						{onRename && (
							<PencilIcon className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
						)}
					</button>
				)}
			</div>

			{/* Right-aligned items */}
			<div
				className="flex min-w-0 shrink-0 items-center gap-2.5 overflow-hidden"
				style={{
					// @ts-expect-error -- vendor-prefixed CSS property
					WebkitAppRegion: "no-drag",
				}}
			>
				{/* Worktree actions (Apply to local, Commit & push) */}
				{agent.worktreePath && <WorktreeActions agent={agent} />}

				{agent.worktreePath && <div className="hidden h-3 w-px shrink-0 bg-border/60 md:block" />}

				{/* Review panel toggle with change stats badge */}
				<Tooltip>
					<TooltipTrigger
						render={
							<button
								type="button"
								onClick={onToggleReviewPanel}
								className={cn(
									"flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors",
									reviewPanelOpen
										? "bg-muted text-foreground"
										: "text-muted-foreground hover:bg-muted hover:text-foreground",
								)}
							/>
						}
					>
						<FileDiffIcon className="size-3.5" />
						{diffStats.fileCount > 0 && (
							<span className="flex items-center gap-1 text-[11px]">
								<span className="text-green-500">+{diffStats.additions}</span>
								<span className="text-red-500">-{diffStats.deletions}</span>
							</span>
						)}
					</TooltipTrigger>
					<TooltipContent>
						{reviewPanelOpen ? "Hide changes panel" : "Show changes panel"} (Cmd+Shift+D)
					</TooltipContent>
				</Tooltip>

				{/* Status dot + label */}
				<div className="hidden items-center gap-1.5 text-xs leading-none text-muted-foreground sm:flex">
					<span
						className={`inline-block size-1.5 rounded-full ${STATUS_DOT_COLOR[agent.status]}`}
					/>
					{STATUS_LABEL[agent.status]}
				</div>

				{/* Session metrics bar */}
				<div className="hidden min-w-0 shrink lg:block">
					<SessionMetricsBar sessionId={agent.sessionId} />
				</div>

				{/* Open in external editor */}
				<div className="hidden md:block">
					<OpenInButton directory={agent.worktreePath ?? agent.directory} />
				</div>

				{/* Open in terminal */}
				<div className="hidden md:block">
					<AttachCommand
						sessionId={agent.sessionId}
						directory={agent.worktreePath ?? agent.directory}
					/>
				</div>

				{/* Stop button (when running) */}
				{agent.status === "running" && (
					<Button
						size="sm"
						variant="ghost"
						className="h-7 gap-1 px-2 text-xs leading-none text-muted-foreground hover:text-red-400"
						onClick={() => onStop?.(agent)}
						disabled={!isConnected}
					>
						<SquareIcon className="size-3" />
						<span className="hidden sm:inline">Stop</span>
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
					className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
				>
					<XIcon className="size-3.5" />
				</button>
			</div>
		</div>
	)
}

// ============================================================
// Open in external editor/terminal
// ============================================================

// OpenInTarget type is provided by fetchOpenInTargets() via OpenInTargetsResult

/**
 * Renders a small app icon for a target. Uses runtime-resolved icon data URLs
 * from Electron's app.getFileIcon() API. Falls back to ExternalLinkIcon
 * if no icon data is available.
 */
function TargetIcon({ iconDataUrl, className }: { iconDataUrl?: string; className?: string }) {
	if (!iconDataUrl) return <ExternalLinkIcon className={className} />
	return (
		<img
			alt=""
			aria-hidden="true"
			src={iconDataUrl}
			className={cn("shrink-0 object-contain", className)}
		/>
	)
}

/**
 * Dropdown button that opens the project directory in an available editor,
 * terminal, or file manager. Fetches targets lazily on first open.
 *
 * The primary action (clicking the main button) opens in the preferred target.
 * The chevron opens a dropdown to choose a different target.
 */
function OpenInButton({ directory }: { directory: string }) {
	const [targets, setTargets] = useState<OpenInTarget[]>([])
	const [preferred, setPreferred] = useState<string | null>(null)
	const [loaded, setLoaded] = useState(false)
	const [opening, setOpening] = useState<string | null>(null)

	const loadTargets = useCallback(async () => {
		if (loaded) {
			return { targets, preferredTarget: preferred }
		}
		try {
			const result = await fetchOpenInTargets()
			const availableTargets = result.targets.filter((t) => t.available)
			setTargets(availableTargets)
			setPreferred(result.preferredTarget)
			setLoaded(true)
			return { targets: availableTargets, preferredTarget: result.preferredTarget }
		} catch {
			// Silently fail — button will show no targets
			setLoaded(true)
			return { targets: [], preferredTarget: null }
		}
	}, [loaded, preferred, targets])

	useEffect(() => {
		void loadTargets()
	}, [loadTargets])

	const handleOpen = useCallback(
		async (targetId: string) => {
			setOpening(targetId)
			try {
				await openInTarget(directory, targetId, true)
				setPreferred(targetId)
			} catch {
				// Silently fail
			} finally {
				setOpening(null)
			}
		},
		[directory],
	)

	const handlePrimaryClick = useCallback(async () => {
		const { targets: availableTargets, preferredTarget } = loaded
			? { targets, preferredTarget: preferred }
			: await loadTargets()
		const target = preferredTarget
			? availableTargets.find((t) => t.id === preferredTarget)
			: availableTargets[0]
		if (target) {
			await handleOpen(target.id)
		}
	}, [loaded, loadTargets, preferred, targets, handleOpen])

	// Don't show on non-Electron
	if (!isElectron) return null

	// Resolve the preferred target's icon data URL for the primary button
	const preferredTarget = targets.find((t) => t.id === preferred)

	return (
		<div className="flex items-center rounded-md border border-border/60">
			<button
				type="button"
				onClick={handlePrimaryClick}
				disabled={opening !== null}
				className="flex items-center gap-1.5 rounded-l-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
			>
				{preferredTarget?.iconDataUrl ? (
					<TargetIcon iconDataUrl={preferredTarget.iconDataUrl} className="size-3.5" />
				) : (
					<ExternalLinkIcon className="size-3" />
				)}
				<span>Open</span>
			</button>

			<DropdownMenu onOpenChange={(open) => open && loadTargets()}>
				<DropdownMenuTrigger
					render={
						<button
							type="button"
							className="rounded-r-md border-l border-border/60 px-1 py-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
						/>
					}
				>
					<ChevronDownIcon className="size-3" />
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="min-w-[180px]">
					{!loaded ? (
						<DropdownMenuItem disabled>Loading...</DropdownMenuItem>
					) : targets.length === 0 ? (
						<DropdownMenuItem disabled>No editors found</DropdownMenuItem>
					) : (
						<>
							{targets.map((target) => (
								<DropdownMenuItem
									key={target.id}
									onClick={() => handleOpen(target.id)}
									disabled={opening === target.id}
									className="flex items-center gap-2"
								>
									<TargetIcon iconDataUrl={target.iconDataUrl} className="size-4" />
									<span className="flex-1">{target.label}</span>
									{preferred === target.id && (
										<CheckIcon className="size-3 shrink-0 text-muted-foreground/60" />
									)}
								</DropdownMenuItem>
							))}
							<DropdownMenuSeparator />
							<DropdownMenuItem disabled className="text-[11px] text-muted-foreground/50">
								{directory}
							</DropdownMenuItem>
						</>
					)}
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	)
}

/**
 * Compact badge showing the worktree branch name with a copy action.
 */
function WorktreeBranchBadge({ branch }: { branch: string }) {
	const [copied, setCopied] = useState(false)

	const handleCopy = useCallback(async () => {
		await navigator.clipboard.writeText(branch)
		setCopied(true)
		setTimeout(() => setCopied(false), 2000)
	}, [branch])

	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<button
						type="button"
						onClick={handleCopy}
						className="flex shrink-0 items-center gap-1 rounded-md bg-muted/60 px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
					/>
				}
			>
				<GitForkIcon className="size-2.5" aria-hidden="true" />
				<span className="max-w-[120px] truncate">{branch}</span>
				{copied && <CheckIcon className="size-2.5 text-green-500" />}
			</TooltipTrigger>
			<TooltipContent>Click to copy branch name</TooltipContent>
		</Tooltip>
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
				<TooltipTrigger
					render={
						<PopoverTrigger
							render={
								<button
									type="button"
									className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
								/>
							}
						/>
					}
				>
					<TerminalIcon className="size-3.5" />
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
