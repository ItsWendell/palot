export type SupervisionDecision = "allow" | "warn" | "throttle" | "block" | "stop"
export type SupervisionSeverity = "info" | "warning" | "critical"

export type SupervisionMachineCode =
	| "SUPERVISION_ALLOW"
	| "SUPERVISION_WARN_CHILD_FAILURES"
	| "SUPERVISION_WARN_HIGH_TOKENS"
	| "SUPERVISION_WARN_COST_APPROACHING_BUDGET"
	| "SUPERVISION_THROTTLE_CONCURRENCY"
	| "SUPERVISION_BLOCK_MAX_CHILDREN"
	| "SUPERVISION_BLOCK_BUDGET_EXCEEDED"
	| "SUPERVISION_STOP_BUDGET_EXCEEDED"

export type SupervisedAgentState =
	| "queued"
	| "starting"
	| "running"
	| "streaming"
	| "waiting"
	| "retrying"
	| "completed"
	| "failed"
	| "cancelled"
	| "timed_out"
	| "idle"

export interface SupervisionPolicyConfig {
	configuredBudget: number
	maxChildren: number
	maxConcurrentAgents: number
	highTokenThreshold: number
	budgetWarningRatio: number
}

export interface SupervisionPolicyInput {
	workflowId: string
	parentAgentId: string
	childAgentCount: number
	runningAgentCount: number
	failedAgentCount: number
	waitingAgentCount: number
	totalTokens: number
	totalCost: number
	configuredBudget: number
	maxChildren: number
	maxConcurrentAgents: number
	currentAgentState: SupervisedAgentState
	highTokenThreshold?: number
	budgetWarningRatio?: number
}

export interface SupervisionPolicyResult {
	decision: SupervisionDecision
	severity: SupervisionSeverity
	reason: string
	operatorMessage: string
	machineCode: SupervisionMachineCode
	retryable: boolean
	recommendedAction: string
	workflowId: string
	parentAgentId: string
}

export const DEFAULT_SUPERVISION_POLICY: SupervisionPolicyConfig = {
	configuredBudget: 1,
	maxChildren: 12,
	maxConcurrentAgents: 3,
	highTokenThreshold: 180_000,
	budgetWarningRatio: 0.75,
}

function isActiveState(state: SupervisedAgentState): boolean {
	return state === "running" || state === "streaming" || state === "retrying" || state === "starting"
}

export class SupervisionPolicyError extends Error {
	readonly policy: SupervisionPolicyResult

	constructor(policy: SupervisionPolicyResult) {
		super(policy.operatorMessage)
		this.name = "SupervisionPolicyError"
		this.policy = policy
	}
}

export function evaluateSupervisionPolicy(input: SupervisionPolicyInput): SupervisionPolicyResult {
	const configuredBudget =
		input.configuredBudget > 0 ? input.configuredBudget : DEFAULT_SUPERVISION_POLICY.configuredBudget
	const maxChildren =
		input.maxChildren > 0 ? input.maxChildren : DEFAULT_SUPERVISION_POLICY.maxChildren
	const maxConcurrentAgents =
		input.maxConcurrentAgents > 0
			? input.maxConcurrentAgents
			: DEFAULT_SUPERVISION_POLICY.maxConcurrentAgents
	const highTokenThreshold =
		input.highTokenThreshold ?? DEFAULT_SUPERVISION_POLICY.highTokenThreshold
	const budgetWarningRatio =
		input.budgetWarningRatio ?? DEFAULT_SUPERVISION_POLICY.budgetWarningRatio
	const base = {
		workflowId: input.workflowId,
		parentAgentId: input.parentAgentId,
	}

	if (input.totalCost >= configuredBudget) {
		if (isActiveState(input.currentAgentState)) {
			return {
				...base,
				decision: "stop",
				severity: "critical",
				machineCode: "SUPERVISION_STOP_BUDGET_EXCEEDED",
				retryable: false,
				reason: `Workflow cost ${input.totalCost.toFixed(4)} is at or above budget ${configuredBudget.toFixed(4)}.`,
				operatorMessage: "Budget exceeded. Nexus Builder should stop the active workflow before spending more.",
				recommendedAction: "Stop active work and ask the lead agent to summarize partial results.",
			}
		}

		return {
			...base,
			decision: "block",
			severity: "critical",
			machineCode: "SUPERVISION_BLOCK_BUDGET_EXCEEDED",
			retryable: false,
			reason: `Workflow cost ${input.totalCost.toFixed(4)} is at or above budget ${configuredBudget.toFixed(4)}.`,
			operatorMessage: "Budget exceeded. Nexus Builder blocked new work for this workflow.",
			recommendedAction: "Review current results, raise the budget, or start a smaller follow-up task.",
		}
	}

	if (input.childAgentCount >= maxChildren) {
		return {
			...base,
			decision: "block",
			severity: "critical",
			machineCode: "SUPERVISION_BLOCK_MAX_CHILDREN",
			retryable: false,
			reason: `Child-agent count ${input.childAgentCount} reached max ${maxChildren}.`,
			operatorMessage: "Maximum child-agent count reached. Nexus Builder blocked new delegated work.",
			recommendedAction: "Wait for children to finish or summarize before spawning more agents.",
		}
	}

	if (input.runningAgentCount >= maxConcurrentAgents) {
		return {
			...base,
			decision: "throttle",
			severity: "warning",
			machineCode: "SUPERVISION_THROTTLE_CONCURRENCY",
			retryable: true,
			reason: `Running-agent count ${input.runningAgentCount} reached max concurrency ${maxConcurrentAgents}.`,
			operatorMessage: "Too many agents are already running. Nexus Builder throttled new work.",
			recommendedAction: "Retry after one or more active agents complete.",
		}
	}

	if (input.failedAgentCount > 0) {
		return {
			...base,
			decision: "warn",
			severity: "warning",
			machineCode: "SUPERVISION_WARN_CHILD_FAILURES",
			retryable: true,
			reason: `${input.failedAgentCount} child agent${input.failedAgentCount === 1 ? "" : "s"} failed.`,
			operatorMessage: "One or more child agents failed. Continuing is allowed but risky.",
			recommendedAction: "Inspect failed child sessions before delegating more work.",
		}
	}

	if (input.totalCost >= configuredBudget * budgetWarningRatio) {
		return {
			...base,
			decision: "warn",
			severity: "warning",
			machineCode: "SUPERVISION_WARN_COST_APPROACHING_BUDGET",
			retryable: true,
			reason: `Workflow cost ${input.totalCost.toFixed(4)} is near budget ${configuredBudget.toFixed(4)}.`,
			operatorMessage: "Workflow spend is approaching the configured budget.",
			recommendedAction: "Use concise prompts and avoid optional child-agent work.",
		}
	}

	if (input.totalTokens >= highTokenThreshold) {
		return {
			...base,
			decision: "warn",
			severity: "warning",
			machineCode: "SUPERVISION_WARN_HIGH_TOKENS",
			retryable: true,
			reason: `Workflow token usage ${input.totalTokens} reached warning threshold ${highTokenThreshold}.`,
			operatorMessage: "Token usage is high for this workflow.",
			recommendedAction: "Compact context or ask for a summary before continuing.",
		}
	}

	return {
		...base,
		decision: "allow",
		severity: "info",
		machineCode: "SUPERVISION_ALLOW",
		retryable: true,
		reason: "Workflow is within supervision policy limits.",
		operatorMessage: "Workflow is within policy limits.",
		recommendedAction:
			input.waitingAgentCount > 0
				? "Respond to pending child-agent requests before adding more work."
				: "Continue normally.",
	}
}
