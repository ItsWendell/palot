/**
 * Agents Dashboard — two views:
 *   • Org Chart  — Boss → 9 teams × (leader + members), click to inspect
 *   • List       — searchable flat list with detail panel
 */

import { Button } from "@palot/ui/components/button"
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@palot/ui/components/dialog"
import { Input } from "@palot/ui/components/input"
import { Label } from "@palot/ui/components/label"
import { cn } from "@palot/ui/lib/utils"
import {
	AlertCircleIcon,
	BarChart3Icon,
	BotIcon,
	CheckIcon,
	CopyIcon,
	CrownIcon,
	LayoutGridIcon,
	ListIcon,
	Loader2Icon,
	PlusIcon,
	Trash2Icon,
	UsersIcon,
	XIcon,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import type { AgentPerformanceLedger, AgentPerformanceSummary } from "../../shared/agent-performance"
import type { ManagedAgent } from "../../shared/agents"
import { buildAgentRaw, filenameFromAgentName } from "../../shared/agents"
import { deleteAgent, listAgentPerformance, listAgents, writeAgent } from "../services/backend"

// ============================================================
// Team metadata
// ============================================================

interface TeamMeta {
	displayName: string
	color: string
	bg: string
	border: string
	ring: string
}

const TEAM_META: Record<string, TeamMeta> = {
	engineering:    { displayName: "Engineering",         color: "text-blue-400",   bg: "bg-blue-500/8",   border: "border-blue-500/20",   ring: "ring-blue-500/30" },
	languages:      { displayName: "Languages",           color: "text-purple-400", bg: "bg-purple-500/8", border: "border-purple-500/20", ring: "ring-purple-500/30" },
	infrastructure: { displayName: "Infrastructure",      color: "text-orange-400", bg: "bg-orange-500/8", border: "border-orange-500/20", ring: "ring-orange-500/30" },
	quality:        { displayName: "Quality & Security",  color: "text-red-400",    bg: "bg-red-500/8",    border: "border-red-500/20",    ring: "ring-red-500/30" },
	"data-ai":      { displayName: "Data & AI",           color: "text-cyan-400",   bg: "bg-cyan-500/8",   border: "border-cyan-500/20",   ring: "ring-cyan-500/30" },
	research:       { displayName: "Research",            color: "text-emerald-400",bg: "bg-emerald-500/8",border: "border-emerald-500/20",ring: "ring-emerald-500/30" },
	business:       { displayName: "Business & Product",  color: "text-yellow-400", bg: "bg-yellow-500/8", border: "border-yellow-500/20", ring: "ring-yellow-500/30" },
	orchestration:  { displayName: "Orchestration",       color: "text-violet-400", bg: "bg-violet-500/8", border: "border-violet-500/20", ring: "ring-violet-500/30" },
	specialized:    { displayName: "Specialized",         color: "text-pink-400",   bg: "bg-pink-500/8",   border: "border-pink-500/20",   ring: "ring-pink-500/30" },
}

const MODE_BADGES: Record<string, string> = {
	primary:  "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/25",
	subagent: "bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/25",
	all:      "bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/25",
}

const COLOR_MAP: Record<string, string> = {
	accent:  "bg-foreground",
	info:    "bg-sky-500",
	warning: "bg-amber-500",
	danger:  "bg-red-500",
	success: "bg-emerald-500",
}

function ColorDot({ color }: { color: string }) {
	if (!color) return null
	return <span className={cn("inline-block size-2 rounded-full shrink-0", COLOR_MAP[color] ?? "bg-muted-foreground/30")} />
}

function ModeBadge({ mode }: { mode: string }) {
	return (
		<span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", MODE_BADGES[mode] ?? "bg-muted text-muted-foreground")}>
			{mode}
		</span>
	)
}

// ============================================================
// Create agent dialog
// ============================================================

interface CreateDialogProps { open: boolean; onClose: () => void; onSaved: () => void }

function CreateAgentDialog({ open, onClose, onSaved }: CreateDialogProps) {
	const [name, setName] = useState("")
	const [description, setDescription] = useState("")
	const [model, setModel] = useState("")
	const [mode, setMode] = useState<"primary" | "subagent" | "all">("subagent")
	const [color, setColor] = useState("")
	const [prompt, setPrompt] = useState("")
	const [saving, setSaving] = useState(false)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		if (!open) return
		setName(""); setDescription(""); setModel(""); setMode("subagent"); setColor(""); setPrompt(""); setSaving(false); setError(null)
	}, [open])

	const handleSave = useCallback(async () => {
		if (!name.trim()) { setError("Agent name is required."); return }
		setSaving(true); setError(null)
		try {
			await writeAgent(filenameFromAgentName(name), buildAgentRaw({ description, model, mode, color, prompt }))
			onSaved(); onClose()
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to save agent.")
		} finally { setSaving(false) }
	}, [name, description, model, mode, color, prompt, onSaved, onClose])

	return (
		<Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
			<DialogContent className="flex max-h-[90vh] w-full max-w-2xl flex-col gap-0 p-0">
				<DialogHeader className="border-b border-border px-6 py-4">
					<DialogTitle>Create Agent</DialogTitle>
				</DialogHeader>
				<div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
					{error && <div className="rounded-md border border-destructive/25 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
					<div className="space-y-1.5">
						<Label htmlFor="a-name">Name</Label>
						<Input id="a-name" value={name} placeholder="My Custom Agent" onChange={(e) => setName(e.target.value)} disabled={saving} autoFocus />
					</div>
					<div className="space-y-1.5">
						<Label htmlFor="a-desc">Description</Label>
						<Input id="a-desc" value={description} placeholder="What this agent does..." onChange={(e) => setDescription(e.target.value)} disabled={saving} />
					</div>
					<div className="space-y-1.5">
						<Label htmlFor="a-model">Model</Label>
						<Input id="a-model" value={model} placeholder="openrouter/deepseek/deepseek-chat" onChange={(e) => setModel(e.target.value)} disabled={saving} />
					</div>
					<div className="grid grid-cols-2 gap-4">
						<div className="space-y-1.5">
							<Label htmlFor="a-mode">Mode</Label>
							<select id="a-mode" value={mode} onChange={(e) => setMode(e.target.value as "primary" | "subagent" | "all")} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm" disabled={saving}>
								<option value="primary">Primary</option>
								<option value="subagent">Subagent</option>
								<option value="all">All</option>
							</select>
						</div>
						<div className="space-y-1.5">
							<Label htmlFor="a-color">Color</Label>
							<select id="a-color" value={color} onChange={(e) => setColor(e.target.value)} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm" disabled={saving}>
								<option value="">None</option>
								<option value="accent">Accent</option>
								<option value="info">Info</option>
								<option value="warning">Warning</option>
								<option value="danger">Danger</option>
								<option value="success">Success</option>
							</select>
						</div>
					</div>
					<div className="space-y-1.5">
						<Label htmlFor="a-prompt">System Prompt</Label>
						<textarea id="a-prompt" value={prompt} placeholder="You are an agent that..." onChange={(e) => setPrompt(e.target.value)} className="min-h-48 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring" disabled={saving} />
					</div>
				</div>
				<DialogFooter className="border-t border-border px-6 py-4">
					<Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
					<Button onClick={handleSave} disabled={saving}>
						{saving && <Loader2Icon className="mr-1 size-3.5 animate-spin" />}Save Agent
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}

// ============================================================
// Agent detail panel (shared by both views)
// ============================================================

interface DetailPanelProps {
	agent: ManagedAgent
	performance?: AgentPerformanceSummary
	onDelete: () => void
	onClose?: () => void
}

function SystemPromptSection({ prompt }: { prompt?: string }) {
	const [copied, setCopied] = useState(false)
	const text = prompt || ""

	function handleCopy() {
		navigator.clipboard.writeText(text).then(() => {
			setCopied(true)
			setTimeout(() => setCopied(false), 1500)
		})
	}

	return (
		<div>
			<div className="mb-2 flex items-center justify-between">
				<h3 className="text-sm font-medium text-muted-foreground">System Prompt</h3>
				<div className="flex items-center gap-3">
					<span className="text-xs text-muted-foreground">{text.length.toLocaleString()} chars</span>
					<button
						type="button"
						onClick={handleCopy}
						className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
					>
						{copied ? <CheckIcon className="size-3 text-green-500" /> : <CopyIcon className="size-3" />}
						{copied ? "Copied" : "Copy"}
					</button>
				</div>
			</div>
			<pre className="whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-4 font-mono text-xs leading-relaxed text-foreground">
				{text || "(empty)"}
			</pre>
		</div>
	)
}

function AgentDetailPanel({ agent, performance, onDelete, onClose }: DetailPanelProps) {
	const [confirmDelete, setConfirmDelete] = useState(false)
	const teamMeta = agent.team ? TEAM_META[agent.team] : undefined

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex items-center justify-between border-b border-border px-6 py-4">
				<div className="flex items-center gap-3">
					<ColorDot color={agent.color} />
					<div>
						<div className="flex items-center gap-2">
							<h2 className="text-lg font-semibold">{agent.name}</h2>
							{agent.teamRole === "leader" && (
								<CrownIcon className="size-4 text-amber-400" aria-label="Team Leader" />
							)}
						</div>
						<p className="text-sm text-muted-foreground">{agent.description || "No description"}</p>
					</div>
				</div>
				<div className="flex items-center gap-2">
					<ModeBadge mode={agent.mode} />
					{onClose && (
						<button type="button" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:text-foreground transition-colors">
							<XIcon className="size-4" />
						</button>
					)}
				</div>
			</div>

			<div className="grid grid-cols-[100px_1fr] gap-x-4 gap-y-2 border-b border-border px-6 py-3 text-sm">
				<span className="text-muted-foreground">Filename</span>
				<code className="break-words rounded bg-muted px-1 py-0.5 text-xs">{agent.filename}.md</code>
				{agent.model && (
					<>
						<span className="text-muted-foreground">Model</span>
						<code className="break-words rounded bg-muted px-1 py-0.5 text-xs">{agent.model}</code>
					</>
				)}
				<span className="text-muted-foreground">Origin</span>
				<span>{agent.origin}</span>
				{teamMeta && (
					<>
						<span className="text-muted-foreground">Team</span>
						<div className="flex items-center gap-1.5">
							<span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", teamMeta.bg, teamMeta.color)}>{teamMeta.displayName}</span>
							{agent.teamRole === "leader" && <span className="text-[10px] text-amber-400 font-medium">Leader</span>}
						</div>
					</>
				)}
			</div>

			{performance && (
				<div className="grid grid-cols-4 gap-2 border-b border-border px-6 py-3">
					<PerformanceCell label="Score" value={`${Math.round(performance.avgScore)}`} />
					<PerformanceCell label="Success" value={`${Math.round(performance.successRate * 100)}%`} />
					<PerformanceCell label="Runs" value={`${performance.runs}`} />
					<PerformanceCell label="Time" value={`${Math.round(performance.totalDurationMs / 60000)}m`} />
				</div>
			)}

			<div className="flex-1 overflow-y-auto px-6 py-4">
				<SystemPromptSection prompt={agent.prompt} />
				<h3 className="mb-2 mt-6 text-sm font-medium text-muted-foreground">Raw Source</h3>
				<pre className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-4 font-mono text-xs leading-relaxed text-muted-foreground">{agent.raw}</pre>
			</div>

			<div className="flex items-center justify-end border-t border-border px-6 py-3 gap-2">
				{confirmDelete ? (
					<>
						<span className="text-xs text-destructive">Delete {agent.filename}.md?</span>
						<Button size="sm" variant="destructive" onClick={onDelete}>Confirm</Button>
						<Button size="sm" variant="outline" onClick={() => setConfirmDelete(false)}>Cancel</Button>
					</>
				) : (
					<Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setConfirmDelete(true)}>
						<Trash2Icon className="mr-1 size-3.5" />Delete
					</Button>
				)}
			</div>
		</div>
	)
}

