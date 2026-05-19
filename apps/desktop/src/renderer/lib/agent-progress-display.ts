import type { AgentStatus } from "./types"

export type BudgetMode = "NORMAL" | "FRUGAL" | "EMERGENCY"
export type AgentDisplayStatus = "running" | "waiting" | "completed" | "failed"

export interface BudgetDisplay {
	label: BudgetMode
	badgeClassName: string
	textClassName: string
}

export type SupervisorSeverity = "info" | "warning" | "critical"

export interface SupervisorDecision {
	severity: SupervisorSeverity
	label: string
	message: string
	recommendation: string
}

export interface SupervisorInput {
	totalCost: number
	totalTokens: number
	childCount: number
	runningCount: number
	failedCount: number
	waitingCount: number
	maxChildAgents?: number
	frugalBudgetUsd?: number
	emergencyBudgetUsd?: number
	tokenWarningThreshold?: number
}

export function getBudgetDisplay(totalCost: number): BudgetDisplay {
	if (totalCost > 0.5) {
		return {
			label: "EMERGENCY",
			badgeClassName: "border-red-400/30 bg-red-400/10 text-red-300",
			textClassName: "text-red-300",
		}
	}
	if (totalCost >= 0.25) {
		return {
			label: "FRUGAL",
			badgeClassName: "border-amber-400/30 bg-amber-400/10 text-amber-300",
			textClassName: "text-amber-300",
		}
	}
	return {
		label: "NORMAL",
		badgeClassName: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
		textClassName: "text-emerald-300",
	}
}

export function getAgentDisplayName(rawName: string): string {
	const lower = rawName.toLowerCase()
	if (lower.includes("architect")) return "Architect"
	if (lower.includes("builder")) return "Builder"
	if (lower.includes("reviewer")) return "Reviewer"
	if (lower.includes("lead")) return "Lead-Agent"

	const formatted = rawName
		.split(/[-_\s]+/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ")

	return formatted || "Agent"
}

export function getAgentStatusLabel(status: AgentStatus | AgentDisplayStatus): string {
	switch (status) {
		case "running":
			return "RUNNING"
		case "waiting":
			return "WAITING"
		case "failed":
			return "FAILED"
		case "completed":
			return "DONE"
		default:
			return "WAITING"
	}
}

export function getAgentStatusBadgeClass(status: AgentStatus | AgentDisplayStatus): string {
	switch (status) {
		case "running":
			return "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
		case "waiting":
			return "border-amber-400/30 bg-amber-400/10 text-amber-300"
		case "failed":
			return "border-red-400/30 bg-red-400/10 text-red-300"
		case "completed":
			return "border-border/50 bg-muted/40 text-muted-foreground"
		default:
			return "border-border/40 bg-muted/30 text-muted-foreground/70"
	}
}

export function getSupervisorDecision({
	totalCost,
	totalTokens,
	childCount,
	runningCount,
	failedCount,
	waitingCount,
	maxChildAgents = 6,
	frugalBudgetUsd = 0.25,
	emergencyBudgetUsd = 0.5,
	tokenWarningThreshold = 120_000,
}: SupervisorInput): SupervisorDecision {
	if (totalCost > emergencyBudgetUsd) {
		return {
			severity: "critical",
			label: "Budget exceeded",
			message: `Session spend is above $${emergencyBudgetUsd.toFixed(2)}.`,
			recommendation: "Stop spawning new agents and summarize partial results.",
		}
	}

	if (failedCount > 0) {
		return {
			severity: "critical",
			label: "Agent failure",
			message: `${failedCount} agent${failedCount === 1 ? "" : "s"} failed.`,
			recommendation: "Inspect the failed child session before retrying.",
		}
	}

	if (childCount > maxChildAgents) {
		return {
			severity: "warning",
			label: "High fan-out",
			message: `${childCount} child agents are attached to this workflow.`,
			recommendation: "Avoid spawning more children until current work completes.",
		}
	}

	if (totalTokens >= tokenWarningThreshold) {
		return {
			severity: "warning",
			label: "High token usage",
			message: `${Math.round(totalTokens / 1000)}k tokens used in this workflow.`,
			recommendation: "Compact context or ask the lead agent for a summary before continuing.",
		}
	}

	if (totalCost >= frugalBudgetUsd) {
		return {
			severity: "warning",
			label: "Frugal mode",
			message: `Session spend is above $${frugalBudgetUsd.toFixed(2)}.`,
			recommendation: "Prefer concise outputs and skip optional review passes.",
		}
	}

	if (waitingCount > 0) {
		return {
			severity: "info",
			label: "Waiting",
			message: `${waitingCount} agent${waitingCount === 1 ? " is" : "s are"} waiting for input.`,
			recommendation: "Respond to pending permissions or questions to unblock the workflow.",
		}
	}

	if (runningCount > 0) {
		return {
			severity: "info",
			label: "Healthy",
			message: `${runningCount} agent${runningCount === 1 ? " is" : "s are"} running.`,
			recommendation: "Monitor progress and cost before spawning additional agents.",
		}
	}

	return {
		severity: "info",
		label: "Idle",
		message: "No active child agents are running.",
		recommendation: "Ready for the next supervised task.",
	}
}
