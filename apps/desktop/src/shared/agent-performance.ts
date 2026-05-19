/**
 * Shared types for persisted agent performance tracking.
 */

export type AgentPerformanceStatus = "completed" | "failed" | "waiting" | "cancelled" | "unknown"

export interface AgentPerformanceInput {
	sessionId: string
	parentSessionId: string
	agentName: string
	team?: string
	teamRole?: "leader" | "member"
	model?: string | null
	status: AgentPerformanceStatus
	startedAt?: string
	completedAt: string
	durationMs: number
	costUsd: number
	tokens: number
	toolCallCount: number
	errorCount: number
	retryCount: number
	summary?: string
	failureReason?: string | null
}

export interface AgentPerformanceRecord extends AgentPerformanceInput {
	id: string
	score: number
	createdAt: string
}

export interface AgentPerformanceSummary {
	agentName: string
	team?: string
	teamRole?: "leader" | "member"
	model?: string | null
	runs: number
	completed: number
	failed: number
	successRate: number
	avgScore: number
	avgDurationMs: number
	totalDurationMs: number
	totalCostUsd: number
	totalTokens: number
	totalToolCalls: number
	totalErrors: number
	lastRunAt: string | null
	needsAttention: boolean
}

export interface TeamPerformanceSummary {
	team: string
	runs: number
	successRate: number
	avgScore: number
	totalDurationMs: number
	totalCostUsd: number
	needsAttention: boolean
}

export interface ModelPerformanceSummary {
	model: string
	runs: number
	successRate: number
	avgScore: number
	totalCostUsd: number
	totalTokens: number
	avgCostPerRun: number
}

export interface AgentPerformanceLedger {
	version: 1
	records: AgentPerformanceRecord[]
	agents: AgentPerformanceSummary[]
	teams: TeamPerformanceSummary[]
	models: ModelPerformanceSummary[]
	updatedAt: string
}
