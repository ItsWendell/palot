import fs from "node:fs/promises"
import path from "node:path"
import type { ProjectBrainService } from "./project-brain-service"

// ============================================================
// Types
// ============================================================

export interface SemanticIndexEntry {
	filePath: string
	/** Normalized term frequency vector: term → tf value */
	tf: Record<string, number>
	/** Raw token count for BM25-style length normalization */
	tokenCount: number
}

export interface SemanticIndex {
	version: 1
	builtAt: string
	projectRoot: string
	/** Inverse document frequency for each term across the corpus */
	idf: Record<string, number>
	/** Average document length (in tokens) */
	avgDl: number
	entries: SemanticIndexEntry[]
}

export interface SemanticSearchResult {
	filePath: string
	score: number
	/** Top matching terms from the query */
	matchedTerms: string[]
}

// ============================================================
// Constants
// ============================================================

const INDEX_SLUG = "semantic-index"

const IGNORED_DIRS = new Set([
	"node_modules",
	".git",
	"dist",
	"build",
	".next",
	".palot",
	"coverage",
	"out",
])

const SOURCE_EXTS = new Set([
	".ts",
	".tsx",
	".js",
	".jsx",
	".mts",
	".cts",
	".md",
	".json",
])

// ============================================================
// Tokenizer — code-aware
// ============================================================

/**
 * Tokenizes source code for TF-IDF indexing.
 *
 * Splits on:
 * - camelCase boundaries (e.g. "fetchUserData" → ["fetch", "user", "data"])
 * - snake_case / kebab-case separators
 * - Path separators and common punctuation
 * - Whitespace
 *
 * Filters out tokens shorter than 2 characters and common stop words.
 */
export function tokenize(text: string): string[] {
	// Split camelCase: insert space before uppercase letters
	const expanded = text.replace(/([a-z])([A-Z])/g, "$1 $2")

	// Split on non-alphanumeric characters
	const raw = expanded.toLowerCase().split(/[^a-z0-9]+/)

	return raw.filter((t) => t.length >= 2 && !STOP_WORDS.has(t))
}

const STOP_WORDS = new Set([
	"the",
	"is",
	"at",
	"of",
	"on",
	"in",
	"to",
	"and",
	"or",
	"an",
	"it",
	"if",
	"as",
	"be",
	"by",
	"do",
	"no",
	"so",
	"up",
	"for",
	"but",
	"not",
	"you",
	"all",
	"can",
	"her",
	"was",
	"one",
	"our",
	"out",
	"are",
	"has",
	"his",
	"how",
	"its",
	"may",
	"new",
	"now",
	"old",
	"see",
	"way",
	"who",
	"did",
	"get",
	"got",
	"let",
	"say",
	"she",
	"too",
	"use",
	"from",
	"have",
	"this",
	"that",
	"with",
	"will",
	"each",
	"make",
	"like",
	"then",
	"them",
	"than",
	"been",
	"call",
	"come",
	"could",
	"more",
	"some",
	"what",
	"when",
	"which",
	"would",
	"about",
	"these",
	"other",
	"into",
	"just",
	"also",
	"only",
	"very",
	"true",
	"false",
	"null",
	"undefined",
	"return",
	"const",
	"import",
	"export",
	"function",
	"class",
	"interface",
	"type",
	"void",
	"string",
	"number",
	"boolean",
	"async",
	"await",
	"else",
	"case",
	"break",
	"default",
	"switch",
	"throw",
	"catch",
	"finally",
	"try",
	"while",
	"continue",
])

// ============================================================
// TF-IDF math
// ============================================================

function computeTf(tokens: string[]): Record<string, number> {
	const freq: Record<string, number> = {}
	for (const t of tokens) {
		freq[t] = (freq[t] ?? 0) + 1
	}
	// Normalize by max frequency to prevent long-document bias
	const maxFreq = Math.max(...Object.values(freq), 1)
	const tf: Record<string, number> = {}
	for (const [term, count] of Object.entries(freq)) {
		tf[term] = 0.5 + 0.5 * (count / maxFreq)
	}
	return tf
}

function computeIdf(
	docs: Record<string, number>[],
	totalDocs: number,
): Record<string, number> {
	const docFreq: Record<string, number> = {}
	for (const tf of docs) {
		for (const term of Object.keys(tf)) {
			docFreq[term] = (docFreq[term] ?? 0) + 1
		}
	}
	const idf: Record<string, number> = {}
	for (const [term, df] of Object.entries(docFreq)) {
		// Smooth IDF to avoid division by zero
		idf[term] = Math.log((totalDocs + 1) / (df + 1)) + 1
	}
	return idf
}

