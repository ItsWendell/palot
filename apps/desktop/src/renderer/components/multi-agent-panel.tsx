import {
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
} from "@palot/ui/components/sidebar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@palot/ui/components/tooltip"
import { cn } from "@palot/ui/lib/utils"
import { useNavigate, useParams } from "@tanstack/react-router"
import { useAtomValue, useSetAtom } from "jotai"
import {
	AlertCircleIcon,
	CheckCircle2Icon,
	CircleDotIcon,
	InboxIcon,
	Loader2Icon,
	PlusIcon,
	TimerIcon,
	UserIcon,
	XIcon,
	ZapIcon,
} from "lucide-react"
import type React from "react"
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { SubAgentEntry } from "../atoms/sub-agents"
import { childSessionsFamily } from "../atoms/sub-agents"
import { messagesFamily } from "../atoms/messages"
import { partsFamily } from "../atoms/parts"
import { appStore } from "../atoms/store"
import { sessionMetricsFamily } from "../atoms/derived/session-metrics"
import { contextCompactionActionFamily } from "../atoms/context-compaction"
import { sessionFamily } from "../atoms/sessions"
import { useAgentActions } from "../hooks/use-server"
import {
	getAgentStatusBadgeClass,
	getAgentStatusLabel,
	getBudgetDisplay,
} from "../lib/agent-progress-display"
import { PipelineProgress } from "./pipeline-progress"
import {
	evaluateAgentHeartbeat,
	type AgentHeartbeatStatus,
} from "../lib/agent-heartbeat"
import { createLogger } from "../lib/logger"
import { useAgentRecovery } from "../hooks/use-agent-recovery"
import { useSubAgentCompletion } from "../hooks/use-subagent-completion"
import type { KnowledgeSource } from "../../shared/knowledge"
import {
	getBrainContextSummary,
	getKnowledgeSource,
	isElectron,
	listAgents,
	listAllSkills,
	mem9Recall,
	readBrainFile,
	writeBrainFile,
} from "../services/backend"
import {
	SPAWN_TEAM_TEMPLATES,
	markRequestApproved,
	parseSpawnRequests,
	parseSpawnRequestsFromText,
	pendingRequests,
} from "../lib/pending-spawn-queue"
import type { SpawnRequest } from "../lib/pending-spawn-queue"
import type { ManagedAgent } from "../../shared/agents"
import { useMem9MemoryStorage } from "../hooks/use-mem9-memory"
import { TeamRoster } from "./team-roster"
import { recoveryConfigFamily, recoveryStateFamily } from "../atoms/session-heartbeats"
import { supervisionEventsForWorkflowFamily } from "../atoms/supervision-events"
import type { AgentStatus, ToolPart } from "../lib/types"
import { formatCost, formatTokens, formatWorkDuration } from "../lib/session-metrics"
import { evaluateAgentWorkflowPolicy } from "../lib/agent-workflow-policy"
import { DEFAULT_SUPERVISION_POLICY, evaluateSupervisionPolicy } from "../lib/supervision-policy"
import { buildHiveSpawnPrompt } from "../lib/hive-spawn-prompt"

const log = createLogger("multi-agent-panel")
const TEAM_AGENT_NAMES = new Set(
	Object.values(SPAWN_TEAM_TEMPLATES).flatMap((template) =>
		template.agents.map((agent) => agent.toLowerCase()),
	),
)

/** Parse "providerID/modelID" from a model string like "openrouter/deepseek/deepseek-chat". */
function parseModelString(model: string): { providerID: string; modelID: string } | null {
	const parts = model.split("/")
	if (parts.length < 2) return null
	return { providerID: parts[0], modelID: parts.slice(1).join("/") }
}

function formatErrorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err)
}

function createFallbackTeamAgent(agentName: string, reason: string): ManagedAgent | null {
	if (!TEAM_AGENT_NAMES.has(agentName.toLowerCase())) {
		return null
	}

	return {
		filename: agentName,
		name: agentName,
		description: reason,
		model: "",
		mode: "subagent",
		color: "",
		raw: "",
		prompt: "",
		origin: "builtin",
	}
}

// ============================================================
// Status display helpers
// ============================================================

function statusIcon(status: AgentStatus): typeof Loader2Icon {
	switch (status) {
		case "running":
			return Loader2Icon
		case "waiting":
			return TimerIcon
		case "failed":
			return AlertCircleIcon
		case "completed":
		case "idle":
		case "paused":
			return CheckCircle2Icon
		default:
			return CircleDotIcon
	}
}

function statusColor(status: AgentStatus): string {
	switch (status) {
		case "running":
			return "text-emerald-400"
		case "waiting":
			return "text-amber-400"
		case "failed":
			return "text-red-400"
		default:
			return "text-muted-foreground/50"
	}
}

function statusAnimate(status: AgentStatus): string {
	if (status === "running") return "animate-spin"
	if (status === "waiting") return "animate-pulse"
	return ""
}

