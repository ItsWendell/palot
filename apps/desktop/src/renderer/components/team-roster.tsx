/**
 * Team Roster — shows available agents grouped by team with leader badges.
 * Clicking any agent opens a spawn dialog with system prompt + custom instruction.
 */

import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@palot/ui/components/dialog"
import { Tooltip, TooltipContent, TooltipTrigger } from "@palot/ui/components/tooltip"
import { cn } from "@palot/ui/lib/utils"
import { AlertCircleIcon, BookOpenIcon, ChevronDownIcon, ChevronRightIcon, CrownIcon, Loader2Icon, PlayIcon, UsersIcon, ZapIcon } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import type { ManagedAgent } from "../../shared/agents"
import type { KnowledgeSource } from "../../shared/knowledge"
import type { ManagedSkill } from "../../shared/skills"
import { scoreKnowledgeSources } from "../../shared/knowledge-scorer"
import { listAgents, listAllSkills, listKnowledgeSources } from "../services/backend"

// ============================================================
// Team metadata
// ============================================================

const TEAM_META: Record<string, { displayName: string; color: string; bg: string; border: string }> = {
	engineering:    { displayName: "Engineering",         color: "text-blue-400",    bg: "bg-blue-500/8",    border: "border-blue-500/20" },
	languages:      { displayName: "Languages",           color: "text-purple-400",  bg: "bg-purple-500/8",  border: "border-purple-500/20" },
	infrastructure: { displayName: "Infrastructure",      color: "text-orange-400",  bg: "bg-orange-500/8",  border: "border-orange-500/20" },
	quality:        { displayName: "Quality & Security",  color: "text-red-400",     bg: "bg-red-500/8",     border: "border-red-500/20" },
	"data-ai":      { displayName: "Data & AI",           color: "text-cyan-400",    bg: "bg-cyan-500/8",    border: "border-cyan-500/20" },
	research:       { displayName: "Research",            color: "text-emerald-400", bg: "bg-emerald-500/8", border: "border-emerald-500/20" },
	business:       { displayName: "Business & Product",  color: "text-yellow-400",  bg: "bg-yellow-500/8",  border: "border-yellow-500/20" },
	orchestration:  { displayName: "Orchestration",       color: "text-violet-400",  bg: "bg-violet-500/8",  border: "border-violet-500/20" },
	specialized:    { displayName: "Specialized",         color: "text-pink-400",    bg: "bg-pink-500/8",    border: "border-pink-500/20" },
}

const TEAM_ORDER = ["orchestration", "engineering", "languages", "infrastructure", "quality", "data-ai", "research", "business", "specialized"]

const COLOR_DOT: Record<string, string> = {
	accent: "bg-foreground",
	info:   "bg-sky-500",
	warning:"bg-amber-500",
	danger: "bg-red-500",
	success:"bg-emerald-500",
}

function ColorDot({ color }: { color: string }) {
	if (!color) return null
	return <span className={cn("inline-block size-1.5 rounded-full shrink-0", COLOR_DOT[color] ?? "bg-muted-foreground/30")} aria-hidden="true" />
}

function parseModelString(model: string): { providerID: string; modelID: string } | null {
	const parts = model.split("/")
	if (parts.length < 2) return null
	return { providerID: parts[0], modelID: parts.slice(1).join("/") }
}

// ============================================================
// Spawn dialog
// ============================================================

interface SpawnDialogProps {
	agent: ManagedAgent
	open: boolean
	onClose: () => void
	directory: string
	onSpawn: (agentName: string, customInstruction: string, knowledgeFilenames?: string[], skillFilenames?: string[]) => Promise<void>
}

