import { createLogger } from "../../lib/logger"
import { queryClient } from "../../lib/query-client"
import {
	appendPermissionAuditLog,
	createPermissionAuditEntry,
	evaluatePermissionBatch,
	evaluatePermissionRequest,
	getProjectTrustMemory,
	getProjectTrustProfile,
	type PermissionLike,
} from "../../lib/trust-permissions"
import type { Event } from "../../lib/types"
import { connectToServer } from "../../services/opencode"
import { authHeaderAtom, serverConnectedAtom, serverUrlAtom } from "../connection"
import { discoveryAtom } from "../discovery"
import { removeMessageAtom, upsertMessageAtom } from "../messages"
import { applyPartDeltaAtom, removePartAtom, upsertPartAtom } from "../parts"
import { recordSessionActivityAtom } from "../session-heartbeats"
import {
	addPermissionAtom,
	addQuestionAtom,
	removePermissionAtom,
	removeQuestionAtom,
	removeSessionAtom,
	setSessionErrorAtom,
	setSessionStatusAtom,
	sessionFamily,
	upsertSessionAtom,
} from "../sessions"
import { appStore } from "../store"
import { isStreamingField, isStreamingPartType, streamingVersionFamily } from "../streaming"
import { todosFamily } from "../todos"
import { setSessionDiffAtom } from "../ui"

const log = createLogger("event-processor")
const isElectron = typeof window !== "undefined" && "palot" in window
const PERMISSION_BATCH_DELAY_MS = 75
const pendingPermissionRequests: PermissionLike[] = []
let permissionBatchTimer: ReturnType<typeof setTimeout> | null = null

function getEventSessionId(event: Event): string | undefined {
	switch (event.type) {
		case "session.created":
		case "session.updated":
		case "session.deleted":
			return event.properties.info.id
		case "session.status":
		case "session.error":
		case "permission.replied":
		case "question.replied":
		case "question.rejected":
		case "message.removed":
		case "message.part.removed":
		case "todo.updated":
		case "session.diff":
			return event.properties.sessionID
		case "permission.asked":
		case "question.asked":
			return event.properties.sessionID
		case "message.updated":
			return event.properties.info.sessionID
		case "message.part.updated":
			return event.properties.part.sessionID
		case "message.part.delta":
			return event.properties.sessionID
		default:
			return undefined
	}
}

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

async function autoRespondToPermission(request: PermissionLike, batchId?: string): Promise<boolean> {
	const entry = appStore.get(sessionFamily(request.sessionID))
	const directory = entry?.directory
	const serverUrl = appStore.get(serverUrlAtom)
	if (!directory || !serverUrl || !isElectron) return false

	try {
		const settings = await window.palot.getSettings()
		const profile = getProjectTrustProfile(settings.trust, directory)
		const memory = getProjectTrustMemory(settings.trust, directory, profile)
		const decision = evaluatePermissionRequest({
			request,
			projectPath: directory,
			profile,
			memory,
		})

		if (decision.action === "require-approval") return false

		const client = connectToServer(serverUrl, {
			directory,
			authHeader: appStore.get(authHeaderAtom) ?? undefined,
		})
		await client.permission.respond({
			sessionID: request.sessionID,
			permissionID: request.id,
			response: decision.action === "deny" ? "reject" : "once",
		})

		const latestSettings = await window.palot.getSettings()
		await window.palot.updateSettings({
			trust: appendPermissionAuditLog(
				latestSettings.trust,
				createPermissionAuditEntry({
					request,
					projectPath: directory,
					profile,
					decision,
					batchId,
				}),
			),
		})
		log.info("Permission handled by trust profile", {
			sessionId: request.sessionID,
			permissionId: request.id,
			permission: request.permission,
			profile,
			decision: decision.action,
			reason: decision.reason,
		})
		return true
	} catch (err) {
		log.warn("Auto permission response failed; falling back to manual approval", {
			sessionId: request.sessionID,
			permissionId: request.id,
		}, err)
		return false
	}
}

function handlePermissionAsked(request: PermissionLike): void {
	pendingPermissionRequests.push(request)
	if (permissionBatchTimer) return
	permissionBatchTimer = setTimeout(() => {
		permissionBatchTimer = null
		const requests = pendingPermissionRequests.splice(0)
		processPermissionBatch(requests)
	}, PERMISSION_BATCH_DELAY_MS)
}