function heartbeatClass(status: AgentHeartbeatStatus): string {
	switch (status) {
		case "ACTIVE":
			return "bg-emerald-400"
		case "STALLED":
			return "bg-amber-400"
		case "UNRESPONSIVE":
			return "bg-red-400"
		default:
			return "bg-muted-foreground/30"
	}
}

function useHeartbeatNow(): number {
	const [now, setNow] = useState(() => Date.now())
	useEffect(() => {
		const id = setInterval(() => setNow(Date.now()), 30_000)
		return () => clearInterval(id)
	}, [])
	return now
}

// ============================================================
// MultiAgentPanel
// ============================================================

interface MultiAgentPanelProps {
	parentSessionId: string
}

/**
 * Sidebar panel showing live sub-agent status for a Lead Agent session.
 * Only renders when there are child sessions.
 */
export const MultiAgentPanel = memo(function MultiAgentPanel({
	parentSessionId,
}: MultiAgentPanelProps) {
	const children = useAtomValue(childSessionsFamily(parentSessionId))
	const parentEntry = useAtomValue(sessionFamily(parentSessionId))
	const parentMetrics = useAtomValue(sessionMetricsFamily(parentSessionId))
	const compactionAction = useAtomValue(contextCompactionActionFamily(parentSessionId))
	const recentEvents = useAtomValue(supervisionEventsForWorkflowFamily(parentSessionId))
	const now = useHeartbeatNow()
	const { abort, sendPrompt, createSession } = useAgentActions()
	const recoveryConfig = useAtomValue(recoveryConfigFamily(parentSessionId))
	const setRecoveryConfig = useSetAtom(recoveryConfigFamily(parentSessionId))

	const [rosterOpen, setRosterOpen] = useState(false)

	// Load agent metadata for team-aware pipeline display and performance records
	const [knownAgents, setKnownAgents] = useState<ManagedAgent[]>([])
	useEffect(() => {
		listAgents(parentEntry?.directory ?? undefined)
			.then(setKnownAgents)
			.catch((err) => {
				log.warn("Failed to load agent metadata for team-aware pipeline", {
					error: formatErrorMessage(err),
				})
			})
	}, [parentEntry?.directory])

	const knownAgentKeys = useMemo(() => {
		const keys = new Set<string>()
		for (const agent of knownAgents) {
			keys.add(agent.filename.toLowerCase())
			keys.add(agent.name.toLowerCase())
		}
		return keys
	}, [knownAgents])

	// Feature 7: auto-record subagent completions to supervisor state
	useSubAgentCompletion(parentSessionId, parentEntry?.directory, knownAgents)

	// Mem9: auto-store subagent completions as persistent memories
	useMem9MemoryStorage(parentSessionId, parentEntry?.directory)

	// Auto-recovery loop for stalled/unresponsive child sessions
	useAgentRecovery(parentSessionId, parentEntry?.directory ?? "")

	// Pending spawn queue — poll brain/spawn-requests.md for Lead Agent spawn requests (backup path)
	const [brainSpawns, setBrainSpawns] = useState<SpawnRequest[]>([])
	useEffect(() => {
		const dir = parentEntry?.directory
		if (!dir || !isElectron) return
		let mounted = true
		const poll = () => {
			readBrainFile("spawn-requests", dir).then((content) => {
				if (!mounted) return
				setBrainSpawns(pendingRequests(parseSpawnRequests(content)))
			}).catch((err) => {
				if (mounted) log.warn("Failed to poll spawn-requests brain file", { error: String(err) })
			})
		}
		poll()
		const id = setInterval(poll, 10_000)
		return () => { mounted = false; clearInterval(id) }
	}, [parentEntry?.directory])

	// Message-based spawn detection (primary path) — watches Lead Agent output in real time
	const leadMessages = useAtomValue(messagesFamily(parentSessionId))
	const [messageSpawns, setMessageSpawns] = useState<SpawnRequest[]>([])
	const seenBlockKeysRef = useRef(new Set<string>())
	const approvedIdsRef = useRef(new Set<string>())

	useEffect(() => {
		const newRequests: SpawnRequest[] = []
		for (const msg of leadMessages) {
			if (msg.role !== "assistant") continue
			const parts = appStore.get(partsFamily(msg.id))
			for (const part of parts) {
				if (part.type !== "text" || !("text" in part)) continue
				const parsed = parseSpawnRequestsFromText((part as { type: "text"; text: string }).text)
				for (const req of parsed) {
					// Deduplicate by agent+reason key so re-renders don't add duplicates
					const key = `${req.agent}::${req.reason}`
					if (seenBlockKeysRef.current.has(key)) continue
					seenBlockKeysRef.current.add(key)
					newRequests.push(req)
				}
			}
		}
		if (newRequests.length > 0) {
			setMessageSpawns((prev) => [...prev, ...newRequests])
		}
	// Also re-run when the lead session finishes responding — parts are populated
	// during streaming but leadMessages only changes when a message is added, not
	// when parts update. Watching status.type catches the streaming-complete event.
	}, [leadMessages, parentSessionId, parentEntry?.status.type])

	// Merge both sources; filter out already-approved requests; deduplicate by agent name
	const allPendingSpawns = useMemo(() => {
		const combined = [
			...messageSpawns.filter((r) => !approvedIdsRef.current.has(r.id)),
			...brainSpawns,
		]
		const seen = new Set<string>()
		return combined.filter((r) => {
			if (seen.has(r.agent)) return false
			seen.add(r.agent)
			return true
		})
	}, [messageSpawns, brainSpawns])

	const validPendingSpawns = useMemo(() => {
		if (knownAgentKeys.size === 0) return allPendingSpawns
		return allPendingSpawns.filter((request) => knownAgentKeys.has(request.agent.toLowerCase()))
	}, [allPendingSpawns, knownAgentKeys])

	const invalidPendingSpawns = useMemo(() => {
		if (knownAgentKeys.size === 0) return []
		return allPendingSpawns.filter((request) => !knownAgentKeys.has(request.agent.toLowerCase()))
	}, [allPendingSpawns, knownAgentKeys])

	const isIdle = children.length === 0 && parentMetrics.tokensRaw === 0

	const parentStatus: AgentStatus =
		(parentEntry?.permissions.length ?? 0) > 0 || (parentEntry?.questions.length ?? 0) > 0
			? "waiting"
			: parentEntry?.status.type === "busy" || parentEntry?.status.type === "retry"
				? "running"
				: parentMetrics.errorCount > 0
					? "failed"
					: parentMetrics.assistantMessageCount > 0
						? "completed"
						: "idle"

	const lead: SubAgentEntry = {
		sessionId: parentSessionId,
		name: "Lead-Agent",
		agentStatus: parentStatus,
		activity:
			parentStatus === "running"
				? "Coordinating the hive"
				: parentStatus === "waiting"
					? "Waiting for user input"
					: parentStatus === "completed"
						? "Ready for the next instruction"
						: parentStatus === "failed"
							? "Stopped with an error"
							: "Idle",
		model: parentMetrics.modelDistributionDisplay[0]?.name ?? null,
		duration: parentMetrics.workTime,
		durationMs: parentMetrics.workTimeMs,
		costRaw: parentMetrics.costRaw,
		cost: parentMetrics.cost,
		tokensRaw: parentMetrics.tokensRaw,
		tokens: parentMetrics.tokens,
		toolCallCount: parentMetrics.toolCallCount,
		errorCount: parentMetrics.errorCount,
		retryCount: parentMetrics.retryCount,
		errorMessage: parentEntry?.error?.name ?? null,
		lastActivityAt: parentEntry
			? Math.max(parentEntry.session.time.updated, parentEntry.session.time.created)
			: Date.now(),
		directory: parentEntry?.directory ?? "",
	}

	const entries = [lead, ...children]
	const totalCost = entries.reduce((sum, c) => sum + c.costRaw, 0)
	const totalTokens = entries.reduce((sum, c) => sum + c.tokensRaw, 0)
	const totalCostFormatted = formatCost(totalCost)
	const totalTokensFormatted = formatTokens(totalTokens)
	const anyRunning = entries.some((c) => c.agentStatus === "running")
	const runningChildren = children.filter((c) => c.agentStatus === "running").length
	const completedChildren = children.filter((c) => c.agentStatus === "completed").length
	const failedChildren = children.filter((c) => c.agentStatus === "failed").length
	const workflowPolicy = evaluateAgentWorkflowPolicy({
		workflowKind: runningChildren > 1 ? "research" : "shared_write",
		runningAgentCount: runningChildren,
		maxConcurrentAgents: DEFAULT_SUPERVISION_POLICY.maxConcurrentAgents,
		hasFileLocking: false,
		hasIsolatedFileOwnership: false,
	})
	const budget = getBudgetDisplay(totalCost)
	const policy = evaluateSupervisionPolicy({
		workflowId: parentSessionId,
		parentAgentId: parentSessionId,
		totalCost,
		totalTokens,
		childAgentCount: children.length,
		runningAgentCount: children.filter((c) => c.agentStatus === "running").length,
		failedAgentCount: children.filter((c) => c.agentStatus === "failed").length,
		waitingAgentCount: children.filter((c) => c.agentStatus === "waiting").length,
		configuredBudget: DEFAULT_SUPERVISION_POLICY.configuredBudget,
		maxChildren: DEFAULT_SUPERVISION_POLICY.maxChildren,
		maxConcurrentAgents: DEFAULT_SUPERVISION_POLICY.maxConcurrentAgents,
		currentAgentState:
			parentStatus === "running"
				? "running"
				: parentStatus === "waiting"
					? "waiting"
					: parentStatus === "failed"
						? "failed"
						: parentStatus === "completed"
							? "completed"
							: "idle",
	})
	const supervisorClass =
		policy.severity === "critical"
			? "border-red-400/30 bg-red-400/10 text-red-200"
			: policy.severity === "warning"
				? "border-amber-400/30 bg-amber-400/10 text-amber-200"
				: "border-border/30 bg-muted/15 text-muted-foreground"

	const handleSpawn = useCallback(
		async (
			dir: string,
			_sessionId: string,
			agentName: string,
			_agentDescription: string,
			agentModel: string,
			_agentPrompt: string,
			customInstruction: string,
			knowledgeFilenames?: string[],
			skillFilenames?: string[],
		) => {
			// Create a child session linked to the Lead
			const child = await createSession(dir, agentName, parentSessionId)
			if (!child) {
				throw new Error(`Failed to create session for ${agentName}`)
			}

			const contextWarnings: string[] = []
			const [brainContext, allSkills] = await Promise.all([
				getBrainContextSummary(dir, parentSessionId).catch((err) => {
					const message = `Brain context unavailable: ${formatErrorMessage(err)}`
					contextWarnings.push(message)
					log.warn("Failed to load Brain context for spawned agent", {
						agentName,
						error: formatErrorMessage(err),
					})
					return null
				}),
				listAllSkills().catch((err) => {
					const message = `Skill list unavailable: ${formatErrorMessage(err)}`
					contextWarnings.push(message)
					log.warn("Failed to load skills for spawned agent", {
						agentName,
						error: formatErrorMessage(err),
					})
					return []
				}),
			])
			const skills = skillFilenames ? allSkills.filter((s) => skillFilenames.includes(s.filename)) : allSkills

			let memories: string | null = null
			try {
				const recallQuery = [agentName, customInstruction, agentName].filter(Boolean).join(" ")
				memories = await mem9Recall(recallQuery, 5)
			} catch (err) {
				const message = `Mem9 recall unavailable: ${formatErrorMessage(err)}`
				contextWarnings.push(message)
				log.warn("Failed to recall Mem9 memories for spawned agent", {
					agentName,
					error: formatErrorMessage(err),
				})
			}

			let knowledgeSections: Array<{ title: string; prompt: string }> = []
			if (knowledgeFilenames && knowledgeFilenames.length > 0) {
				const sourceResults = await Promise.allSettled(
					knowledgeFilenames.map((filename) => getKnowledgeSource(filename, dir)),
				)
				const validSources: KnowledgeSource[] = []
				for (let i = 0; i < sourceResults.length; i++) {
					const result = sourceResults[i]
					const filename = knowledgeFilenames[i]
					if (result.status === "fulfilled" && result.value) {
						validSources.push(result.value)
						continue
					}

					const reason =
						result.status === "rejected" ? formatErrorMessage(result.reason) : "source not found"
					const message = `Knowledge source ${filename} unavailable: ${reason}`
					contextWarnings.push(message)
					log.warn("Failed to load knowledge source for spawned agent", {
						agentName,
						filename,
						error: reason,
					})
				}
				knowledgeSections = validSources.map((src) => ({ title: src.title, prompt: src.prompt }))
			}

			const prompt = buildHiveSpawnPrompt({
				agentName,
				agentDescription: _agentDescription,
				agentSystemPrompt: _agentPrompt || undefined,
				customInstruction,
				brainContext,
				memories,
				knowledgeSections,
				skills,
				warnings: contextWarnings,
			})

			// Nexus Builder builtin specialists are injected through the spawn prompt.
			// Do not pass the Nexus Builder agent name as an OpenCode-native agent id;
			// OpenCode only knows agents registered in its own config.
			const model = agentModel ? parseModelString(agentModel) : undefined
			await sendPrompt(dir, child.id, prompt, {
				model: model ?? undefined,
			})
		},
		[parentSessionId, createSession, sendPrompt],
	)

	const handleApproveSpawn = useCallback(async (request: SpawnRequest) => {
		const dir = parentEntry?.directory
		if (!dir) return
		const agent = knownAgents.find((a) => a.filename === request.agent || a.name.toLowerCase() === request.agent.toLowerCase())
			?? createFallbackTeamAgent(request.agent, request.reason)
		if (!agent) {
			log.warn("Ignoring spawn request for unknown agent", { agent: request.agent })
			return
		}
		try {
			await handleSpawn(
				dir,
				parentSessionId,
				agent.name,
				agent.description,
				agent.model,
				agent.prompt,
				request.task || request.reason,
			)
			// Track as approved so it disappears from the queue immediately
			approvedIdsRef.current.add(request.id)
			// Also update brain file if this was a brain-file request
			if (!request.id.startsWith("msg:")) {
				const content = await readBrainFile("spawn-requests", dir)
				if (content) {
					await writeBrainFile("spawn-requests", markRequestApproved(content, request.id), dir)
				}
				setBrainSpawns((prev) => prev.filter((r) => r.id !== request.id))
			} else {
				setMessageSpawns((prev) => prev.filter((r) => r.id !== request.id))
			}
		} catch (err) {
			log.error("Failed to approve spawn request", { agent: request.agent }, err)
		}
	}, [parentEntry?.directory, parentSessionId, knownAgents, handleSpawn])

	return (
		<SidebarGroup>
			<SidebarGroupLabel className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest">
				<span
					className={cn(
						"size-2 rounded-full",
						anyRunning
							? "animate-pulse bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.7)]"
							: "bg-muted-foreground/30",
					)}
					aria-hidden="true"
				/>
				Hive Mind
				<ZapIcon className="size-3 text-muted-foreground/40" aria-hidden="true" />
				{!isIdle && (
					<Tooltip>
						<TooltipTrigger
							render={
								<button
									type="button"
									onClick={() => setRosterOpen((v) => !v)}
									className="ml-auto flex size-4 items-center justify-center rounded text-muted-foreground/50 transition-colors hover:bg-muted/40 hover:text-muted-foreground"
									aria-label={rosterOpen ? "Close agent roster" : "Add agent"}
								>
									{rosterOpen ? <XIcon className="size-3" /> : <PlusIcon className="size-3" />}
								</button>
							}
						/>
						<TooltipContent side="right">{rosterOpen ? "Close roster" : "Add agent"}</TooltipContent>
					</Tooltip>
				)}
			</SidebarGroupLabel>
			<SidebarGroupContent>
				<div className="space-y-1 px-2 pb-1">
					{isIdle ? (
						/* Idle state — large invitation to spawn agents */
						<div className="px-1 py-2">
							<p className="mb-2 text-[10px] leading-relaxed text-muted-foreground/60">
								Your team is ready. Spawn agents to start building.
							</p>
							<TeamRoster
								directory={parentEntry?.directory ?? ""}
								sessionId={parentSessionId}
								onSpawn={handleSpawn}
							/>
						</div>
					) : (
						<>
					{/* Lead row always renders first */}
					<SubAgentRow
						key={lead.sessionId}
						entry={lead}
						totalTokens={totalTokens}
						now={now}
						onRestart={async (target) => {
							try {
								await abort(target.directory, target.sessionId)
								await sendPrompt(
									target.directory,
									target.sessionId,
									"Restart from the last known objective. Summarize current state first, then continue with the next safe step.",
								)
							} catch (err) {
								log.error("restart stalled agent failed", { sessionId: target.sessionId }, err)
							}
						}}
						onTerminate={async (target) => {
							try {
								await abort(target.directory, target.sessionId)
							} catch (err) {
								log.error("terminate stalled agent failed", { sessionId: target.sessionId }, err)
							}
						}}
					/>

					{/* Pipeline visualization — shows Lead → Architect → Builder → Reviewer flow */}
					<PipelineProgress
						children={children}
						parentStatus={
							parentStatus === "idle"
								? "completed"
								: parentStatus === "waiting"
									? "pending"
									: parentStatus
						}
						parentCost={parentMetrics.costRaw}
						parentTokens={parentMetrics.tokensRaw}
						knownAgents={knownAgents}
					/>

					{/* Child sub-agent rows */}
					{children.map((entry) => (
						<SubAgentRow
							key={entry.sessionId}
							entry={entry}
							totalTokens={totalTokens}
							now={now}
							onRestart={async (target) => {
								try {
									await abort(target.directory, target.sessionId)
									await sendPrompt(
										target.directory,
										target.sessionId,
										"Restart from the last known objective. Summarize current state first, then continue with the next safe step.",
									)
								} catch (err) {
									log.error("restart stalled agent failed", { sessionId: target.sessionId }, err)
								}
							}}
							onTerminate={async (target) => {
								try {
									await abort(target.directory, target.sessionId)
								} catch (err) {
									log.error("terminate stalled agent failed", { sessionId: target.sessionId }, err)
								}
							}}
						/>
					))}
					{policy.decision !== "allow" && (
						<div className={cn("rounded-md border px-2.5 py-2 text-[10px]", supervisorClass)}>
							<div className="flex items-center justify-between gap-2">
								<span className="font-semibold uppercase tracking-wide">
									{policy.decision.toUpperCase()}
								</span>
								<span className="tabular-nums">{policy.machineCode.replace("SUPERVISION_", "")}</span>
							</div>
							<p className="mt-1 leading-snug">{policy.operatorMessage}</p>
							<p className="mt-1 leading-snug opacity-80">{policy.recommendedAction}</p>
						</div>
					)}
					{children.length > 0 && (
						<div className="rounded-md border border-border/30 bg-muted/15 px-2.5 py-2 text-[10px]">
							<div className="flex items-center justify-between gap-2">
								<span className="font-semibold uppercase tracking-wide text-muted-foreground">
									Execution
								</span>
								<span className="font-medium uppercase tabular-nums text-muted-foreground/70">
									{workflowPolicy.mode}
								</span>
							</div>
							<p className="mt-1 leading-snug text-muted-foreground/70">
								Parallel is supported for planning, research, docs, and isolated file ownership.
								Shared writes stay sequential unless locking is available.
							</p>
							<div className="mt-2 flex items-center justify-between gap-2 border-t border-border/20 pt-2">
								<span className="font-medium text-muted-foreground">Auto-recovery</span>
								<button
									type="button"
									onClick={() =>
										setRecoveryConfig((prev) => ({ ...prev, enabled: !prev.enabled }))
									}
									className={cn(
										"rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide transition-colors",
										recoveryConfig.enabled
											? "border border-emerald-400/30 bg-emerald-400/20 text-emerald-300"
											: "border border-border/30 bg-muted/30 text-muted-foreground/60",
									)}
								>
									{recoveryConfig.enabled ? "ON" : "OFF"}
								</button>
							</div>
						</div>
					)}
					{recentEvents.length > 0 && (
						<div className="rounded-md border border-border/30 bg-muted/15 px-2.5 py-2 text-[10px]">
							<div className="mb-1 font-semibold uppercase tracking-wide text-muted-foreground">
								Recent enforcement
							</div>
							<div className="space-y-1.5">
								{recentEvents.map((event) => (
									<div key={event.id} className="leading-snug">
										<div className="flex items-center justify-between gap-2">
											<span
												className={cn(
													"font-semibold uppercase",
													event.severity === "critical"
														? "text-red-300"
														: "text-amber-300",
												)}
											>
												{event.decision}
											</span>
											<span className="truncate text-muted-foreground/60">
												{event.machineCode.replace("SUPERVISION_", "")}
											</span>
										</div>
										<p className="text-muted-foreground/80">{event.operatorMessage}</p>
										<p className="text-muted-foreground/55">{event.recommendedAction}</p>
									</div>
								))}
							</div>
						</div>
					)}
					<div className="mt-2 rounded-md border border-border/30 bg-muted/15 px-2.5 py-2 space-y-1.5">
						{children.length > 0 && (
							<div className="flex items-center justify-between gap-2 text-[10px]">
								<span className="font-medium text-muted-foreground">
									{children.length} agent{children.length !== 1 ? "s" : ""} spawned
								</span>
								<div className="flex items-center gap-1">
									{runningChildren > 0 && (
										<span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-1.5 py-0.5 text-[9px] font-medium text-emerald-300">
											{runningChildren} running
										</span>
									)}
									{completedChildren > 0 && (
										<span className="rounded-full border border-border/30 bg-muted/30 px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
											{completedChildren} done
										</span>
									)}
									{failedChildren > 0 && (
										<span className="rounded-full border border-red-400/30 bg-red-400/10 px-1.5 py-0.5 text-[9px] font-medium text-red-300">
											{failedChildren} failed
										</span>
									)}
								</div>
							</div>
						)}
						<div className="flex items-center justify-between gap-2">
							<span className="text-[11px] text-muted-foreground">Session spend</span>
							<span className="text-sm font-semibold tabular-nums text-foreground">
								{totalCostFormatted}
							</span>
						</div>
						<div className="flex items-center justify-between gap-2 text-[10px]">
							<span className="tabular-nums text-muted-foreground/60">
								{totalTokensFormatted} tokens
							</span>
							<span
								className={cn(
									"rounded-full border px-1.5 py-0.5 font-medium",
									budget.badgeClassName,
								)}
							>
								{budget.label}
							</span>
						</div>
					</div>
				</>
			)}
					{/* Pending spawn requests from the Lead Agent */}
					{validPendingSpawns.length > 0 && (
						<div className="rounded-md border border-amber-400/20 bg-amber-400/5 px-2.5 py-2 text-[10px]">
							<div className="mb-1.5 flex items-center justify-between gap-2">
								<div className="flex items-center gap-1 font-semibold uppercase tracking-wide text-amber-300/80">
									<InboxIcon className="size-3" aria-hidden="true" />
									Requested Agents ({validPendingSpawns.length})
								</div>
								{validPendingSpawns.length > 1 && (
									<button
										type="button"
										onClick={async () => { for (const req of validPendingSpawns) await handleApproveSpawn(req) }}
										className="rounded border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-300 transition-colors hover:bg-amber-400/20"
									>
										Approve All
									</button>
								)}
							</div>
							<div className="space-y-1.5">
								{validPendingSpawns.map((req) => (
									<div key={req.id} className="flex items-start justify-between gap-2">
										<div className="min-w-0">
											<p className="truncate font-medium text-foreground/80">{req.agent}</p>
											{req.reason && req.reason !== req.task && (
												<p className="truncate text-[9px] text-muted-foreground/50 uppercase tracking-wide">{req.reason}</p>
											)}
											{req.task && (
												<p className="truncate text-muted-foreground/60">{req.task}</p>
											)}
										</div>
										<button
											type="button"
											onClick={() => handleApproveSpawn(req)}
											className="shrink-0 rounded border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-300 transition-colors hover:bg-amber-400/20"
										>
											Spawn
										</button>
									</div>
								))}
							</div>
						</div>
					)}
					{invalidPendingSpawns.length > 0 && (
						<div className="rounded-md border border-red-400/20 bg-red-400/5 px-2.5 py-2 text-[10px]">
							<div className="mb-1 font-semibold uppercase tracking-wide text-red-300/80">
								Unknown Agent Requests ({invalidPendingSpawns.length})
							</div>
							<div className="space-y-1">
								{invalidPendingSpawns.map((req) => (
									<div key={req.id} className="min-w-0">
										<p className="truncate font-medium text-red-200/90">{req.agent}</p>
										<p className="truncate text-red-200/55">{req.task || req.reason}</p>
									</div>
								))}
							</div>
						</div>
					)}
					{compactionAction.state || compactionAction.error ? (
						<div className="rounded-md border border-border/30 bg-muted/15 px-2.5 py-2 text-[10px]">
							<div className="font-semibold uppercase tracking-wide text-muted-foreground">
								Context
							</div>
							<p className="mt-1 leading-snug text-muted-foreground/70">
								{compactionAction.error
									? `Compaction failed: ${compactionAction.error}`
									: compactionAction.state === "AUTO_COMPACTING"
										? "Compacting context and writing a brain snapshot."
										: "Context compacted; saved brain context will be restored on the next send."}
							</p>
						</div>
					) : null}

					{/* Team roster — shown when + button pressed during active sessions */}
					{!isIdle && rosterOpen && (
						<div className="rounded-md border border-border/30 bg-muted/10 px-2.5 py-2">
							<p className="mb-2 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
								<UserIcon className="size-3" aria-hidden="true" />
								Add Agent
							</p>
							<TeamRoster
								directory={parentEntry?.directory ?? ""}
								sessionId={parentSessionId}
								onSpawn={async (...args) => {
									await handleSpawn(...args)
									setRosterOpen(false)
								}}
							/>
						</div>
					)}
				</div>
			</SidebarGroupContent>
		</SidebarGroup>
	)
})