function SpawnDialog({ agent, open, onClose, onSpawn, directory }: SpawnDialogProps) {
	const [customInstruction, setCustomInstruction] = useState("")
	const [spawning, setSpawning] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [knowledgeSources, setKnowledgeSources] = useState<KnowledgeSource[]>([])
	const [selectedKnowledge, setSelectedKnowledge] = useState<string[]>([])
	const [skills, setSkills] = useState<ManagedSkill[]>([])
	const [selectedSkills, setSelectedSkills] = useState<string[]>([])
	const [skillsExpanded, setSkillsExpanded] = useState(false)
	const teamMeta = agent.team ? TEAM_META[agent.team] : undefined

	useEffect(() => {
		if (!open) return
		setCustomInstruction(""); setSpawning(false); setError(null); setSelectedKnowledge([])
		setSkills([]); setSelectedSkills([]); setSkillsExpanded(false)
		listAllSkills().then((list) => { setSkills(list); setSelectedSkills(list.map((s) => s.filename)) }).catch(() => setSkills([]))
		listKnowledgeSources(directory)
			.then((sources) => {
				const scored = scoreKnowledgeSources(sources, {
					agentName: agent.name,
					agentDescription: agent.description,
					agentTeam: agent.team,
					agentMode: agent.mode,
				})
				setKnowledgeSources(scored.map((s) => s.source))
				// Pre-select highly relevant sources (score ≥ 3)
				const high = scored.filter((s) => s.score >= 3).map((s) => s.source.filename)
				if (high.length > 0) setSelectedKnowledge(high)
			})
			.catch(() => setKnowledgeSources([]))
	}, [open, agent.name, agent.description, agent.team, agent.mode, directory])

	const toggleKnowledge = useCallback((filename: string) => {
		setSelectedKnowledge((prev) => prev.includes(filename) ? prev.filter((f) => f !== filename) : [...prev, filename])
	}, [])

	const toggleSkill = useCallback((filename: string) => {
		setSelectedSkills((prev) => prev.includes(filename) ? prev.filter((f) => f !== filename) : [...prev, filename])
	}, [])

	const handleSpawn = useCallback(async () => {
		setSpawning(true); setError(null)
		try {
			const skillsToPass = skills.length > 0 && selectedSkills.length > 0 ? selectedSkills : undefined
			await onSpawn(agent.name, customInstruction, selectedKnowledge.length > 0 ? selectedKnowledge : undefined, skillsToPass)
			onClose()
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to spawn agent.")
		} finally { setSpawning(false) }
	}, [agent.name, customInstruction, selectedKnowledge, selectedSkills, skills.length, onSpawn, onClose])

	const modelRef = useMemo(() => (agent.model ? parseModelString(agent.model) : null), [agent.model])

	// Derive scores for badge display (sorted matches the state order)
	const scoredSources = useMemo(
		() => scoreKnowledgeSources(knowledgeSources, {
			agentName: agent.name,
			agentDescription: agent.description,
			agentTeam: agent.team,
			agentMode: agent.mode,
		}),
		[knowledgeSources, agent.name, agent.description, agent.team, agent.mode],
	)
	const scoreByFilename = useMemo(() => {
		const map = new Map<string, number>()
		for (const s of scoredSources) map.set(s.source.filename, s.score)
		return map
	}, [scoredSources])

	return (
		<Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
			<DialogContent className="flex max-h-[80vh] w-full max-w-xl flex-col gap-0 p-0">
				<DialogHeader className="border-b border-border px-5 py-3">
					<div className="flex items-center gap-2.5">
						<ColorDot color={agent.color} />
						<div>
							<div className="flex items-center gap-2">
								<DialogTitle className="text-sm">{agent.name}</DialogTitle>
								{agent.teamRole === "leader" && <CrownIcon className="size-3 text-amber-400" />}
								{teamMeta && (
									<span className={cn("rounded-full px-1.5 py-0.5 text-[9px] font-medium", teamMeta.bg, teamMeta.color)}>{teamMeta.displayName}</span>
								)}
							</div>
							{agent.description && <p className="text-xs text-muted-foreground">{agent.description}</p>}
						</div>
					</div>
				</DialogHeader>

				<div className="flex-1 space-y-3 overflow-y-auto px-5 py-3">
					{error && (
						<div className="flex items-start gap-2 rounded-md border border-red-400/30 bg-red-400/10 p-3 text-xs text-red-400">
							<AlertCircleIcon className="mt-0.5 size-3 shrink-0" />
							<span>{error}</span>
						</div>
					)}
					{modelRef && (
						<div className="rounded-md border border-border/30 bg-muted/15 px-3 py-2">
							<p className="text-[10px] font-medium text-muted-foreground/60">Model</p>
							<p className="mt-0.5 font-mono text-xs">{agent.model}</p>
						</div>
					)}
					<div className="flex items-center gap-2 text-[11px] text-muted-foreground/60">
						<span className="rounded-full border border-border/30 px-1.5 py-0.5">{agent.mode}</span>
						<span>{agent.origin}</span>
					</div>
					<div>
						<p className="mb-1 text-[10px] font-medium text-muted-foreground/60">System Prompt</p>
						<div className="max-h-48 overflow-y-auto rounded-md border border-border/30 bg-muted/20 p-3">
							<pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-foreground/80">{agent.prompt || "(empty)"}</pre>
						</div>
					</div>
					<div>
						<p className="mb-1 text-[10px] font-medium text-muted-foreground/60">Custom Instruction <span className="text-muted-foreground/40">(optional)</span></p>
						<textarea
							value={customInstruction}
							onChange={(e) => setCustomInstruction(e.target.value)}
							placeholder="e.g. Focus on the database schema first"
							className="min-h-16 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring"
							disabled={spawning}
						/>
					</div>
					{knowledgeSources.length > 0 && (
						<div>
							<p className="mb-1 text-[10px] font-medium text-muted-foreground/60">
								<BookOpenIcon className="mr-1 inline size-2.5" />
								Knowledge <span className="text-muted-foreground/40">(attach reference docs)</span>
							</p>
							<div className="space-y-1">
								{knowledgeSources.map((ks) => {
									const isSelected = selectedKnowledge.includes(ks.filename)
									const score = scoreByFilename.get(ks.filename) ?? 0
									return (
										<label key={ks.filename} className={cn("flex cursor-pointer items-start gap-2 rounded-md border px-2.5 py-2 transition-colors", isSelected ? "border-sky-400/30 bg-sky-400/10" : "border-border/20 hover:border-border/40")}>
											<input type="checkbox" checked={isSelected} onChange={() => toggleKnowledge(ks.filename)} className="mt-0.5 size-3 rounded border-border accent-sky-500" disabled={spawning} />
											<div className="min-w-0 flex-1">
												<p className="flex items-center gap-1.5 text-xs font-medium text-foreground/85">
													{ks.title}
													{score >= 1 && (
														<span className={cn("rounded px-1 py-[1px] text-[9px] font-normal", score >= 3 ? "bg-sky-400/15 text-sky-400" : "bg-muted/30 text-muted-foreground/50")}>{score}</span>
													)}
												</p>
												{ks.description && <p className="mt-0.5 truncate text-[10px] text-muted-foreground/60">{ks.description}</p>}
												<p className="mt-0.5 text-[9px] text-muted-foreground/40">{ks.source}</p>
											</div>
										</label>)
								})}
							</div>
						</div>
					)}
						{skills.length > 0 && (
							<div>
								<button
									type="button"
									onClick={() => setSkillsExpanded((v) => !v)}
									className="mb-1 flex w-full items-center gap-1 text-[10px] font-medium text-muted-foreground/60 hover:text-muted-foreground transition-colors"
								>
									<ZapIcon className="size-2.5" />
									<span>
										{selectedSkills.length}/{skills.length} skill{skills.length !== 1 ? "s" : ""} selected
									</span>
									{skillsExpanded ? <ChevronDownIcon className="ml-auto size-2.5" /> : <ChevronRightIcon className="ml-auto size-2.5" />}
								</button>
								{skillsExpanded && (
									<div className="flex flex-wrap gap-1">
										{skills.map((s) => {
											const active = selectedSkills.includes(s.filename)
											return (
												<button
													key={s.filename}
													type="button"
													onClick={() => toggleSkill(s.filename)}
													disabled={spawning}
													className={cn(
														"rounded border px-1.5 py-0.5 text-[9px] transition-colors",
														active
															? "border-violet-400/30 bg-violet-400/10 text-violet-300"
															: "border-border/20 bg-muted/10 text-muted-foreground/40 line-through",
													)}
												>
													{s.name}
												</button>
											)
										})}
									</div>
								)}
							</div>
						)}
				</div>

				<DialogFooter className="border-t border-border px-5 py-3">
					<button type="button" onClick={onClose} disabled={spawning} className="rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">Cancel</button>
					<button
						type="button"
						onClick={handleSpawn}
						disabled={spawning}
						className={cn("flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors", spawning ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20")}
					>
						{spawning ? <Loader2Icon className="size-3 animate-spin" /> : <PlayIcon className="size-3" />}
						{spawning ? "Spawning..." : `Spawn ${agent.name}`}
					</button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}

// ============================================================
// Team section — collapsible group of agents
// ============================================================

interface TeamSectionProps {
	teamKey: string
	leader?: ManagedAgent
	members: ManagedAgent[]
	disabled?: boolean
	onSpawnClick: (agent: ManagedAgent) => void
}

function AgentRow({ agent, disabled, onSpawnClick }: { agent: ManagedAgent; disabled?: boolean; onSpawnClick: (a: ManagedAgent) => void }) {
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<div className={cn("flex items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-left transition-colors hover:border-border/40 hover:bg-muted/45", disabled && "opacity-50")} />
				}
			>
				<div className="flex w-full items-center gap-2">
					<ColorDot color={agent.color} />
					<div className="min-w-0 flex-1">
						<div className="flex items-center gap-1.5">
							<span className="text-xs font-medium text-foreground/85">{agent.name}</span>
							{agent.teamRole === "leader" && <CrownIcon className="size-2.5 text-amber-400 shrink-0" />}
						</div>
						{agent.model && <p className="truncate text-[10px] text-muted-foreground/50">{agent.model}</p>}
					</div>
					<button
						type="button"
						onClick={(e) => { e.stopPropagation(); onSpawnClick(agent) }}
						disabled={disabled}
						className="flex shrink-0 items-center gap-1 rounded-md border border-border/30 px-2 py-1 text-[10px] font-medium text-muted-foreground/70 transition-colors hover:border-emerald-400/30 hover:bg-emerald-400/10 hover:text-emerald-300"
					>
						<PlayIcon className="size-2.5" />Spawn
					</button>
				</div>
			</TooltipTrigger>
			<TooltipContent side="right" className="max-w-64">
				<p className="mb-1 text-xs font-medium">{agent.name}</p>
				<p className="mb-1 text-[11px] leading-tight text-muted-foreground">{agent.description || "No description"}</p>
				{agent.model && <p className="text-[10px] text-muted-foreground/60">Model: {agent.model}</p>}
			</TooltipContent>
		</Tooltip>
	)
}

function TeamSection({ teamKey, leader, members, disabled, onSpawnClick }: TeamSectionProps) {
	const [open, setOpen] = useState(true)
	const meta = TEAM_META[teamKey] ?? { displayName: teamKey, color: "text-muted-foreground", bg: "bg-muted/10", border: "border-border" }
	const all = [...(leader ? [leader] : []), ...members]

	return (
		<div className={cn("rounded-md border overflow-hidden", meta.border)}>
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				className={cn("flex w-full items-center justify-between px-2.5 py-1.5 transition-colors hover:bg-muted/20", meta.bg)}
			>
				<div className="flex items-center gap-1.5">
					{open ? <ChevronDownIcon className={cn("size-3", meta.color)} /> : <ChevronRightIcon className={cn("size-3", meta.color)} />}
					<span className={cn("text-[10px] font-bold uppercase tracking-wide", meta.color)}>{meta.displayName}</span>
				</div>
				<span className="text-[10px] text-muted-foreground/50">{all.length}</span>
			</button>
			{open && (
				<div className="space-y-0.5 px-1 py-1">
					{/* Leader first, always visible */}
					{leader && <AgentRow key={leader.filename} agent={leader} disabled={disabled} onSpawnClick={onSpawnClick} />}
					{/* Members */}
					{members.map((m) => <AgentRow key={m.filename} agent={m} disabled={disabled} onSpawnClick={onSpawnClick} />)}
				</div>
			)}
		</div>
	)
}

// ============================================================
// TeamRoster
// ============================================================

export interface TeamRosterProps {
	directory: string
	sessionId: string
	onSpawn: (
		directory: string,
		sessionId: string,
		agentName: string,
		agentDescription: string,
		agentModel: string,
		agentPrompt: string,
		customInstruction: string,
		knowledgeFilenames?: string[],
		skillFilenames?: string[],
	) => Promise<void>
	disabled?: boolean
}

export function TeamRoster({ directory, sessionId, onSpawn, disabled }: TeamRosterProps) {
	const [agents, setAgents] = useState<ManagedAgent[]>([])
	const [loading, setLoading] = useState(true)
	const [selectedAgent, setSelectedAgent] = useState<ManagedAgent | null>(null)
	const [dialogOpen, setDialogOpen] = useState(false)

	useEffect(() => {
		let cancelled = false
		setLoading(true)
		listAgents(directory || undefined)
			.then((list) => {
				if (cancelled) return
				setAgents(list.filter((a) => !a.name.toLowerCase().includes("lead") && a.filename !== "lead-agent"))
			})
			.catch(() => { if (!cancelled) setAgents([]) })
			.finally(() => { if (!cancelled) setLoading(false) })
		return () => { cancelled = true }
	}, [])

	const grouped = useMemo(() => {
		const map: Record<string, { leader?: ManagedAgent; members: ManagedAgent[] }> = {}
		const unassigned: ManagedAgent[] = []
		for (const a of agents) {
			if (!a.team) { unassigned.push(a); continue }
			if (!map[a.team]) map[a.team] = { members: [] }
			if (a.teamRole === "leader") map[a.team].leader = a
			else map[a.team].members.push(a)
		}
		return { map, unassigned }
	}, [agents])

	const handleOpenDialog = useCallback((agent: ManagedAgent) => { setSelectedAgent(agent); setDialogOpen(true) }, [])
	const handleCloseDialog = useCallback(() => { setDialogOpen(false); setSelectedAgent(null) }, [])

	const handleSpawnFromDialog = useCallback(async (agentName: string, customInstruction: string, knowledgeFilenames?: string[], skillFilenames?: string[]) => {
		const agent = selectedAgent
		if (!agent) return
		await onSpawn(directory, sessionId, agentName, agent.description, agent.model, agent.prompt, customInstruction, knowledgeFilenames, skillFilenames)
	}, [directory, sessionId, selectedAgent, onSpawn])

	if (loading) return <div className="flex items-center justify-center py-3"><Loader2Icon className="size-3 animate-spin text-muted-foreground/50" /></div>
	if (agents.length === 0) return null

	return (
		<>
			<div className="rounded-md border border-border/30 bg-muted/10 px-2 py-2">
				<div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">
					<UsersIcon className="size-3" />Team ({agents.length})
				</div>
				<div className="space-y-1.5">
					{TEAM_ORDER.map((teamKey) => {
						const team = grouped.map[teamKey]
						if (!team) return null
						return (
							<TeamSection
								key={teamKey}
								teamKey={teamKey}
								leader={team.leader}
								members={team.members}
								disabled={disabled}
								onSpawnClick={handleOpenDialog}
							/>
						)
					})}

					{/* Unassigned agents */}
					{grouped.unassigned.length > 0 && (
						<div className="space-y-0.5 px-1">
							{grouped.unassigned.map((a) => <AgentRow key={a.filename} agent={a} disabled={disabled} onSpawnClick={handleOpenDialog} />)}
						</div>
					)}
				</div>
			</div>

			{selectedAgent && (
				<SpawnDialog
					agent={selectedAgent}
					open={dialogOpen}
					onClose={handleCloseDialog}
					onSpawn={handleSpawnFromDialog}
					directory={directory}
				/>
			)}
		</>
	)
}
