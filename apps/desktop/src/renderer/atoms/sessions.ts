import { atom } from "jotai"
import { atomFamily } from "jotai-family"
import type { Permission, QuestionRequest, Session, SessionStatus } from "../lib/types"

// ============================================================
// Types
// ============================================================

/** Error type from session.error events */
export type SessionError = {
	name: string
	data: Record<string, unknown>
}

export interface SessionEntry {
	session: Session
	status: SessionStatus
	/** Pending permission requests */
	permissions: Permission[]
	/** Pending question requests */
	questions: QuestionRequest[]
	/** Project directory this session belongs to */
	directory: string
	/** Git branch at the time this session was created */
	branch?: string
	/** Last session-level error (from session.error events) */
	error?: SessionError
}

// ============================================================
// Index atom — tracks all known session IDs
// ============================================================

export const sessionIdsAtom = atom<Set<string>>(new Set<string>())

// ============================================================
// Per-session atom family
// ============================================================

export const sessionFamily = atomFamily((_sessionId: string) => atom<SessionEntry | null>(null))

// ============================================================
// Write-only action atoms
// ============================================================

export const upsertSessionAtom = atom(
	null,
	(
		get,
		set,
		args: {
			session: Session
			directory: string
		},
	) => {
		const { session, directory } = args
		const existing = get(sessionFamily(session.id))

		set(sessionFamily(session.id), {
			session,
			directory: existing?.directory ?? directory,
			status: existing?.status ?? { type: "idle" },
			permissions: existing?.permissions ?? [],
			questions: existing?.questions ?? [],
			branch: existing?.branch,
			error: existing?.error,
		})

		// Add to index
		const ids = get(sessionIdsAtom)
		if (!ids.has(session.id)) {
			const next = new Set(ids)
			next.add(session.id)
			set(sessionIdsAtom, next)
		}
	},
)

export const removeSessionAtom = atom(null, (get, set, sessionId: string) => {
	sessionFamily.remove(sessionId)

	const ids = get(sessionIdsAtom)
	if (ids.has(sessionId)) {
		const next = new Set(ids)
		next.delete(sessionId)
		set(sessionIdsAtom, next)
	}
})

export const setSessionStatusAtom = atom(
	null,
	(
		get,
		set,
		args: {
			sessionId: string
			status: SessionStatus
		},
	) => {
		const entry = get(sessionFamily(args.sessionId))
		if (!entry) return
		set(sessionFamily(args.sessionId), { ...entry, status: args.status })
	},
)

export const setSessionErrorAtom = atom(
	null,
	(
		get,
		set,
		args: {
			sessionId: string
			error: SessionError | undefined
		},
	) => {
		const entry = get(sessionFamily(args.sessionId))
		if (!entry) return
		set(sessionFamily(args.sessionId), { ...entry, error: args.error })
	},
)

export const setSessionBranchAtom = atom(
	null,
	(
		get,
		set,
		args: {
			sessionId: string
			branch: string
		},
	) => {
		const entry = get(sessionFamily(args.sessionId))
		if (!entry) return
		set(sessionFamily(args.sessionId), { ...entry, branch: args.branch })
	},
)

export const addPermissionAtom = atom(
	null,
	(
		get,
		set,
		args: {
			sessionId: string
			permission: Permission
		},
	) => {
		const entry = get(sessionFamily(args.sessionId))
		if (!entry) return
		set(sessionFamily(args.sessionId), {
			...entry,
			permissions: [...entry.permissions, args.permission],
		})
	},
)

export const removePermissionAtom = atom(
	null,
	(
		get,
		set,
		args: {
			sessionId: string
			permissionId: string
		},
	) => {
		const entry = get(sessionFamily(args.sessionId))
		if (!entry) return
		set(sessionFamily(args.sessionId), {
			...entry,
			permissions: entry.permissions.filter((p) => p.id !== args.permissionId),
		})
	},
)

export const addQuestionAtom = atom(
	null,
	(
		get,
		set,
		args: {
			sessionId: string
			question: QuestionRequest
		},
	) => {
		const entry = get(sessionFamily(args.sessionId))
		if (!entry) return
		// Avoid duplicates
		if (entry.questions.some((q) => q.id === args.question.id)) return
		set(sessionFamily(args.sessionId), {
			...entry,
			questions: [...entry.questions, args.question],
		})
	},
)

export const removeQuestionAtom = atom(
	null,
	(
		get,
		set,
		args: {
			sessionId: string
			requestId: string
		},
	) => {
		const entry = get(sessionFamily(args.sessionId))
		if (!entry) return
		set(sessionFamily(args.sessionId), {
			...entry,
			questions: entry.questions.filter((q) => q.id !== args.requestId),
		})
	},
)

/**
 * Bulk-set sessions (used during project load).
 * Merges new sessions into the store without overwriting
 * permissions/questions that arrived via SSE before the fetch completed.
 */
export const setSessionsAtom = atom(
	null,
	(
		get,
		set,
		args: {
			sessions: Session[]
			statuses: Record<string, SessionStatus>
			directory: string
		},
	) => {
		const currentIds = get(sessionIdsAtom)
		const nextIds = new Set(currentIds)

		for (const session of args.sessions) {
			const existing = get(sessionFamily(session.id))
			set(sessionFamily(session.id), {
				session,
				status: args.statuses[session.id] ?? existing?.status ?? { type: "idle" },
				permissions: existing?.permissions ?? [],
				questions: existing?.questions ?? [],
				directory: args.directory,
				branch: existing?.branch,
				error: existing?.error,
			})
			nextIds.add(session.id)
		}

		if (nextIds.size !== currentIds.size) {
			set(sessionIdsAtom, nextIds)
		}
	},
)
