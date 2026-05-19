/**
 * Utilities for spawning and coordinating parallel read-only research agents.
 *
 * Research agents use the "read-only" permission preset so they cannot modify
 * files. Multiple research agents can safely run concurrently since they only
 * read the codebase.
 */

export const RESEARCH_AGENT_NAME = "research"
export const RESEARCH_PERMISSION_PRESET = "read-only" as const

export interface ResearchTask {
	question: string
	context?: string
	files?: string[]
}

export interface ResearchResult {
	sessionId: string
	question: string
	answer: string
	completedAt: string
}

/**
 * Formats a research task into a focused agent prompt.
 * The prompt instructs the agent to only read, not modify, the codebase.
 */
export function makeResearchPrompt(task: ResearchTask): string {
	const lines = [
		"You are a read-only research agent. Your task is to investigate the codebase and answer the question below.",
		"Do NOT modify any files. Only read, search, and analyze.",
		"",
		`## Question\n${task.question}`,
	]

	if (task.context) {
		lines.push(`\n## Context\n${task.context}`)
	}

	if (task.files && task.files.length > 0) {
		lines.push(`\n## Focus Files\n${task.files.map((f) => `- ${f}`).join("\n")}`)
	}

	lines.push(
		"\n## Output Format",
		"Provide a concise answer (2-5 sentences or a short bullet list). End with:",
		"`RESEARCH_COMPLETE: <one-line summary>`",
	)

	return lines.join("\n")
}

/**
 * Merges outputs from multiple parallel research agents into a single summary
 * suitable for the lead agent to consume.
 */
export function mergeResearchOutputs(results: ResearchResult[]): string {
	if (results.length === 0) return ""
	if (results.length === 1) return results[0].answer

	const sections = results.map((r, i) => {
		const shortAnswer = extractResearchSummary(r.answer) ?? r.answer.slice(0, 300)
		return `### Finding ${i + 1}: ${r.question}\n${shortAnswer}`
	})

	return `## Research Summary (${results.length} agents)\n\n${sections.join("\n\n")}`
}

/**
 * Extracts the `RESEARCH_COMPLETE: ...` summary line if the agent produced one.
 */
export function extractResearchSummary(output: string): string | null {
	const match = output.match(/RESEARCH_COMPLETE:\s*(.+)$/m)
	return match ? match[1].trim() : null
}
