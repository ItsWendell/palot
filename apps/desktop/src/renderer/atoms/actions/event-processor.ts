import { createLogger } from "../../lib/logger"
import { queryClient } from "../../lib/query-client"
import type { Event, QuestionRequest } from "../../lib/types"
import { serverConnectedAtom } from "../connection"
import { removeMessageAtom, upsertMessageAtom } from "../messages"
import { removePartAtom, upsertPartAtom } from "../parts"
import {
	addPermissionAtom,
	addQuestionAtom,
	removePermissionAtom,
	removeQuestionAtom,
	removeSessionAtom,
	type SessionError,
	setSessionErrorAtom,
	setSessionStatusAtom,
	upsertSessionAtom,
} from "../sessions"
import { appStore } from "../store"
import { todosFamily } from "../todos"

const log = createLogger("event-processor")

/**
 * Invalidate all OpenCode data queries for a specific directory.
 * Called when an instance is disposed so the UI re-fetches config, agents, providers, etc.
 */
function invalidateDirectoryQueries(directory: string): void {
	log.info("Invalidating queries for disposed instance", { directory })
	for (const key of ["config", "providers", "agents", "commands", "vcs"]) {
		queryClient.invalidateQueries({ queryKey: [key, directory] })
	}
}

/**
 * Invalidate all OpenCode data queries across all directories.
 * Called when a global dispose event occurs (e.g. global config change).
 */
function invalidateAllQueries(): void {
	log.info("Invalidating all OpenCode queries (global dispose)")
	for (const key of ["config", "providers", "agents", "commands", "vcs"]) {
		queryClient.invalidateQueries({ queryKey: [key] })
	}
}

/**
 * Central SSE event dispatcher.
 * A standalone function that writes to Jotai atoms via the store API.
 * Called by the event batcher in connection-manager.
 */
export function processEvent(event: Event): void {
	const { set } = appStore

	// Handle question events first (not in SDK's Event discriminant)
	const eventType = event.type as string
	if (eventType === "question.asked") {
		const props = (event as unknown as { properties: QuestionRequest }).properties
		set(addQuestionAtom, { sessionId: props.sessionID, question: props })
		return
	}
	if (eventType === "question.replied") {
		const props = (event as unknown as { properties: { sessionID: string; requestID: string } })
			.properties
		set(removeQuestionAtom, { sessionId: props.sessionID, requestId: props.requestID })
		return
	}
	if (eventType === "question.rejected") {
		const props = (event as unknown as { properties: { sessionID: string; requestID: string } })
			.properties
		set(removeQuestionAtom, { sessionId: props.sessionID, requestId: props.requestID })
		return
	}
	if (eventType === "global.disposed") {
		invalidateAllQueries()
		return
	}

	switch (event.type) {
		case "server.connected":
			set(serverConnectedAtom, true)
			break

		case "server.instance.disposed": {
			const directory = event.properties.directory
			if (directory) {
				invalidateDirectoryQueries(directory)
			}
			break
		}

		case "session.created": {
			const info = event.properties.info
			set(upsertSessionAtom, { session: info, directory: info.directory ?? "" })
			break
		}

		case "session.updated": {
			const info = event.properties.info
			set(upsertSessionAtom, { session: info, directory: info.directory ?? "" })
			break
		}

		case "session.deleted":
			set(removeSessionAtom, event.properties.info.id)
			break

		case "session.status":
			set(setSessionStatusAtom, {
				sessionId: event.properties.sessionID,
				status: event.properties.status,
			})
			// Clear error when session starts working again
			if (event.properties.status.type !== "idle") {
				set(setSessionErrorAtom, {
					sessionId: event.properties.sessionID,
					error: undefined,
				})
			}
			break

		case "session.error": {
			const sessionID = event.properties.sessionID
			const error = event.properties.error
			if (sessionID && error) {
				set(setSessionErrorAtom, {
					sessionId: sessionID,
					error: error as SessionError,
				})
			}
			break
		}

		case "permission.updated":
			set(addPermissionAtom, {
				sessionId: event.properties.sessionID,
				// biome-ignore lint/suspicious/noExplicitAny: event properties are untyped from SSE
				permission: event.properties as any,
			})
			break

		case "permission.replied":
			set(removePermissionAtom, {
				sessionId: event.properties.sessionID,
				permissionId: event.properties.permissionID,
			})
			break

		case "message.updated":
			set(upsertMessageAtom, event.properties.info)
			break

		case "message.removed":
			set(removeMessageAtom, {
				sessionId: event.properties.sessionID,
				messageId: event.properties.messageID,
			})
			break

		case "message.part.updated":
			set(upsertPartAtom, event.properties.part)
			break

		case "message.part.removed":
			set(removePartAtom, {
				messageId: event.properties.messageID,
				partId: event.properties.partID,
			})
			break

		case "todo.updated":
			set(todosFamily(event.properties.sessionID), event.properties.todos)
			break
	}
}