function PerformanceCell({ label, value }: { label: string; value: string }) {
	return (
		<div className="rounded-md border border-border/40 bg-muted/15 px-2.5 py-2">
			<div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground/60">
				<BarChart3Icon className="size-3" />
				{label}
			</div>
			<div className="mt-1 text-sm font-semibold tabular-nums">{value}</div>
		</div>
	)
}

// ============================================================
// Org chart view
// ============================================================

interface OrgChartViewProps {
	agents: ManagedAgent[]
	onSelect: (agent: ManagedAgent) => void
}

function BossCard({ agent, onClick }: { agent: ManagedAgent; onClick: () => void }) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="group mx-auto flex w-full max-w-sm items-center gap-3 rounded-xl border-2 border-amber-500/30 bg-amber-500/8 px-5 py-3.5 text-left transition-all hover:border-amber-500/50 hover:bg-amber-500/12"
		>
			<div className="flex size-10 shrink-0 items-center justify-center rounded-full border-2 border-amber-500/40 bg-amber-500/15">
				<BotIcon className="size-5 text-amber-400" />
			</div>
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<span className="font-semibold text-foreground">{agent.name}</span>
					<span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold tracking-wide text-amber-400">BOSS</span>
				</div>
				<p className="mt-0.5 truncate text-xs text-muted-foreground">{agent.description || "Lead agent — orchestrates all teams"}</p>
			</div>
		</button>
	)
}