// ============================================================
// Agent activity timeline (last 5 tool calls)
// ============================================================

function AgentActivityTimeline({ sessionId }: { sessionId: string }) {
	const messages = useAtomValue(messagesFamily(sessionId))
	const [open, setOpen] = useState(false)

	const toolCalls = useMemo(() => {
		const results: { id: string; name: string; status: "running" | "completed" | "error" }[] = []
		for (const msg of messages) {
			const parts = appStore.get(partsFamily(msg.id))
			for (const part of parts) {
				if (part.type === "tool") {
					const tp = part as ToolPart
					const s = (tp.state as { status?: string } | undefined)?.status
					results.push({
						id: tp.id,
						name: tp.tool,
						status: s === "error" ? "error" : s === "running" ? "running" : "completed",
					})
				}
			}
		}
		return results.slice(-5)
	}, [messages])

	if (toolCalls.length === 0) return null

	return (
		<div className="ml-5 mt-0.5">
			<button
				type="button"
				onClick={(e) => {
					e.stopPropagation()
					setOpen((o) => !o)
				}}
				className="text-[10px] text-muted-foreground/45 hover:text-muted-foreground/65 transition-colors"
			>
				{open ? "▾" : "▸"} {toolCalls.length} recent calls
			</button>
			{open && (
				<ul className="mt-0.5 space-y-px pl-1">
					{toolCalls.map((tc) => (
						<li key={tc.id} className="flex items-center gap-1 text-[10px] text-muted-foreground/55">
							<span
								className={
									tc.status === "error"
										? "text-red-400"
										: tc.status === "running"
											? "text-emerald-400 animate-pulse"
											: "text-muted-foreground/30"
								}
							>
								{tc.status === "error" ? "✕" : tc.status === "running" ? "●" : "○"}
							</span>
							<span className="font-mono">{tc.name}</span>
						</li>
					))}
				</ul>
			)}
		</div>
	)
}

