import { atom } from "jotai"
import { atomFamily, atomWithStorage } from "jotai/utils"
import {
	appendSupervisionEvent,
	createSupervisionEvent,
	type SupervisionEvent,
} from "../lib/supervision-events"
import type { SupervisionPolicyInput, SupervisionPolicyResult } from "../lib/supervision-policy"

export const supervisionEventsAtom = atomWithStorage<SupervisionEvent[]>(
	"palot:supervision-events",
	[],
)

export const recordSupervisionEventAtom = atom(
	null,
	(
		get,
		set,
		args: {
			policy: SupervisionPolicyResult
			input: SupervisionPolicyInput
			sessionId?: string
		},
	) => {
		const event = createSupervisionEvent(args)
		if (!event) return

		const result = appendSupervisionEvent(get(supervisionEventsAtom), event)
		if (result.persisted) {
			set(supervisionEventsAtom, result.events)
		}
	},
)

export const supervisionEventsForWorkflowFamily = atomFamily((workflowId: string) =>
	atom((get) =>
		get(supervisionEventsAtom)
			.filter((event) => event.workflowId === workflowId || event.sessionId === workflowId)
			.slice(0, 5),
	),
)
