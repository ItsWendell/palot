/**
 * Ephemeral per-session context compaction action state.
 */
import { atom } from "jotai"
import { atomFamily } from "jotai-family"
import type { ContextCompactionState } from "../lib/context-compaction-policy"

export interface ContextCompactionActionState {
	state: Extract<ContextCompactionState, "AUTO_COMPACTING" | "COMPACTED"> | null
	updatedAt: number
	error?: string
	/** Brain snapshot text to prepend to the next user message after compaction. */
	pendingContextRestore?: string
}

export const contextCompactionActionFamily = atomFamily((_sessionId: string) =>
	atom<ContextCompactionActionState>({
		state: null,
		updatedAt: 0,
	}),
)
