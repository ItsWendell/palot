/**
 * Pure policy for simultaneous child-agent workflows.
 *
 * OpenCode sessions can stream multiple child sessions, but Nexus Builder should only
 * treat work as parallel-safe when write ownership is isolated.
 */

export type AgentWorkflowKind = "planning" | "research" | "docs" | "isolated_write" | "shared_write"

export type AgentWorkflowExecutionMode = "parallel" | "sequential"

export interface AgentWorkflowPolicyInput {
	workflowKind: AgentWorkflowKind
	runningAgentCount: number
	maxConcurrentAgents: number
	hasFileLocking: boolean
	hasIsolatedFileOwnership: boolean
}

export interface AgentWorkflowPolicyResult {
	mode: AgentWorkflowExecutionMode
	allowed: boolean
	reason: string
	recommendedAction: string
}

export function evaluateAgentWorkflowPolicy({
	workflowKind,
	runningAgentCount,
	maxConcurrentAgents,
	hasFileLocking,
	hasIsolatedFileOwnership,
}: AgentWorkflowPolicyInput): AgentWorkflowPolicyResult {
	const resolvedMaxConcurrentAgents = Math.max(1, maxConcurrentAgents)
	if (runningAgentCount >= resolvedMaxConcurrentAgents) {
		return {
			mode: "sequential",
			allowed: false,
			reason: `Running-agent count ${runningAgentCount} reached max concurrency ${resolvedMaxConcurrentAgents}.`,
			recommendedAction: "Wait for an active child agent to finish before starting another.",
		}
	}

	if (workflowKind === "shared_write" && !hasFileLocking) {
		return {
			mode: "sequential",
			allowed: true,
			reason: "Shared file writes do not have file-locking protection.",
			recommendedAction: "Run shared write agents one at a time or split file ownership first.",
		}
	}

	if (workflowKind === "isolated_write" && !hasIsolatedFileOwnership) {
		return {
			mode: "sequential",
			allowed: true,
			reason: "Write ownership is not isolated.",
			recommendedAction: "Assign disjoint file ownership before parallel writes.",
		}
	}

	return {
		mode: "parallel",
		allowed: true,
		reason: "Workflow is safe for concurrent execution.",
		recommendedAction: "Continue within the configured concurrency limit.",
	}
}