function processPermissionBatch(requests: PermissionLike[]): void {
	const byProject = new Map<string, PermissionLike[]>()
	const manualRequests: PermissionLike[] = []

	for (const request of requests) {
		const entry = appStore.get(sessionFamily(request.sessionID))
		const directory = entry?.directory
		if (!directory) {
			manualRequests.push(request)
			continue
		}
		const key = `${directory}\u0000${request.sessionID}`
		byProject.set(key, [...(byProject.get(key) ?? []), request])
	}

	for (const request of manualRequests) {
		addManualPermission(request)
	}

	for (const group of byProject.values()) {
		processProjectPermissionBatch(group)
	}
}

function processProjectPermissionBatch(requests: PermissionLike[]): void {
	if (requests.length === 0) return
	const first = requests[0]
	const entry = appStore.get(sessionFamily(first.sessionID))
	const directory = entry?.directory
	const serverUrl = appStore.get(serverUrlAtom)
	if (!directory || !serverUrl || !isElectron) {
		for (const request of requests) addManualPermission(request)
		return
	}

	window.palot
		.getSettings()
		.then(async (settings) => {
			const profile = getProjectTrustProfile(settings.trust, directory)
			const memory = getProjectTrustMemory(settings.trust, directory, profile)
			const decisions = evaluatePermissionBatch(requests, {
				projectPath: directory,
				profile,
				memory,
			})

			for (const decision of decisions) {
				if (decision.action === "require-approval") {
					addManualPermission(decision.request)
					continue
				}
				const handled = await autoRespondToPermission(decision.request, decision.batchId)
				if (!handled) addManualPermission(decision.request)
			}
		})
		.catch((err) => {
			log.warn("Permission batch evaluation failed; falling back to manual approval", err)
			for (const request of requests) addManualPermission(request)
		})
}

function addManualPermission(request: PermissionLike): void {
	appStore.set(addPermissionAtom, {
		sessionId: request.sessionID,
		permission: request,
	})
}

/**
 * Central SSE event dispatcher.
 * A standalone function that writes to Jotai atoms via the store API.
 * Called by the event batcher in connection-manager.
 */
export function processEvent(event: Event): void {
	const { set } = appStore
	const sessionId = getEventSessionId(event)
	if (sessionId) {
		set(recordSessionActivityAtom, { sessionId })
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
			handlePermissionAsked(event.properties)
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

		case "message.part.updated": {
			const part = event.properties.part
			set(upsertPartAtom, part)
			// Non-streaming parts (tool calls, files) bypass the streaming buffer
			// and update partsFamily directly. Since useSessionChat reads parts
			// imperatively (appStore.get) rather than subscribing, we must bump
			// the per-session streaming version to trigger a re-render so the UI
			// picks up newly added or updated tool call cards.
			if (!isStreamingPartType(part)) {
				set(streamingVersionFamily(part.sessionID), (v) => v + 1)
			}
			break
		}

		case "message.part.delta": {
			const { messageID, partID, field, delta, sessionID } = event.properties
			set(applyPartDeltaAtom, { messageId: messageID, partId: partID, field, delta })
			// Non-streaming field deltas (e.g. tool input) bypass the streaming
			// buffer and land directly in partsFamily. Bump the version so the
			// UI re-renders to show the updated content.
			if (!isStreamingField(field)) {
				set(streamingVersionFamily(sessionID), (v) => v + 1)
			}
			break
		}

		case "message.part.removed": {
			const { messageID, partID, sessionID } = event.properties
			set(removePartAtom, { messageId: messageID, partId: partID })
			// Part removal changes the visible part list, so notify the session.
			set(streamingVersionFamily(sessionID), (v) => v + 1)
			break
		}

		case "todo.updated":
			set(todosFamily(event.properties.sessionID), event.properties.todos)
			break

		case "session.diff": {
			const { sessionID, diff } = event.properties as {
				sessionID: string
				diff: import("../../lib/types").FileDiff[]
			}
			if (sessionID && diff) {
				set(setSessionDiffAtom, { sessionId: sessionID, diffs: diff })
			}
			break
		}

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
