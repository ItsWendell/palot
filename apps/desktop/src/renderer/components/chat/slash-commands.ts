export interface ParsedSlashCommand {
	name: string
	arguments: string
}

export function parseSlashCommand(text: string): ParsedSlashCommand | null {
	const trimmed = text.trim()
	if (!trimmed.startsWith("/")) return null

	const spaceIndex = trimmed.indexOf(" ")
	const name = spaceIndex === -1 ? trimmed.slice(1) : trimmed.slice(1, spaceIndex)
	const args = spaceIndex === -1 ? "" : trimmed.slice(spaceIndex + 1).trim()

	return { name, arguments: args }
}

export function isClientHandledSlashCommand(name: string): boolean {
	return ["undo", "redo", "compact", "summarize"].includes(name.toLowerCase())
}

/** Reserved command names that must not be matched against skills. */
const RESERVED_COMMANDS = new Set(["undo", "redo", "compact", "summarize", "skills", "fork", "research"])

/**
 * Returns true when a command name could refer to a user skill rather than a
 * built-in or server command. Callers should still check the skill registry —
 * this only filters out names that are definitively reserved.
 */
export function isCandidateForSkillResolution(name: string): boolean {
	return !RESERVED_COMMANDS.has(name.toLowerCase())
}
