import { createLogger } from "../../lib/logger"
import { queryClient } from "../../lib/query-client"
import type { Event } from "../../lib/types"
import { serverConnectedAtom } from "../connection"
import { discoveryAtom } from "../discovery"
import { removeMessageAtom, upsertMessageAtom } from "../messages"
import { applyPartDeltaAtom, removePartAtom, upsertPartAtom } from "../parts"
import {
	addPermissionAtom,
	addQuestionAtom,
	removePermissionAtom,
	removeQuestionAtom,
	removeSessionAtom,
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

		case "global.disposed":
			invalidateAllQueries()
			break

		case "project.updated": {
			const project = event.properties
			if (project.id && project.worktree) {
				const current = appStore.get(discoveryAtom)
				const existing = current.projects.findIndex((p) => p.id === project.id)
				const nextProjects =
					existing >= 0
						? current.projects.map((p, i) => (i === existing ? project : p))
						: [...current.projects, project]
				set(discoveryAtom, { ...current, projects: nextProjects })
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
			const { sessionID, error } = event.properties
			if (sessionID && error) {
				set(setSessionErrorAtom, {
					sessionId: sessionID,
					error: { name: error.name, data: error.data },
				})
			}
			break
		}

		case "permission.asked":
			set(addPermissionAtom, {
				sessionId: event.properties.sessionID,
				permission: event.properties,
			})
			break

		case "permission.replied":
			set(removePermissionAtom, {
				sessionId: event.properties.sessionID,
				permissionId: event.properties.requestID,
			})
			break

		case "question.asked":
			set(addQuestionAtom, {
				sessionId: event.properties.sessionID,
				question: event.properties,
			})
			break

		case "question.replied":
			set(removeQuestionAtom, {
				sessionId: event.properties.sessionID,
				requestId: event.properties.requestID,
			})
			break

		case "question.rejected":
			set(removeQuestionAtom, {
				sessionId: event.properties.sessionID,
				requestId: event.properties.requestID,
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

		case "message.part.delta":
			set(applyPartDeltaAtom, {
				messageId: event.properties.messageID,
				partId: event.properties.partID,
				field: event.properties.field,
				delta: event.properties.delta,
			})
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

		// --- Worktree lifecycle events (from OpenCode experimental API) ---

		case "worktree.ready":
			log.info("Worktree ready", {
				name: event.properties.name,
				branch: event.properties.branch,
			})
			break

		case "worktree.failed":
			log.warn("Worktree creation failed", {
				message: event.properties.message,
			})
			break
	}
}