// ============================================================
// Per-sub-agent row
// ============================================================

function SubAgentRow({
	entry,
	totalTokens,
	now,
	onRestart,
	onTerminate,
}: {
	entry: SubAgentEntry
	totalTokens: number
	now: number
	onRestart: (entry: SubAgentEntry) => Promise<void>
	onTerminate: (entry: SubAgentEntry) => Promise<void>
}) {
	const navigate = useNavigate()
	const { projectSlug } = useParams({ strict: false }) as { projectSlug?: string }
	const childRecoveryState = useAtomValue(recoveryStateFamily(entry.sessionId))

	const Icon = statusIcon(entry.agentStatus)
	const iconColor = statusColor(entry.agentStatus)
	const iconAnim = statusAnimate(entry.agentStatus)
	const heartbeat = evaluateAgentHeartbeat({
		agentStatus: entry.agentStatus,
		lastActivityAt: entry.lastActivityAt,
		now,
	})
	const progress =
		totalTokens > 0 ? Math.max(4, Math.min(100, (entry.tokensRaw / totalTokens) * 100)) : 0

	const handleClick = () => {
		if (!projectSlug) return
		navigate({
			to: "/project/$projectSlug/session/$sessionId",
			params: { projectSlug, sessionId: entry.sessionId },
		})
	}
	const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
		if (event.key === "Enter" || event.key === " ") {
			event.preventDefault()
			handleClick()
		}
	}
	const handleRestart = (event: React.MouseEvent<HTMLButtonElement>) => {
		event.stopPropagation()
		onRestart(entry)
	}
	const handleTerminate = (event: React.MouseEvent<HTMLButtonElement>) => {
		event.stopPropagation()
		onTerminate(entry)
	}

	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<div
						role="button"
						tabIndex={0}
						onClick={handleClick}
						onKeyDown={handleKeyDown}
						className="group/agent w-full rounded-md border border-transparent px-2 py-1.5 text-left transition-colors hover:border-border/40 hover:bg-muted/45"
					/>
				}
			>
				<div className="space-y-1">
					<div className="flex items-center gap-2">
						<span
							className={cn("size-1.5 rounded-full", heartbeatClass(heartbeat.status))}
							aria-hidden="true"
						/>
						<Icon
							className={`size-3 shrink-0 ${iconColor} ${iconAnim}`}
							aria-hidden="true"
						/>
						<span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground/85">
							{entry.name}
						</span>
						<span
							className={cn(
								"rounded-full border px-1.5 py-0.5 text-[9px] font-semibold leading-none tracking-wide",
								getAgentStatusBadgeClass(entry.agentStatus),
							)}
						>
							{entry.agentStatus === "running" && (
								<span className="mr-1 inline-block size-1.5 rounded-full bg-current align-0 animate-pulse" />
							)}
							{getAgentStatusLabel(entry.agentStatus)}
						</span>
					</div>
					{heartbeat.status === "STALLED" || heartbeat.status === "UNRESPONSIVE" ? (
						<div
							className={cn(
								"ml-5 rounded-md border px-2 py-1 text-[10px]",
								heartbeat.status === "UNRESPONSIVE"
									? "border-red-400/30 bg-red-400/10 text-red-200"
									: "border-amber-400/30 bg-amber-400/10 text-amber-200",
							)}
						>
							<div className="flex items-center justify-between gap-2">
								<span className="font-semibold uppercase tracking-wide">{heartbeat.status}</span>
								<span className="tabular-nums">
									{formatWorkDuration(heartbeat.idleMs)} idle
								</span>
							</div>
							<div className="mt-1 flex gap-1">
								<button
									type="button"
									onClick={handleRestart}
									className="rounded border border-current/20 px-1.5 py-0.5 font-medium hover:bg-current/10"
								>
									Restart
								</button>
								<button
									type="button"
									onClick={handleTerminate}
									className="rounded border border-current/20 px-1.5 py-0.5 font-medium hover:bg-current/10"
								>
									Terminate
								</button>
							</div>
						</div>
					) : null}
					<div className="truncate pl-5 text-[11px] leading-tight text-muted-foreground/65">
						{entry.activity ?? "Waiting for work"}
					</div>
					<div className="flex items-center gap-1.5 pl-5 tabular-nums text-[10px] text-muted-foreground/45">
						<span>{entry.tokensRaw > 0 ? entry.tokens : "0 tok"}</span>
						<span>·</span>
						<span>{entry.costRaw > 0 ? entry.cost : "$0.00"}</span>
						{entry.duration && entry.duration !== "0s" && (
							<>
								<span>·</span>
								<span>{entry.duration}</span>
							</>
						)}
						{entry.toolCallCount > 0 && (
							<>
								<span>·</span>
								<span>{entry.toolCallCount} tools</span>
							</>
						)}
						{entry.errorCount > 0 && (
							<>
								<span>·</span>
								<span className="text-red-400">{entry.errorCount} err</span>
							</>
						)}
						{childRecoveryState.restartCount > 0 && (
							<>
								<span>·</span>
								<span className="text-amber-400">{childRecoveryState.restartCount}x rst</span>
							</>
						)}
						{entry.model && (
							<>
								<span>·</span>
								<span className="min-w-0 truncate">{entry.model}</span>
							</>
						)}
					</div>
					<AgentActivityTimeline sessionId={entry.sessionId} />
					<div className="ml-5 h-1 overflow-hidden rounded-full bg-muted/50">
						<div
							className={cn(
								"h-full rounded-full transition-all duration-500",
								entry.agentStatus === "failed"
									? "bg-red-400/70"
									: entry.agentStatus === "waiting"
										? "bg-amber-400/70"
										: "bg-emerald-400/70",
							)}
							style={{ width: `${progress}%` }}
						/>
					</div>
				</div>
			</TooltipTrigger>
			<TooltipContent side="right">
				<p className="font-medium">{entry.name}</p>
				<p className="text-muted-foreground">
					Heartbeat: {heartbeat.label}
					{heartbeat.status === "ACTIVE" ? "" : ` · ${formatWorkDuration(heartbeat.idleMs)} idle`}
				</p>
				{entry.activity && <p className="text-muted-foreground">{entry.activity}</p>}
				{entry.tokensRaw > 0 && (
					<p className="text-muted-foreground">
						{entry.tokens} tokens · {entry.cost}
						{entry.toolCallCount > 0 && ` · ${entry.toolCallCount} tool calls`}
						{entry.duration && entry.duration !== "0s" && ` · ${entry.duration}`}
					</p>
				)}
				{entry.errorCount > 0 && (
					<p className="text-red-400">{entry.errorCount} error{entry.errorCount !== 1 ? "s" : ""}</p>
				)}
				{entry.errorMessage && <p className="text-red-400">{entry.errorMessage}</p>}
			</TooltipContent>
		</Tooltip>
	)
}