interface TeamCardProps {
	teamKey: string
	leader: ManagedAgent | undefined
	members: ManagedAgent[]
	onAgentClick: (agent: ManagedAgent) => void
}

function TeamCard({ teamKey, leader, members, onAgentClick }: TeamCardProps) {
	const [expanded, setExpanded] = useState(false)
	const meta = TEAM_META[teamKey] ?? { displayName: teamKey, color: "text-muted-foreground", bg: "bg-muted/10", border: "border-border", ring: "" }
	const PREVIEW_COUNT = 5
	const visibleMembers = expanded ? members : members.slice(0, PREVIEW_COUNT)
	const overflow = members.length - PREVIEW_COUNT

	return (
		<div className={cn("flex flex-col rounded-xl border", meta.border, meta.bg)}>
			{/* Team header */}
			<div className={cn("flex items-center justify-between rounded-t-xl px-3 py-2", meta.bg)}>
				<span className={cn("text-xs font-bold uppercase tracking-wide", meta.color)}>{meta.displayName}</span>
				<span className="text-[10px] text-muted-foreground/60">{members.length + (leader ? 1 : 0)} agents</span>
			</div>

			<div className="flex flex-col gap-1.5 p-2.5">
				{/* Leader */}
				{leader && (
					<button
						type="button"
						onClick={() => onAgentClick(leader)}
						className={cn("flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-colors hover:bg-muted/40", meta.border)}
					>
						<CrownIcon className={cn("size-3 shrink-0", meta.color)} />
						<div className="min-w-0 flex-1">
							<p className="truncate text-xs font-semibold text-foreground">{leader.name}</p>
							<p className="truncate text-[10px] text-muted-foreground/60">{leader.description}</p>
						</div>
					</button>
				)}

				{/* Divider */}
				{leader && members.length > 0 && (
					<div className={cn("mx-1 h-px", meta.bg, "border-t", meta.border)} />
				)}

				{/* Members */}
				{visibleMembers.map((m) => (
					<button
						key={m.filename}
						type="button"
						onClick={() => onAgentClick(m)}
						className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left transition-colors hover:bg-muted/40"
					>
						<ColorDot color={m.color} />
						<span className="min-w-0 flex-1 truncate text-xs text-foreground/80">{m.name}</span>
					</button>
				))}

				{/* Expand toggle */}
				{overflow > 0 && (
					<button
						type="button"
						onClick={() => setExpanded((v) => !v)}
						className={cn("mt-0.5 rounded-md px-2 py-1 text-[10px] font-medium transition-colors", meta.color, "hover:underline")}
					>
						{expanded ? "Show less" : `+${overflow} more`}
					</button>
				)}
			</div>
		</div>
	)
}

