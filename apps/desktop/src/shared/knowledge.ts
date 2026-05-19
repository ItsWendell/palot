/**
 * Knowledge source definitions for Palot agent system.
 *
 * Knowledge sources are markdown documents stored in `.agents/knowledge/`
 * that provide agents with domain-specific reference material at spawn time.
 *
 * Each knowledge file has YAML frontmatter describing the topic, source URL,
 * and relevant tags. The body is the reference content itself.
 */

export interface KnowledgeSource {
	/** Normalized filename without .md extension */
	filename: string
	/** Human-readable title (from frontmatter `title:`) */
	title: string
	/** Short description of what this knowledge covers */
	description: string
	/** Source URL or package name (e.g. "npm:obsidian", "github:obsidianmd/obsidian-api") */
	source: string
	/** Comma-separated topic tags for filtering */
	tags: string
	/** Target agent types this knowledge is relevant to (empty = all) */
	agents: string
	/** The full raw markdown (frontmatter + body) */
	raw: string
	/** The body content only (without frontmatter) */
	prompt: string
	/** ISO date the knowledge was last fetched/generated */
	updated: string
}

/** Input for generating a new knowledge source from a package. */
export interface KnowledgeGenerationInput {
	/** npm package name */
	packageName: string
	/** Optional custom title (defaults to package name) */
	title?: string
	/** Optional custom description */
	description?: string
	/** Tags for filtering */
	tags?: string
	/** Target agents */
	agents?: string
}

/**
 * Build the raw markdown content for a knowledge source file.
 */
export function buildKnowledgeRaw(source: Omit<KnowledgeSource, "filename" | "raw">): string {
	const { title, description, source: src, tags, agents, prompt, updated } = source
	return [
		"---",
		`title: ${title}`,
		`description: ${description}`,
		`source: ${src}`,
		`tags: ${tags}`,
		`agents: ${agents}`,
		`updated: ${updated}`,
		"---",
		"",
		prompt,
	].join("\n")
}

/**
 * Derive a filesystem-safe filename from a knowledge title.
 */
export function knowledgeFilename(title: string): string {
	const result = title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
	return result || "untitled-knowledge"
}
