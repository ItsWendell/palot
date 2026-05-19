import type { ModelRef } from "../../hooks/use-opencode-data"
import type { FileAttachment } from "../../lib/types"
import {
	type DiffComment,
	serializeCommentsForChat,
} from "../review/diff-comment-model"

export interface PreparedChatMessage {
	text: string
	options: {
		model?: ModelRef
		agentName?: string
		variant?: string
		files?: FileAttachment[]
	}
}

export function buildChatMessageText(text: string, diffComments: DiffComment[]): string {
	const trimmed = text.trim()
	const commentPrefix = serializeCommentsForChat(diffComments)
	return commentPrefix ? `${commentPrefix}${trimmed}` : trimmed
}

export function prepareChatMessage({
	text,
	diffComments,
	effectiveModel,
	selectedAgent,
	selectedVariant,
	files,
}: {
	text: string
	diffComments: DiffComment[]
	effectiveModel: ModelRef | null
	selectedAgent: string | null
	selectedVariant?: string
	files?: FileAttachment[]
}): PreparedChatMessage {
	return {
		text: buildChatMessageText(text, diffComments),
		options: {
			model: effectiveModel ?? undefined,
			agentName: selectedAgent || undefined,
			variant: selectedVariant,
			files,
		},
	}
}