function OrgChartView({ agents, onSelect }: OrgChartViewProps) {
	const boss = agents.find((a) => a.mode === "primary")
	const teamOrder = ["orchestration", "engineering", "languages", "infrastructure", "quality", "data-ai", "research", "business", "specialized"]

	const byTeam = useMemo(() => {
		const map: Record<string, { leader?: ManagedAgent; members: ManagedAgent[] }> = {}
		for (const a of agents) {
			if (!a.team || a === boss) continue
			if (!map[a.team]) map[a.team] = { members: [] }
			if (a.teamRole === "leader") map[a.team].leader = a
			else map[a.team].members.push(a)
		}
		return map
	}, [agents, boss])

	const unassigned = agents.filter((a) => !a.team && a !== boss)

	return (
		<div className="flex min-w-max flex-col gap-6 p-6">
			{/* Boss row */}
			{boss ? (
				<div className="flex flex-col items-center gap-2">
					<BossCard agent={boss} onClick={() => onSelect(boss)} />
					<div className="flex h-4 w-px bg-amber-500/30" />
					<div className="flex items-center gap-1 text-[10px] text-muted-foreground/50">
						<UsersIcon className="size-3" /> delegates to team leaders
					</div>
				</div>
			) : (
				<div className="rounded-xl border border-dashed border-border py-4 text-center text-sm text-muted-foreground">
					No primary (Boss) agent found
				</div>
			)}

			{/* Teams — horizontal row, one column per team */}
			<div className="flex gap-3">
				{teamOrder.map((teamKey) => {
					const team = byTeam[teamKey]
					if (!team) return null
					return (
						<div key={teamKey} className="w-52 shrink-0">
							<TeamCard
								teamKey={teamKey}
								leader={team.leader}
								members={team.members}
								onAgentClick={onSelect}
							/>
						</div>
					)
				})}
			</div>

			{/* Unassigned */}
			{unassigned.length > 0 && (
				<div className="rounded-xl border border-border bg-muted/10 p-3">
					<p className="mb-2 text-xs font-medium text-muted-foreground">Unassigned ({unassigned.length})</p>
					<div className="flex flex-wrap gap-1.5">
						{unassigned.map((a) => (
							<button
								key={a.filename}
								type="button"
								onClick={() => onSelect(a)}
								className="flex items-center gap-1.5 rounded-md border border-border/40 bg-muted/20 px-2 py-1 text-xs text-foreground/70 transition-colors hover:bg-muted/40"
							>
								<ColorDot color={a.color} />
								{a.name}
							</button>
						))}
					</div>
				</div>
			)}
		</div>
	)
}

// ============================================================
// List view (searchable flat list)
// ============================================================

interface ListViewProps {
	agents: ManagedAgent[]
	performanceByAgent: Map<string, AgentPerformanceSummary>
	selected: ManagedAgent | null
	onSelect: (agent: ManagedAgent) => void
	onDelete: (agent: ManagedAgent) => void
}

