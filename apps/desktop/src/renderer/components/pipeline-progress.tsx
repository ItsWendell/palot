/**
 * Pipeline visualization — Lead → stages → Done, with optional team-aware
 * breakdown when agent metadata is available.
 */

import { cn } from "@palot/ui/lib/utils"
import {
	AlertCircleIcon,
	CheckCircle2Icon,
	ChevronRightIcon,
	CircleDotIcon,
	CrownIcon,
	Loader2Icon,
} from "lucide-react"
import { useMemo } from "react"
import type { ManagedAgent } from "../../shared/agents"
import { formatCost, formatTokens } from "../lib/session-metrics"
import type { SubAgentEntry } from "../atoms/sub-agents"

// ============================================================
// Team metadata
// ============================================================

const TEAM_META: Record<string, { displayName: string; color: string; dot: string }> = {
	engineering:    { displayName: "Engineering",   color: "text-blue-400",    dot: "bg-blue-400" },
	languages:      { displayName: "Languages",     color: "text-purple-400",  dot: "bg-purple-400" },
	infrastructure: { displayName: "Infra",         color: "text-orange-400",  dot: "bg-orange-400" },
	quality:        { displayName: "Quality",       color: "text-red-400",     dot: "bg-red-400" },
	"data-ai":      { displayName: "Data & AI",     color: "text-cyan-400",    dot: "bg-cyan-400" },
	research:       { displayName: "Research",      color: "text-emerald-400", dot: "bg-emerald-400" },
	business:       { displayName: "Business",      color: "text-yellow-400",  dot: "bg-yellow-400" },
	orchestration:  { displayName: "Orchestration", color: "text-violet-400",  dot: "bg-violet-400" },
	specialized:    { displayName: "Specialized",   color: "text-pink-400",    dot: "bg-pink-400" },
}

// ============================================================
// Pipeline stage types
// ============================================================

type StageStatus = "pending" | "running" | "completed" | "failed" | "skipped"

interface StageInfo {
	key: string
	label: string
	status: StageStatus
	cost: number
	tokens: number
	agents: SubAgentEntry[]
}

function mergeStageStatus(agents: SubAgentEntry[]): StageStatus {
	if (agents.length === 0) return "skipped"
	if (agents.some((a) => a.agentStatus === "running")) return "running"
	if (agents.some((a) => a.agentStatus === "failed")) return "failed"
	if (agents.every((a) => a.agentStatus === "completed" || a.agentStatus === "idle" || a.agentStatus === "paused")) return "completed"
	return "pending"
}

// ============================================================
// Stage card
// ============================================================

const STAGE_ICONS: Record<StageStatus, typeof Loader2Icon> = {
	pending:   CircleDotIcon,
	running:   Loader2Icon,
	completed: CheckCircle2Icon,
	failed:    AlertCircleIcon,
	skipped:   CircleDotIcon,
}

const STAGE_COLORS: Record<StageStatus, string> = {
	pending:   "text-muted-foreground/40 border-muted-foreground/20",
	running:   "text-emerald-400 border-emerald-400/30 bg-emerald-400/5",
	completed: "text-emerald-500 border-emerald-500/20 bg-emerald-500/5",
	failed:    "text-red-400 border-red-400/30 bg-red-400/10",
	skipped:   "text-muted-foreground/30 border-muted-foreground/10",
}

function StageCard({ stage }: { stage: StageInfo }) {
	const Icon = STAGE_ICONS[stage.status]
	const isRunning = stage.status === "running"
	const costFmt = stage.cost > 0 ? formatCost(stage.cost) : null
	const tokensFmt = stage.tokens > 0 ? formatTokens(stage.tokens) : null

	return (
		<div className={cn("flex min-w-0 shrink-0 flex-col items-center gap-1.5 rounded-lg border px-3 py-2 transition-colors", STAGE_COLORS[stage.status])}>
			<div className="flex items-center gap-1.5">
				{isRunning ? <Icon className="size-3 animate-spin" /> : <Icon className="size-3" />}
				<span className={cn("text-xs font-semibold", stage.status === "skipped" && "text-muted-foreground/40")}>{stage.label}</span>
				{stage.agents.length > 1 && <span className="text-[10px] text-muted-foreground/50">×{stage.agents.length}</span>}
			</div>
			{(costFmt || tokensFmt) && (
				<div className="flex items-center gap-1.5 tabular-nums text-[10px] text-muted-foreground/60">
					{costFmt && <span>{costFmt}</span>}
					{tokensFmt && <><span className="text-muted-foreground/30">·</span><span>{tokensFmt}</span></>}
				</div>
			)}
			{stage.agents.length > 1 && isRunning && (
				<div className="text-[10px] text-muted-foreground/50">{stage.agents.filter((a) => a.agentStatus === "running").length} active</div>
			)}
			{stage.status === "failed" && stage.agents[0]?.errorMessage && (
				<div className="max-w-[120px] truncate text-[9px] text-red-400/80" title={stage.agents[0].errorMessage}>{stage.agents[0].errorMessage}</div>
			)}
		</div>
	)
}

function StageArrow() {
	return <div className="flex shrink-0 items-center text-muted-foreground/25"><ChevronRightIcon className="size-4" /></div>
}

// ============================================================
// Team activity section
// ============================================================

interface ActiveTeam {
	teamKey: string
	displayName: string
	color: string
	dot: string
	running: number
	total: number
	leaders: string[]
}

interface TeamActivityProps {
	activeTeams: ActiveTeam[]
}

