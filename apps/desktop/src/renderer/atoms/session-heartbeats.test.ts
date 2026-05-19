import { describe, expect, test } from "bun:test"
import type { Event, Session } from "../lib/types"
import { processEvent } from "./actions/event-processor"
import { sessionLastActivityFamily } from "./session-heartbeats"
import { removeSessionAtom, upsertSessionAtom } from "./sessions"
import { appStore } from "./store"

function session(id: string): Session {
	return {
		id,
		slug: id,
		projectID: "project-1",
		directory: "/tmp/palot-heartbeat",
		title: id,
		version: "1",
		time: { created: 1, updated: 1 },
	}
}

describe("session heartbeats", () => {
	test("records activity when session-scoped SSE events are processed", () => {
		const sessionId = "heartbeat-event-session"
		try {
			appStore.set(upsertSessionAtom, { session: session(sessionId), directory: "/tmp/palot-heartbeat" })
			const before = Date.now()
			processEvent({
				type: "session.status",
				properties: {
					sessionID: sessionId,
					status: { type: "busy" },
				},
			} as Event)
			const recorded = appStore.get(sessionLastActivityFamily(sessionId))
			expect(recorded).toBeGreaterThanOrEqual(before)
			expect(recorded).toBeLessThanOrEqual(Date.now())
		} finally {
			appStore.set(removeSessionAtom, sessionId)
		}
	})
})