function ListView({ agents, performanceByAgent, selected, onSelect, onDelete }: ListViewProps) {
	const [query, setQuery] = useState("")
	const filtered = useMemo(() => {
		const q = query.toLowerCase()
		return q ? agents.filter((a) => a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q)) : agents
	}, [agents, query])

	return (
		<div className="flex h-full">
			{/* Sidebar */}
			<div className="flex w-72 shrink-0 flex-col border-r border-border">
				<div className="border-b border-border p-3">
					<Input placeholder="Search agents..." value={query} onChange={(e) => setQuery(e.target.value)} className="h-8 text-sm" />
				</div>
				<div className="flex-1 overflow-y-auto">
					{filtered.map((agent) => {
						const teamMeta = agent.team ? TEAM_META[agent.team] : undefined
						return (
							<button
								key={agent.filename}
								type="button"
								onClick={() => onSelect(agent)}
								className={cn("w-full border-b border-border/50 px-4 py-3 text-left transition-colors hover:bg-muted/50", selected?.filename === agent.filename && "bg-muted")}
							>
								<div className="flex items-center gap-2">
									<ColorDot color={agent.color} />
									<span className="truncate text-sm font-medium">{agent.name}</span>
									{agent.teamRole === "leader" && <CrownIcon className="size-3 shrink-0 text-amber-400" />}
								</div>
								<p className="mt-0.5 truncate text-xs text-muted-foreground">{agent.description || "No description"}</p>
								<div className="mt-1.5 flex items-center gap-1.5">
									<ModeBadge mode={agent.mode} />
									{teamMeta && (
										<span className={cn("rounded-full px-1.5 py-0.5 text-[9px] font-medium", teamMeta.bg, teamMeta.color)}>{teamMeta.displayName}</span>
									)}
								</div>
							</button>
						)
					})}
					{filtered.length === 0 && (
						<div className="py-8 text-center text-sm text-muted-foreground">No agents match "{query}"</div>
					)}
				</div>
			</div>

			{/* Detail */}
			<div className="flex-1 overflow-hidden">
				{selected ? (
					<AgentDetailPanel
						agent={selected}
						performance={performanceByAgent.get(selected.name)}
						onDelete={() => onDelete(selected)}
					/>
				) : (
					<div className="flex h-full items-center justify-center">
						<div className="text-center">
							<BotIcon className="mx-auto mb-3 size-10 text-muted-foreground/30" />
							<p className="text-sm text-muted-foreground">Select an agent to view details</p>
						</div>
					</div>
				)}
			</div>
		</div>
	)
}

// ============================================================
// Agent inspect dialog (used from org chart click)
// ============================================================

interface InspectDialogProps {
	agent: ManagedAgent | null
	performanceByAgent: Map<string, AgentPerformanceSummary>
	onClose: () => void
	onDelete: (agent: ManagedAgent) => void
}

function InspectDialog({ agent, performanceByAgent, onClose, onDelete }: InspectDialogProps) {
	if (!agent) return null
	return (
		<Dialog open={!!agent} onOpenChange={(v) => { if (!v) onClose() }}>
			<DialogContent className="flex max-h-[90vh] w-full max-w-2xl flex-col gap-0 p-0">
				<AgentDetailPanel
					agent={agent}
					performance={performanceByAgent.get(agent.name)}
					onDelete={() => { onDelete(agent); onClose() }}
					onClose={onClose}
				/>
			</DialogContent>
		</Dialog>
	)
}

// ============================================================
// Performance analytics view
// ============================================================

function scoreColor(score: number): string {
	if (score >= 80) return "text-emerald-400"
	if (score >= 60) return "text-amber-400"
	return "text-red-400"
}

