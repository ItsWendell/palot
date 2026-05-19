export type AgentLifecycleState =
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

export type AutomationErrorCategory =
	| "ConfigurationError"
	| "SpawnError"
	| "TimeoutError"
	| "ProviderError"
	| "ValidationError"
	| "RateLimitError"
	| "BudgetExceededError"
	| "CancellationError"
	| "InternalError"

export interface AutomationErrorContext {
	automationId?: string
	runId?: string
	sessionId?: string
	workspace?: string
	operation?: string
	attempt?: number
}

export interface StructuredAutomationError {
	category: AutomationErrorCategory
	message: string
	userMessage: string
	retryable: boolean
	timestamp: string
	context: AutomationErrorContext
	stack?: string
	cause?: unknown
}

export interface RetryDecision {
	shouldRetry: boolean
	delayMs: number
	reason: string
	nextAttempt: number
}

export interface AutomationLifecycleEvent {
	timestamp: string
	workflowId: string
	agentId: string | null
	parentAgentId: string | null
	taskId: string
	eventType: string
	state: AgentLifecycleState
	durationMs?: number
	tokenUsage?: number
	estimatedCost?: number
	attempt?: number
	error?: Pick<StructuredAutomationError, "category" | "message" | "retryable" | "userMessage">
	metadata?: Record<string, unknown>
}

function messageFrom(error: unknown): string {
	if (error instanceof Error) return error.message
	if (typeof error === "string") return error
	return String(error)
}

function stackFrom(error: unknown): string | undefined {
	return error instanceof Error ? error.stack : undefined
}

export function classifyAutomationError(
	error: unknown,
	context: AutomationErrorContext = {},
): StructuredAutomationError {
	const message = messageFrom(error)
	const normalized = message.toLowerCase()
	let category: AutomationErrorCategory = "InternalError"
	let retryable = false
	let userMessage = "The automation failed unexpectedly. Check the logs for details."

	if (normalized.includes("budget")) {
		category = "BudgetExceededError"
		userMessage = "The automation stopped because it exceeded the configured budget."
	} else if (
		normalized.includes("cancel") ||
		normalized.includes("abort") ||
		normalized.includes("aborted")
	) {
		category = "CancellationError"
		userMessage = "The automation was cancelled before it completed."
	} else if (normalized.includes("timed out") || normalized.includes("timeout")) {
		category = "TimeoutError"
		retryable = true
		userMessage = "The automation timed out while waiting for the agent or provider."
	} else if (normalized.includes("rate limit") || normalized.includes("429")) {
		category = "RateLimitError"
		retryable = true
		userMessage = "The model provider rate-limited the request. Nexus Builder can retry after a delay."
	} else if (
		normalized.includes("unauthorized") ||
		normalized.includes("forbidden") ||
		normalized.includes("api key") ||
		normalized.includes("401") ||
		normalized.includes("403")
	) {
		category = "ProviderError"
		userMessage = "The model provider rejected the request. Check authentication and provider access."
	} else if (
		normalized.includes("econnreset") ||
		normalized.includes("network") ||
		normalized.includes("fetch failed") ||
		normalized.includes("503") ||
		normalized.includes("502") ||
		normalized.includes("provider")
	) {
		category = "ProviderError"
		retryable = true
		userMessage = "The provider or network connection failed temporarily. Nexus Builder can retry safely."
	} else if (
		normalized.includes("enoent") ||
		normalized.includes("executable") ||
		normalized.includes("command not found") ||
		normalized.includes("no opencode server")
	) {
		category = "SpawnError"
		userMessage = "Nexus Builder could not start or reach the OpenCode runtime."
	} else if (
		normalized.includes("json") ||
		normalized.includes("parse") ||
		normalized.includes("malformed") ||
		normalized.includes("no session id")
	) {
		category = "ValidationError"
		userMessage = "The agent returned an invalid response that Nexus Builder could not safely process."
	}

	return {
		category,
		message,
		userMessage,
		retryable,
		timestamp: new Date().toISOString(),
		context,
		stack: stackFrom(error),
		cause: error,
	}
}

export function getRetryDecision({
	error,
	attempt,
	maxAttempts,
	baseDelaySec,
	jitter = Math.random,
}: {
	error: StructuredAutomationError
	attempt: number
	maxAttempts: number
	baseDelaySec: number
	jitter?: () => number
}): RetryDecision {
	const nextAttempt = attempt + 1
	if (!error.retryable) {
		return {
			shouldRetry: false,
			delayMs: 0,
			reason: `${error.category} is not retryable`,
			nextAttempt,
		}
	}
	if (attempt >= maxAttempts) {
		return {
			shouldRetry: false,
			delayMs: 0,
			reason: "retry cap reached",
			nextAttempt,
		}
	}

	const baseMs = Math.max(0, baseDelaySec * 1000)
	const exponentialMs = baseMs * 2 ** Math.max(0, attempt - 1)
	const jitterMs = Math.round(exponentialMs * 0.2 * jitter())
	return {
		shouldRetry: true,
		delayMs: exponentialMs + jitterMs,
		reason: `${error.category} is retryable`,
		nextAttempt,
	}
}

export function createLifecycleEvent({
	workflowId,
	agentId = null,
	parentAgentId = null,
	taskId,
	eventType,
	state,
	durationMs,
	tokenUsage,
	estimatedCost,
	attempt,
	error,
	metadata,
}: Omit<AutomationLifecycleEvent, "timestamp">): AutomationLifecycleEvent {
	return {
		timestamp: new Date().toISOString(),
		workflowId,
		agentId,
		parentAgentId,
		taskId,
		eventType,
		state,
		durationMs,
		tokenUsage,
		estimatedCost,
		attempt,
		error,
		metadata,
	}
}
