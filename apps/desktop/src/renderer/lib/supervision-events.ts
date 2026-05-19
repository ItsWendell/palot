import type {
	SupervisionDecision,
	SupervisionMachineCode,
	SupervisionPolicyInput,
	SupervisionPolicyResult,
	SupervisionSeverity,
} from "./supervision-policy"

export interface SupervisionEvent {
	id: string
	timestamp: string
	workflowId: string
	sessionId: string
	parentAgentId: string
	decision: Exclude<SupervisionDecision, "allow">
	severity: SupervisionSeverity
	machineCode: Exclude<SupervisionMachineCode, "SUPERVISION_ALLOW">
	reason: string
	operatorMessage: string
	recommendedAction: string
	totalTokens: number
	totalCost: number
	childAgentCount: number
	runningAgentCount: number
	failedAgentCount: number
	waitingAgentCount: number
}

export interface SupervisionEventCreateArgs {
	policy: SupervisionPolicyResult
	input: SupervisionPolicyInput
	sessionId?: string
	now?: number
}

export interface SupervisionEventAppendResult {
	events: SupervisionEvent[]
	persisted: boolean
}

export const MAX_SUPERVISION_EVENTS = 100

export function shouldPersistSupervisionDecision(policy: SupervisionPolicyResult): boolean {
	return policy.decision !== "allow"
}

function isPersistablePolicy(
	policy: SupervisionPolicyResult,
): policy is SupervisionPolicyResult & {
	decision: Exclude<SupervisionDecision, "allow">
	machineCode: Exclude<SupervisionMachineCode, "SUPERVISION_ALLOW">
} {
	return policy.decision !== "allow" && policy.machineCode !== "SUPERVISION_ALLOW"
}

export function createSupervisionEvent({
	policy,
	input,
	sessionId = input.workflowId,
	now = Date.now(),
}: SupervisionEventCreateArgs): SupervisionEvent | null {
	if (!isPersistablePolicy(policy)) return null

	return {
		id: `${input.workflowId}:${policy.machineCode}:${now}`,
		timestamp: new Date(now).toISOString(),
		workflowId: input.workflowId,
		sessionId,
		parentAgentId: input.parentAgentId,
		decision: policy.decision,
		severity: policy.severity,
		machineCode: policy.machineCode,
		reason: policy.reason,
		operatorMessage: policy.operatorMessage,
		recommendedAction: policy.recommendedAction,
		totalTokens: input.totalTokens,
		totalCost: input.totalCost,
		childAgentCount: input.childAgentCount,
		runningAgentCount: input.runningAgentCount,
		failedAgentCount: input.failedAgentCount,
		waitingAgentCount: input.waitingAgentCount,
	}
}

export function getSupervisionEventFingerprint(event: SupervisionEvent): string {
	return [
		event.workflowId,
		event.sessionId,
		event.parentAgentId,
		event.decision,
		event.machineCode,
		event.severity,
		event.reason,
		event.totalTokens,
		event.totalCost.toFixed(6),
		event.childAgentCount,
		event.runningAgentCount,
		event.failedAgentCount,
		event.waitingAgentCount,
	].join("|")
}

export function appendSupervisionEvent(
	currentEvents: SupervisionEvent[],
	event: SupervisionEvent,
	maxEvents = MAX_SUPERVISION_EVENTS,
): SupervisionEventAppendResult {
	const fingerprint = getSupervisionEventFingerprint(event)
	const latestMatchingEvent = currentEvents.find(
		(existing) =>
			existing.workflowId === event.workflowId &&
			existing.sessionId === event.sessionId &&
			existing.machineCode === event.machineCode,
	)

	if (latestMatchingEvent && getSupervisionEventFingerprint(latestMatchingEvent) === fingerprint) {
		return { events: currentEvents, persisted: false }
	}

	return {
		events: [event, ...currentEvents].slice(0, maxEvents),
		persisted: true,
	}
}