function TeamActivity({ activeTeams }: TeamActivityProps) {
	if (activeTeams.length === 0) return null
	return (
		<div className="mt-2 flex flex-wrap gap-1.5">
			{activeTeams.map((team) => (
				<div
					key={team.teamKey}
					className={cn("flex items-center gap-1.5 rounded-full border border-current/20 px-2 py-0.5", team.color, "bg-current/5")}
				>
					<span className={cn("size-1.5 rounded-full", team.dot, team.running > 0 && "animate-pulse")} />
					<span className="text-[10px] font-medium">{team.displayName}</span>
					{team.leaders.length > 0 && (
						<CrownIcon className="size-2.5 text-amber-400" aria-label="team leader active" />
					)}
					<span className="text-[10px] opacity-60">
						{team.running > 0 ? `${team.running}/${team.total}` : team.total}
					</span>
				</div>
			))}
		</div>
	)
}

// ============================================================
// PipelineProgress
// ============================================================

export interface PipelineProgressProps {
	children: SubAgentEntry[]
	parentStatus?: StageStatus
	parentCost?: number
	parentTokens?: number
	/** Optional: loaded agent metadata for team-aware display */
	knownAgents?: ManagedAgent[]
}

export function PipelineProgress({
	children,
	parentStatus = "pending",
	parentCost = 0,
	parentTokens = 0,
	knownAgents,
}: PipelineProgressProps) {
	// Build name → agent metadata lookup for team resolution
	const agentByName = useMemo(() => {
		if (!knownAgents) return new Map<string, ManagedAgent>()
		const map = new Map<string, ManagedAgent>()
		for (const a of knownAgents) {
			map.set(a.name.toLowerCase(), a)
			map.set(a.filename.toLowerCase(), a)
		}
		return map
	}, [knownAgents])

	// Classify children into pipeline stages by name
	const architectAgents = children.filter((c) => c.name.toLowerCase().includes("architect"))
	const reviewerAgents  = children.filter((c) => c.name.toLowerCase().includes("reviewer"))
	const builderAgents   = children.filter((c) => c.name.toLowerCase().includes("builder") && !c.name.toLowerCase().includes("reviewer"))
	const otherAgents     = children.filter((c) => {
		const n = c.name.toLowerCase()
		return !n.includes("architect") && !n.includes("builder") && !n.includes("reviewer")
	})
	const allBuilders = [...builderAgents, ...otherAgents]

	const workStages: StageInfo[] = [
		{
			key: "lead",    label: "Lead",      status: parentStatus,
			cost: parentCost, tokens: parentTokens, agents: [],
		},
		{
			key: "architect", label: "Architect", status: mergeStageStatus(architectAgents),
			cost: architectAgents.reduce((s, a) => s + a.costRaw, 0),
			tokens: architectAgents.reduce((s, a) => s + a.tokensRaw, 0),
			agents: architectAgents,
		},
		{
			key: "builder", label: "Builder", status: mergeStageStatus(allBuilders),
			cost: allBuilders.reduce((s, a) => s + a.costRaw, 0),
			tokens: allBuilders.reduce((s, a) => s + a.tokensRaw, 0),
			agents: allBuilders,
		},
		{
			key: "reviewer", label: "Reviewer", status: mergeStageStatus(reviewerAgents),
			cost: reviewerAgents.reduce((s, a) => s + a.costRaw, 0),
			tokens: reviewerAgents.reduce((s, a) => s + a.tokensRaw, 0),
			agents: reviewerAgents,
		},
	]

	const hasAnyWork = workStages.slice(1).some((s) => s.status !== "skipped")
	const allDone    = workStages.every((s) => s.status === "completed" || s.status === "skipped")

	const stages: StageInfo[] = [
		...workStages,
		{
			key: "done", label: "Done",
			status: !hasAnyWork ? "skipped" : allDone ? "completed" : "pending",
			cost: 0, tokens: 0, agents: [],
		},
	]

	// Team activity — cross-reference running agents against known metadata
	const activeTeams = useMemo((): ActiveTeam[] => {
		if (agentByName.size === 0) return []
		const teamMap = new Map<string, ActiveTeam>()

		for (const child of children) {
			const meta = agentByName.get(child.name.toLowerCase()) ?? agentByName.get(child.name.toLowerCase().replace(/\s+/g, "-"))
			if (!meta?.team) continue
			const teamKey = meta.team
			const tmeta = TEAM_META[teamKey]
			if (!tmeta) continue

			if (!teamMap.has(teamKey)) {
				teamMap.set(teamKey, { teamKey, displayName: tmeta.displayName, color: tmeta.color, dot: tmeta.dot, running: 0, total: 0, leaders: [] })
			}
			const entry = teamMap.get(teamKey)!
			entry.total++
			if (child.agentStatus === "running") entry.running++
			if (meta.teamRole === "leader") entry.leaders.push(meta.name)
		}

		return [...teamMap.values()].sort((a, b) => b.running - a.running)
	}, [children, agentByName])

	if (children.length === 0) return null

	return (
		<div className="rounded-md border border-border/30 bg-muted/10 px-3 py-2.5">
			<div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">Pipeline</div>
			<div className="flex items-center gap-1 overflow-x-auto">
				{stages.map((stage, i) => (
					<div key={stage.key} className="flex items-center gap-1">
						{i > 0 && <StageArrow />}
						<StageCard stage={stage} />
					</div>
				))}
			</div>
			{activeTeams.length > 0 && (
				<>
					<div className="my-2 h-px bg-border/20" />
					<div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60 mb-1">Active Teams</div>
					<TeamActivity activeTeams={activeTeams} />
				</>
			)}
		</div>
	)
}
