import type { ProjectBrainService } from "./project-brain-service"
import { createLogger } from "./logger"
import type {
	AgentPerformanceInput,
	AgentPerformanceLedger,
	AgentPerformanceRecord,
	AgentPerformanceSummary,
	ModelPerformanceSummary,
	TeamPerformanceSummary,
} from "../shared/agent-performance"

const SLUG = "agent-performance"
const MAX_RECORDS = 500
const log = createLogger("agent-performance")

function emptyLedger(): AgentPerformanceLedger {
	return {
		version: 1,
		records: [],
		agents: [],
		teams: [],
		models: [],
		updatedAt: new Date().toISOString(),
	}
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value))
}

function scoreRun(input: AgentPerformanceInput): number {
	let score = input.status === "completed" ? 100 : 55
	score -= Math.min(30, input.errorCount * 10)
	score -= Math.min(16, input.retryCount * 4)
	score -= Math.min(10, Math.floor(input.durationMs / 600_000) * 2)
	score -= Math.min(8, Math.floor(input.costUsd / 0.25))
	if (input.status === "waiting") score -= 15
	if (input.status === "cancelled") score -= 25
	return clamp(Math.round(score), 0, 100)
}

function average(values: number[]): number {
	if (values.length === 0) return 0
	return values.reduce((sum, value) => sum + value, 0) / values.length
}

function successRate(records: AgentPerformanceRecord[]): number {
	if (records.length === 0) return 0
	return records.filter((record) => record.status === "completed").length / records.length
}

function summarizeAgents(records: AgentPerformanceRecord[]): AgentPerformanceSummary[] {
	const groups = new Map<string, AgentPerformanceRecord[]>()
	for (const record of records) {
		const group = groups.get(record.agentName) ?? []
		group.push(record)
		groups.set(record.agentName, group)
	}

	return [...groups.entries()]
		.map(([agentName, group]) => {
			const latest = [...group].sort((a, b) => b.completedAt.localeCompare(a.completedAt))[0]
			const rate = successRate(group)
			const avgScore = average(group.map((record) => record.score))
			return {
				agentName,
				team: latest?.team,
				teamRole: latest?.teamRole,
				model: latest?.model,
				runs: group.length,
				completed: group.filter((record) => record.status === "completed").length,
				failed: group.filter((record) => record.status === "failed").length,
				successRate: rate,
				avgScore,
				avgDurationMs: average(group.map((record) => record.durationMs)),
				totalDurationMs: group.reduce((sum, record) => sum + record.durationMs, 0),
				totalCostUsd: group.reduce((sum, record) => sum + record.costUsd, 0),
				totalTokens: group.reduce((sum, record) => sum + record.tokens, 0),
				totalToolCalls: group.reduce((sum, record) => sum + record.toolCallCount, 0),
				totalErrors: group.reduce((sum, record) => sum + record.errorCount, 0),
				lastRunAt: latest?.completedAt ?? null,
				needsAttention: group.length >= 2 && (rate < 0.75 || avgScore < 70),
			}
		})
		.sort((a, b) => a.avgScore - b.avgScore || b.runs - a.runs)
}

function summarizeTeams(records: AgentPerformanceRecord[]): TeamPerformanceSummary[] {
	const groups = new Map<string, AgentPerformanceRecord[]>()
	for (const record of records) {
		const team = record.team ?? "unassigned"
		const group = groups.get(team) ?? []
		group.push(record)
		groups.set(team, group)
	}

	return [...groups.entries()]
		.map(([team, group]) => {
			const rate = successRate(group)
			const avgScore = average(group.map((record) => record.score))
			return {
				team,
				runs: group.length,
				successRate: rate,
				avgScore,
				totalDurationMs: group.reduce((sum, record) => sum + record.durationMs, 0),
				totalCostUsd: group.reduce((sum, record) => sum + record.costUsd, 0),
				needsAttention: group.length >= 3 && (rate < 0.8 || avgScore < 72),
			}
		})
		.sort((a, b) => a.avgScore - b.avgScore)
}

