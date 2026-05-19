export interface DiffComment {
	id: string
	filePath: string
	lineNumber: number
	side: "additions" | "deletions"
	content: string
	createdAt: number
}

/**
 * Serialize diff comments into structured context to prepend to a user message.
 * Returns empty string if no comments exist.
 */
export function serializeCommentsForChat(comments: DiffComment[]): string {
	if (comments.length === 0) return ""

	const lines = ["[Code Review Comments]", ""]
	for (const comment of comments) {
		const side = comment.side === "additions" ? "new" : "old"
		lines.push(`- ${comment.filePath}:${comment.lineNumber} (${side}): ${comment.content}`)
	}
	lines.push("")
	return lines.join("\n")
}
