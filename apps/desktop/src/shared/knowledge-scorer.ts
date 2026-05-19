/**
 * Knowledge Relevance Scorer — scores knowledge sources against an agent's
 * profile for relevance filtering and ranking.
 *
 * Scoring signals (cumulative):
 *   +3  Agent name matches a name in the `agents:` frontmatter field
 *   +2  Agent team matches a name in the `agents:` field
 *   +2  Agent team appears in the `tags:` field
 *   +1  Per tag that overlaps with agent description words (max +3)
 *   +1  All source tags match (bonus)
 *   +1  Agent name appears in knowledge title/description
 *   +1  Per tag that overlaps with custom instruction (max +2)
 *
 * A score ≥ 1 means "relevant enough to show". Sources with score ≥ 3 are
 * considered highly relevant (auto-selected by default in the UI).
 */

import type { KnowledgeSource } from "./knowledge"

// ============================================================
// Types
// ============================================================

export interface ScoredKnowledgeSource {
	source: KnowledgeSource
	score: number
	/** Human-readable reasons for this score (for tooltip/display) */
	matchReasons: string[]
}

export interface KnowledgeScorerInput {
	/** The agent's normalized name */
	agentName: string
	/** Agent description from frontmatter */
	agentDescription: string
	/** Team slug (e.g. "engineering", "infrastructure") */
	agentTeam?: string
	/** Agent mode */
	agentMode?: string
	/** Optional custom instruction the user entered */
	customInstruction?: string
}

// ============================================================
// Helpers
// ============================================================

function splitAndClean(value: string): string[] {
	return value
		.split(",")
		.map((s) => s.trim().toLowerCase())
		.filter(Boolean)
}

function tokenize(text: string): Set<string> {
	return new Set(
		text
			.toLowerCase()
			.replace(/[^a-z0-9\s-]/g, "")
			.split(/\s+/)
			.filter((w) => w.length >= 3 && !STOP_WORDS.has(w)),
	)
}

// Common English stop words — short and/or very frequent words unlikely to
// carry meaningful signal for relevance matching.
const STOP_WORDS = new Set([
	"the", "and", "for", "are", "but", "not", "you", "all", "can", "any",
	"has", "had", "was", "its", "let", "use", "get", "set", "how", "why",
	"too", "may", "via", "new", "old", "big", "top", "low", "end", "put",
	"run", "own", "our", "out", "off", "per", "pre", "pro",
])

// ============================================================
// Scoring
// ============================================================

/**
 * Score a single knowledge source against an agent's profile.
 * Returns the score and human-readable match reasons.
 */
export function scoreKnowledgeSource(
	source: KnowledgeSource,
	input: KnowledgeScorerInput,
): { score: number; reasons: string[] } {
	const reasons: string[] = []
	let score = 0

	const agentSlug = input.agentName.toLowerCase()
	const agentTags = tokenize(input.agentDescription)
	const agentTeamSlug = input.agentTeam?.toLowerCase()

	// --- Signal 1: Agent name match in `agents` field (exact or team) ---
	const agentEntries = splitAndClean(source.agents)

	// Exact agent name match
	if (agentEntries.some((entry) => entry === agentSlug)) {
		score += 3
		reasons.push("agent name matches `agents` field")
	}

	// Team name match in `agents` field
	if (
		agentTeamSlug &&
		agentEntries.some((entry) => entry === agentTeamSlug)
	) {
		score += 2
		reasons.push("agent team matches `agents` field")
	}

	// --- Signal 2: Agent team in tags ---
	if (agentTeamSlug) {
		const tagEntries = splitAndClean(source.tags)
		if (tagEntries.includes(agentTeamSlug)) {
			score += 2
			reasons.push("agent team found in tags")
		}
	}

	// --- Signal 3: Tag overlap with agent description ---
	const sourceTags = splitAndClean(source.tags)
	let tagMatches = 0
	for (const tag of sourceTags) {
		if (agentTags.has(tag)) {
			tagMatches++
		}
	}
	if (tagMatches > 0) {
		const points = Math.min(tagMatches, 3)
		score += points
		reasons.push(`${points} tag(s) match agent description`)
	}

	// Bonus: all source tags match
	if (sourceTags.length > 0 && tagMatches >= sourceTags.length) {
		score += 1
		reasons.push("all source tags match")
	}

	// --- Signal 4: Agent name in knowledge title or description ---
	const titleDesc = `${source.title} ${source.description}`.toLowerCase()
	if (titleDesc.includes(agentSlug)) {
		score += 1
		reasons.push("agent name in knowledge title/description")
	}

	// --- Signal 5: Custom instruction overlap with tags ---
	if (input.customInstruction) {
		const instructionTokens = tokenize(input.customInstruction)
		let ciTagMatches = 0
		for (const tag of sourceTags) {
			if (instructionTokens.has(tag)) {
				ciTagMatches++
			}
		}
		if (ciTagMatches > 0) {
			const points = Math.min(ciTagMatches, 2)
			score += points
			reasons.push(`${points} tag(s) match custom instruction`)
		}
	}

	return { score, reasons }
}

/**
 * Score all knowledge sources against an agent profile, returning them sorted
 * by relevance (highest score first).
 *
 * @param sources  All available knowledge sources
 * @param input    Agent profile for scoring
 * @param minScore Minimum score to include (default: 1 — anything with at least
 *                 one signal). Pass 0 to return everything.
 * @returns Scored sources sorted descending by score
 */
export function scoreKnowledgeSources(
	sources: KnowledgeSource[],
	input: KnowledgeScorerInput,
	minScore = 1,
): ScoredKnowledgeSource[] {
	const scored = sources.map((source) => {
		const { score, reasons } = scoreKnowledgeSource(source, input)
		return { source, score, matchReasons: reasons }
	})

	return scored
		.filter((s) => s.score >= minScore)
		.sort((a, b) => b.score - a.score)
}

/**
 * Returns sources with score ≥ 3 — these are considered "highly relevant" and
 * will be pre-selected in the spawn dialog.
 */
export function getHighlyRelevantSources(
	sources: KnowledgeSource[],
	input: KnowledgeScorerInput,
): string[] {
	return scoreKnowledgeSources(sources, input, 3).map((s) => s.source.filename)
}