function summarizeModels(records: AgentPerformanceRecord[]): ModelPerformanceSummary[] {
	const groups = new Map<string, AgentPerformanceRecord[]>()
	for (const record of records) {
		const model = record.model || "unknown"
		const group = groups.get(model) ?? []
		group.push(record)
		groups.set(model, group)
	}

	return [...groups.entries()]
		.map(([model, group]) => {
			const totalCostUsd = group.reduce((sum, record) => sum + record.costUsd, 0)
			return {
				model,
				runs: group.length,
				successRate: successRate(group),
				avgScore: average(group.map((record) => record.score)),
				totalCostUsd,
				totalTokens: group.reduce((sum, record) => sum + record.tokens, 0),
				avgCostPerRun: totalCostUsd / group.length,
			}
		})
		.sort((a, b) => b.runs - a.runs)
}

function rebuild(records: AgentPerformanceRecord[]): AgentPerformanceLedger {
	const trimmed = [...records]
		.sort((a, b) => b.completedAt.localeCompare(a.completedAt))
		.slice(0, MAX_RECORDS)
	return {
		version: 1,
		records: trimmed,
		agents: summarizeAgents(trimmed),
		teams: summarizeTeams(trimmed),
		models: summarizeModels(trimmed),
		updatedAt: new Date().toISOString(),
	}
}

function serialize(ledger: AgentPerformanceLedger): string {
	const agentRows = ledger.agents
		.slice(0, 40)
		.map(
			(agent) =>
				`| ${agent.agentName} | ${agent.team ?? "unassigned"} | ${agent.runs} | ${Math.round(agent.successRate * 100)}% | ${Math.round(agent.avgScore)} | ${Math.round(agent.totalDurationMs / 60000)}m | $${agent.totalCostUsd.toFixed(4)} | ${agent.needsAttention ? "yes" : "no"} |`,
		)
		.join("\n")

	return [
		"---",
		`version: ${ledger.version}`,
		`updatedAt: ${ledger.updatedAt}`,
		"---",
		"",
		"# Agent Performance",
		"",
		"| Agent | Team | Runs | Success | Score | Time | Cost | Needs Work |",
		"|---|---:|---:|---:|---:|---:|---:|---:|",
		agentRows || "_No runs recorded yet._",
		"",
		"## Data",
		"",
		"```json",
		JSON.stringify(ledger, null, 2),
		"```",
	].join("\n")
}

function deserialize(content: string | null): { ledger: AgentPerformanceLedger; corrupted: boolean } {
	if (!content) return { ledger: emptyLedger(), corrupted: false }
	const match = content.match(/```json\n([\s\S]*?)\n```/)
	if (!match) return { ledger: emptyLedger(), corrupted: true }
	try {
		const parsed = JSON.parse(match[1]) as AgentPerformanceLedger
		if (parsed.version !== 1 || !Array.isArray(parsed.records)) {
			return { ledger: emptyLedger(), corrupted: true }
		}
		return { ledger: rebuild(parsed.records), corrupted: false }
	} catch {
		return { ledger: emptyLedger(), corrupted: true }
	}
}

export class AgentPerformanceService {
	constructor(private readonly brainService: ProjectBrainService) {}

	async load(): Promise<AgentPerformanceLedger> {
		const content = await this.brainService.readFile(SLUG)
		const parsed = deserialize(content)
		if (content && parsed.corrupted) {
			const backupSlug = `agent-performance-corrupt-${new Date().toISOString().replace(/[:.]/g, "-")}`
			await this.brainService.writeFile(backupSlug, content)
			log.warn("Agent performance ledger was corrupted; preserved recovery copy", { backupSlug })
		}
		return parsed.ledger
	}

	async record(input: AgentPerformanceInput): Promise<AgentPerformanceLedger> {
		const ledger = await this.load()
		const existing = ledger.records.filter((record) => record.sessionId !== input.sessionId)
		const record: AgentPerformanceRecord = {
			...input,
			id: `${input.sessionId}-${input.completedAt}`,
			score: scoreRun(input),
			createdAt: new Date().toISOString(),
		}
		const next = rebuild([record, ...existing])
		await this.brainService.writeFile(SLUG, serialize(next))
		return next
	}
}