function cosineSimilarity(
	queryTfIdf: Record<string, number>,
	docTfIdf: Record<string, number>,
): number {
	let dot = 0
	let normQ = 0
	let normD = 0

	for (const [term, qVal] of Object.entries(queryTfIdf)) {
		normQ += qVal * qVal
		const dVal = docTfIdf[term]
		if (dVal !== undefined) {
			dot += qVal * dVal
		}
	}

	for (const dVal of Object.values(docTfIdf)) {
		normD += dVal * dVal
	}

	const denom = Math.sqrt(normQ) * Math.sqrt(normD)
	return denom === 0 ? 0 : dot / denom
}

// ============================================================
// File walker
// ============================================================

async function walkDir(
	dir: string,
	collected: string[] = [],
): Promise<string[]> {
	let entries: { name: string; isDirectory(): boolean; isFile(): boolean }[]
	try {
		entries = await fs.readdir(dir, { withFileTypes: true })
	} catch {
		return collected
	}
	for (const entry of entries) {
		if (IGNORED_DIRS.has(entry.name)) continue
		const full = path.join(dir, entry.name)
		if (entry.isDirectory()) {
			await walkDir(full, collected)
		} else if (
			entry.isFile() &&
			SOURCE_EXTS.has(path.extname(entry.name))
		) {
			collected.push(full)
		}
	}
	return collected
}

// ============================================================
// Service
// ============================================================

export class SemanticIndexService {
	constructor(private readonly brain: ProjectBrainService) {}

	async build(projectRoot: string): Promise<SemanticIndex> {
		const files = await walkDir(projectRoot)
		const allTfs: Record<string, number>[] = []
		const entries: SemanticIndexEntry[] = []
		let totalTokens = 0

		for (const filePath of files) {
			try {
				const content = await fs.readFile(filePath, "utf-8")
				// Include file path tokens for path-based matching
				const pathTokens = tokenize(
					path.relative(projectRoot, filePath),
				)
				const contentTokens = tokenize(content)
				const tokens = [...pathTokens, ...contentTokens]

				const tf = computeTf(tokens)
				allTfs.push(tf)
				totalTokens += tokens.length

				entries.push({
					filePath: path.relative(projectRoot, filePath),
					tf,
					tokenCount: tokens.length,
				})
			} catch {
				// Skip unreadable files
			}
		}

		const idf = computeIdf(allTfs, entries.length)
		const avgDl =
			entries.length > 0 ? totalTokens / entries.length : 0

		const index: SemanticIndex = {
			version: 1,
			builtAt: new Date().toISOString(),
			projectRoot,
			idf,
			avgDl,
			entries,
		}

		await this.brain.writeFile(INDEX_SLUG, JSON.stringify(index))
		return index
	}

	async load(): Promise<SemanticIndex | null> {
		const raw = await this.brain.readFile(INDEX_SLUG)
		if (!raw) return null
		try {
			return JSON.parse(raw) as SemanticIndex
		} catch {
			return null
		}
	}

	async search(
		query: string,
		limit = 10,
	): Promise<SemanticSearchResult[]> {
		const index = await this.load()
		if (!index) return []

		const queryTokens = tokenize(query)
		if (queryTokens.length === 0) return []

		// Build query TF-IDF vector
		const queryTf = computeTf(queryTokens)
		const queryTfIdf: Record<string, number> = {}
		for (const [term, tf] of Object.entries(queryTf)) {
			const idfVal = index.idf[term]
			if (idfVal !== undefined) {
				queryTfIdf[term] = tf * idfVal
			}
		}

		if (Object.keys(queryTfIdf).length === 0) return []

		const results: SemanticSearchResult[] = []

		for (const entry of index.entries) {
			// Build document TF-IDF vector (only for query terms to save memory)
			const docTfIdf: Record<string, number> = {}
			for (const term of Object.keys(queryTfIdf)) {
				const tfVal = entry.tf[term]
				if (tfVal !== undefined) {
					docTfIdf[term] = tfVal * (index.idf[term] ?? 0)
				}
			}

			const score = cosineSimilarity(queryTfIdf, docTfIdf)
			if (score <= 0) continue

			const matchedTerms = Object.keys(docTfIdf)
				.filter((t) => (docTfIdf[t] ?? 0) > 0)
				.slice(0, 5)

			results.push({
				filePath: entry.filePath,
				score,
				matchedTerms,
			})
		}

		return results.sort((a, b) => b.score - a.score).slice(0, limit)
	}
}