function ScoreBar({ score }: { score: number }) {
	const color = score >= 80 ? "bg-emerald-500" : score >= 60 ? "bg-amber-500" : "bg-red-500"
	return (
		<div className="flex items-center gap-2">
			<div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted/40">
				<div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${score}%` }} />
			</div>
			<span className={cn("tabular-nums text-xs font-semibold", scoreColor(score))}>{Math.round(score)}</span>
		</div>
	)
}

function fmt(ms: number): string {
	if (ms < 60_000) return `${Math.round(ms / 1000)}s`
	if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`
	return `${(ms / 3_600_000).toFixed(1)}h`
}

interface PerformanceViewProps {
	ledger: AgentPerformanceLedger
	onAgentClick?: (agentName: string) => void
}

function PerformanceView({ ledger, onAgentClick }: PerformanceViewProps) {
	const [sortKey, setSortKey] = useState<"avgScore" | "successRate" | "runs" | "totalCostUsd" | "totalDurationMs">("avgScore")
	const [sortAsc, setSortAsc] = useState(false)

	const needsAttention = ledger.agents.filter((a) => a.needsAttention)
	const totalRuns = ledger.agents.reduce((s, a) => s + a.runs, 0)
	const totalCost = ledger.agents.reduce((s, a) => s + a.totalCostUsd, 0)
	const totalTime = ledger.agents.reduce((s, a) => s + a.totalDurationMs, 0)
	const overallScore = ledger.agents.length
		? ledger.agents.reduce((s, a) => s + a.avgScore * a.runs, 0) / Math.max(totalRuns, 1)
		: 0

	const sorted = useMemo(() => {
		return [...ledger.agents].sort((a, b) => {
			const delta = (a[sortKey] as number) - (b[sortKey] as number)
			return sortAsc ? delta : -delta
		})
	}, [ledger.agents, sortKey, sortAsc])

	function toggleSort(key: typeof sortKey) {
		if (sortKey === key) setSortAsc((v) => !v)
		else { setSortKey(key); setSortAsc(false) }
	}

	function SortHeader({ label, k }: { label: string; k: typeof sortKey }) {
		const active = sortKey === k
		return (
			<button type="button" onClick={() => toggleSort(k)} className={cn("text-[10px] font-semibold uppercase tracking-wide transition-colors", active ? "text-foreground" : "text-muted-foreground/60 hover:text-muted-foreground")}>
				{label}{active ? (sortAsc ? " ↑" : " ↓") : ""}
			</button>
		)
	}

	if (ledger.records.length === 0) {
		return (
			<div className="flex h-full flex-col items-center justify-center gap-3 text-center">
				<BarChart3Icon className="size-10 text-muted-foreground/20" />
				<div>
					<p className="text-sm font-medium">No performance data yet</p>
					<p className="mt-1 text-xs text-muted-foreground">Data is recorded automatically as agents complete runs.</p>
				</div>
			</div>
		)
	}

	return (
		<div className="flex flex-col gap-4 p-5">
			{/* Summary cards */}
			<div className="grid grid-cols-4 gap-3">
				{[
					{ label: "Total Runs", value: totalRuns.toString() },
					{ label: "Avg Score", value: `${Math.round(overallScore)}`, color: scoreColor(overallScore) },
					{ label: "Total Cost", value: `$${totalCost.toFixed(3)}` },
					{ label: "Total Time", value: fmt(totalTime) },
				].map(({ label, value, color }) => (
					<div key={label} className="rounded-xl border border-border/40 bg-muted/10 px-4 py-3">
						<p className="text-[10px] uppercase tracking-wide text-muted-foreground/60">{label}</p>
						<p className={cn("mt-1 text-xl font-bold tabular-nums", color ?? "text-foreground")}>{value}</p>
					</div>
				))}
			</div>

			{/* Needs attention */}
			{needsAttention.length > 0 && (
				<div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4">
					<div className="mb-2 flex items-center gap-2">
						<AlertCircleIcon className="size-3.5 text-red-400" />
						<span className="text-xs font-semibold text-red-400">Needs Attention ({needsAttention.length})</span>
						<span className="text-[10px] text-muted-foreground/60">— low success rate or score below threshold</span>
					</div>
					<div className="flex flex-wrap gap-2">
						{needsAttention.map((a) => {
							const teamMeta = a.team ? TEAM_META[a.team] : undefined
							return (
								<button key={a.agentName} type="button" onClick={() => onAgentClick?.(a.agentName)} className="flex items-center gap-1.5 rounded-md border border-red-500/20 bg-red-500/8 px-2.5 py-1 text-xs text-foreground/80 transition-colors hover:bg-red-500/15">
									{teamMeta && <span className={cn("size-1.5 rounded-full", teamMeta.bg.replace("bg-", "bg-").replace("/8", ""))} />}
									<span>{a.agentName}</span>
									<span className={cn("font-semibold", scoreColor(a.avgScore))}>{Math.round(a.avgScore)}</span>
								</button>
							)
						})}
					</div>
				</div>
			)}

			{/* Agent leaderboard */}
			<div className="rounded-xl border border-border/40 overflow-hidden">
				<div className="flex items-center justify-between border-b border-border/40 bg-muted/10 px-4 py-2">
					<span className="text-xs font-semibold">Agent Leaderboard</span>
					<span className="text-[10px] text-muted-foreground/50">{sorted.length} agents tracked</span>
				</div>
				<div className="overflow-x-auto">
					<table className="w-full text-xs">
						<thead>
							<tr className="border-b border-border/30 bg-muted/5">
								<th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">Agent</th>
								<th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">Team</th>
								<th className="px-3 py-2 text-right"><SortHeader label="Score" k="avgScore" /></th>
								<th className="px-3 py-2 text-right"><SortHeader label="Success" k="successRate" /></th>
								<th className="px-3 py-2 text-right"><SortHeader label="Runs" k="runs" /></th>
								<th className="px-3 py-2 text-right"><SortHeader label="Time" k="totalDurationMs" /></th>
								<th className="px-3 py-2 text-right"><SortHeader label="Cost" k="totalCostUsd" /></th>
								<th className="px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">Status</th>
							</tr>
						</thead>
						<tbody>
							{sorted.map((a) => {
								const teamMeta = a.team ? TEAM_META[a.team] : undefined
								return (
									<tr key={a.agentName} className="border-b border-border/20 transition-colors hover:bg-muted/20">
										<td className="px-4 py-2">
											<button type="button" onClick={() => onAgentClick?.(a.agentName)} className="flex items-center gap-1.5 font-medium text-foreground/85 hover:text-foreground">
												{a.teamRole === "leader" && <CrownIcon className="size-2.5 text-amber-400 shrink-0" />}
												<span className="truncate max-w-40">{a.agentName}</span>
											</button>
										</td>
										<td className="px-3 py-2">
											{teamMeta && <span className={cn("rounded-full px-1.5 py-0.5 text-[9px] font-medium", teamMeta.bg, teamMeta.color)}>{teamMeta.displayName}</span>}
										</td>
										<td className="px-3 py-2"><div className="flex justify-end"><ScoreBar score={a.avgScore} /></div></td>
										<td className={cn("px-3 py-2 text-right tabular-nums", a.successRate >= 0.8 ? "text-emerald-400" : a.successRate >= 0.6 ? "text-amber-400" : "text-red-400")}>
											{Math.round(a.successRate * 100)}%
										</td>
										<td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{a.runs}</td>
										<td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{fmt(a.totalDurationMs)}</td>
										<td className="px-3 py-2 text-right tabular-nums text-muted-foreground">${a.totalCostUsd.toFixed(3)}</td>
										<td className="px-3 py-2 text-center">
											{a.needsAttention
												? <span className="rounded-full bg-red-500/15 px-1.5 py-0.5 text-[9px] font-medium text-red-400">needs work</span>
												: <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-medium text-emerald-400">good</span>
											}
										</td>
									</tr>
								)
							})}
						</tbody>
					</table>
				</div>
			</div>

			{/* Team breakdown + Model comparison */}
			<div className="grid grid-cols-2 gap-4">
				{/* Teams */}
				<div className="rounded-xl border border-border/40 overflow-hidden">
					<div className="border-b border-border/40 bg-muted/10 px-4 py-2 text-xs font-semibold">Teams</div>
					<div className="divide-y divide-border/20">
						{ledger.teams.map((t) => {
							const meta = TEAM_META[t.team] ?? { displayName: t.team, color: "text-muted-foreground", bg: "bg-muted/10" }
							return (
								<div key={t.team} className="flex items-center gap-3 px-4 py-2.5">
									<span className={cn("text-xs font-medium w-28 truncate", meta.color)}>{meta.displayName}</span>
									<div className="flex-1"><ScoreBar score={t.avgScore} /></div>
									<span className="text-[10px] text-muted-foreground/60 tabular-nums w-10 text-right">{t.runs}r</span>
									{t.needsAttention && <AlertCircleIcon className="size-3 text-red-400 shrink-0" />}
								</div>
							)
						})}
					</div>
				</div>

				{/* Models */}
				<div className="rounded-xl border border-border/40 overflow-hidden">
					<div className="border-b border-border/40 bg-muted/10 px-4 py-2 text-xs font-semibold">Models</div>
					<div className="divide-y divide-border/20">
						{ledger.models.map((m) => (
							<div key={m.model} className="flex items-center gap-3 px-4 py-2.5">
								<span className="truncate text-[10px] font-mono text-muted-foreground/70 max-w-[140px]">{m.model.split("/").slice(-1)[0]}</span>
								<div className="flex-1"><ScoreBar score={m.avgScore} /></div>
								<span className="text-[10px] text-muted-foreground/60 tabular-nums">${m.avgCostPerRun.toFixed(3)}/run</span>
							</div>
						))}
					</div>
				</div>
			</div>
		</div>
	)
}

// ============================================================
// AgentsPage
// ============================================================

type ViewMode = "org" | "list" | "perf"

export function AgentsPage() {
	const [agents, setAgents] = useState<ManagedAgent[]>([])
	const [ledger, setLedger] = useState<AgentPerformanceLedger | null>(null)
	const [performanceByAgent, setPerformanceByAgent] = useState(new Map<string, AgentPerformanceSummary>())
	const [viewMode, setViewMode] = useState<ViewMode>("org")
	const [selected, setSelected] = useState<ManagedAgent | null>(null)
	const [inspecting, setInspecting] = useState<ManagedAgent | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [createOpen, setCreateOpen] = useState(false)

	const loadAgents = useCallback(async () => {
		setLoading(true); setError(null)
		try {
			const [agentList, performance] = await Promise.all([
				listAgents(),
				listAgentPerformance(),
			])
			setAgents(agentList)
			setLedger(performance)
			setPerformanceByAgent(new Map(performance.agents.map((agent) => [agent.agentName, agent])))
		}
		catch (err) { setError(err instanceof Error ? err.message : "Failed to load agents.") }
		finally { setLoading(false) }
	}, [])

	useEffect(() => { loadAgents() }, [loadAgents])

	const handleDelete = useCallback(async (agent: ManagedAgent) => {
		try {
			await deleteAgent(agent.filename)
			setSelected(null); setInspecting(null)
			await loadAgents()
		} catch (err) { setError(err instanceof Error ? err.message : "Failed to delete agent.") }
	}, [loadAgents])

	const handleOrgSelect = useCallback((agent: ManagedAgent) => setInspecting(agent), [])

	const stats = useMemo(() => {
		const teams = new Set(agents.map((a) => a.team).filter(Boolean))
		const leaders = agents.filter((a) => a.teamRole === "leader").length
		return { total: agents.length, teams: teams.size, leaders }
	}, [agents])

	return (
		<div className="flex h-full min-h-0 flex-col">
			{/* Top bar */}
			<div className="shrink-0 flex items-center justify-between border-b border-border px-5 py-3">
				<div className="flex items-center gap-4">
					<h1 className="text-sm font-semibold">Agent Organization</h1>
					{!loading && (
						<div className="flex items-center gap-3 text-[11px] text-muted-foreground/60">
							<span>{stats.total} agents</span>
							<span>·</span>
							<span>{stats.teams} teams</span>
							<span>·</span>
							<span>{stats.leaders} leaders</span>
						</div>
					)}
				</div>
				<div className="flex items-center gap-2">
					{/* View toggle */}
					<div className="flex rounded-md border border-border overflow-hidden">
						<button
							type="button"
							onClick={() => setViewMode("org")}
							className={cn("flex items-center gap-1.5 px-2.5 py-1.5 text-xs transition-colors", viewMode === "org" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}
						>
							<LayoutGridIcon className="size-3" />Org
						</button>
						<button
							type="button"
							onClick={() => setViewMode("list")}
							className={cn("flex items-center gap-1.5 border-l border-border px-2.5 py-1.5 text-xs transition-colors", viewMode === "list" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}
						>
							<ListIcon className="size-3" />List
						</button>
						<button
							type="button"
							onClick={() => setViewMode("perf")}
							className={cn("flex items-center gap-1.5 border-l border-border px-2.5 py-1.5 text-xs transition-colors", viewMode === "perf" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}
						>
							<BarChart3Icon className="size-3" />Perf
						</button>
					</div>
					<Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
						<PlusIcon className="mr-1 size-3.5" />Create
					</Button>
				</div>
			</div>

			{/* Error */}
			{error && (
				<div className="mx-5 mt-3 rounded-md border border-destructive/25 bg-destructive/10 p-3 text-xs text-destructive">{error}</div>
			)}

			{/* Loading */}
			{loading ? (
				<div className="flex flex-1 items-center justify-center">
					<Loader2Icon className="size-5 animate-spin text-muted-foreground" />
				</div>
			) : viewMode === "org" ? (
				<div className="flex-1 min-h-0 overflow-auto">
					<OrgChartView agents={agents} onSelect={handleOrgSelect} />
				</div>
			) : viewMode === "perf" ? (
				<div className="flex-1 min-h-0 overflow-auto">
					{ledger ? (
						<PerformanceView
							ledger={ledger}
							onAgentClick={(name) => {
								const agent = agents.find((a) => a.name === name)
								if (agent) setInspecting(agent)
							}}
						/>
					) : (
						<div className="flex h-full items-center justify-center text-sm text-muted-foreground">
							No performance data yet — run some agents to start tracking.
						</div>
					)}
				</div>
			) : (
				<div className="flex-1 min-h-0 overflow-hidden">
					<ListView
						agents={agents}
						performanceByAgent={performanceByAgent}
						selected={selected}
						onSelect={setSelected}
						onDelete={handleDelete}
					/>
				</div>
			)}

			{/* Org chart inspect dialog */}
			<InspectDialog
				agent={inspecting}
				performanceByAgent={performanceByAgent}
				onClose={() => setInspecting(null)}
				onDelete={handleDelete}
			/>

			{/* Create dialog */}
			<CreateAgentDialog open={createOpen} onClose={() => setCreateOpen(false)} onSaved={loadAgents} />
		</div>
	)
}
