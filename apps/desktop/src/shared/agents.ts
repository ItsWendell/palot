/**
 * Type definitions for agent definitions read from .opencode/agents/*.md files.
 *
 * These match the YAML frontmatter schema used by OpenCode agent files:
 * - title: Agent name (derived from filename if not in frontmatter)
 * - description: Short description
 * - model: OpenRouter model string (e.g. "openrouter/deepseek/deepseek-chat")
 * - mode: "primary" | "subagent" | "all"
 * - color: UI accent color class (e.g. "accent", "info")
 * - prompt: The full markdown body (system instructions)
 */

export interface ManagedAgent {
	/** Normalized filename without .md extension */
	filename: string
	/** Agent name (from frontmatter `name:` or title, falls back to filename) */
	name: string
	/** Short description from frontmatter */
	description: string
	/** Model string from frontmatter */
	model: string
	/** Agent mode: primary (lead), subagent, or all */
	mode: "primary" | "subagent" | "all"
	/** UI color class */
	color: string
	/** Full raw markdown content (frontmatter + body) */
	raw: string
	/** Body content only (the system prompt, without frontmatter) */
	prompt: string
	/** Origin of this agent definition */
	origin: "user" | "project" | "builtin"
	/** Team this agent belongs to (e.g. "engineering", "infrastructure") */
	team?: string
	/** Role within the team */
	teamRole?: "leader" | "member"
}

/** Input for creating or updating an agent file. */
export interface AgentInput {
	description: string
	model: string
	mode: "primary" | "subagent" | "all"
	color: string
	prompt: string
}

/** Build raw markdown from AgentInput fields. */
export function buildAgentRaw(input: AgentInput): string {
	const { description, model, mode, color, prompt } = input
	return [
		"---",
		`description: ${description}`,
		`model: ${model}`,
		`mode: ${mode}`,
		`color: ${color}`,
		"---",
		"",
		prompt,
	].join("\n")
}

/** Derive a filesystem-safe filename from an agent name. */
export function filenameFromAgentName(name: string): string {
	const result = name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
		.replace(/\.md$/i, "")
	return result || "untitled-agent"
}
