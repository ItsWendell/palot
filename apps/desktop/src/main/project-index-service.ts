import fs from "node:fs/promises"
import path from "node:path"
import type { ProjectBrainService } from "./project-brain-service"

export interface IndexEntry {
	filePath: string
	symbols: string[]
	exports: string[]
	size: number
	updatedAt: string
}

export interface ProjectIndex {
	version: 1
	builtAt: string
	projectRoot: string
	entries: IndexEntry[]
}

export interface IndexSearchResult {
	filePath: string
	score: number
	matchedSymbols: string[]
	excerpt: string
}

const INDEX_SLUG = "project-index"
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
const SOURCE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"])

// Regex-based symbol extraction (no AST — fast and dependency-free)
function extractSymbols(content: string): { symbols: string[]; exports: string[] } {
	const symbols: string[] = []
	const exports: string[] = []

	// Named exports: export function/class/const/type/interface Foo
	for (const m of content.matchAll(
		/export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var|type|interface|enum)\s+(\w+)/g,
	)) {
		exports.push(m[1])
		symbols.push(m[1])
	}

	// Re-exports: export { Foo, Bar }
	for (const m of content.matchAll(/export\s*\{([^}]+)\}/g)) {
		for (const name of m[1].split(",")) {
			const trimmed = name.replace(/\s+as\s+\w+/, "").trim()
			if (trimmed && /^\w+$/.test(trimmed)) {
				exports.push(trimmed)
				symbols.push(trimmed)
			}
		}
	}

	// Top-level function/class declarations (non-exported)
	for (const m of content.matchAll(/^(?:async\s+)?function\s+(\w+)/gm)) {
		if (!symbols.includes(m[1])) symbols.push(m[1])
	}
	for (const m of content.matchAll(/^class\s+(\w+)/gm)) {
		if (!symbols.includes(m[1])) symbols.push(m[1])
	}

	// Type / interface definitions
	for (const m of content.matchAll(/^(?:type|interface)\s+(\w+)/gm)) {
		if (!symbols.includes(m[1])) symbols.push(m[1])
	}

	return { symbols: [...new Set(symbols)], exports: [...new Set(exports)] }
}

async function walkDir(dir: string, collected: string[] = []): Promise<string[]> {
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
		} else if (entry.isFile() && SOURCE_EXTS.has(path.extname(entry.name))) {
			collected.push(full)
		}
	}
	return collected
}

export class ProjectIndexService {
	constructor(private readonly brain: ProjectBrainService) {}

	async build(projectRoot: string): Promise<ProjectIndex> {
		const files = await walkDir(projectRoot)
		const entries: IndexEntry[] = []

		for (const filePath of files) {
			try {
				const stat = await fs.stat(filePath)
				const content = await fs.readFile(filePath, "utf-8")
				const { symbols, exports } = extractSymbols(content)
				entries.push({
					filePath: path.relative(projectRoot, filePath),
					symbols,
					exports,
					size: stat.size,
					updatedAt: stat.mtime.toISOString(),
				})
			} catch {
				// Skip unreadable files
			}
		}

		const index: ProjectIndex = {
			version: 1,
			builtAt: new Date().toISOString(),
			projectRoot,
			entries,
		}

		await this.brain.writeFile(INDEX_SLUG, JSON.stringify(index, null, 2))
		return index
	}

	async load(): Promise<ProjectIndex | null> {
		const raw = await this.brain.readFile(INDEX_SLUG)
		if (!raw) return null
		try {
			return JSON.parse(raw) as ProjectIndex
		} catch {
			return null
		}
	}

	async search(query: string, limit = 10): Promise<IndexSearchResult[]> {
		const index = await this.load()
		if (!index) return []

		const words = query
			.toLowerCase()
			.split(/[\s/._-]+/)
			.filter((w) => w.length > 2)

		if (words.length === 0) return []

		const results: IndexSearchResult[] = []

		for (const entry of index.entries) {
			const pathLower = entry.filePath.toLowerCase()
			const allSymbols = [...entry.symbols, ...entry.exports].map((s) => s.toLowerCase())
			const matchedSymbols: string[] = []
			let score = 0

			for (const word of words) {
				// Path match (high signal)
				if (pathLower.includes(word)) score += 3

				// Symbol exact match
				for (const sym of allSymbols) {
					if (sym === word) {
						score += 5
						matchedSymbols.push(sym)
					} else if (sym.includes(word)) {
						score += 2
						matchedSymbols.push(sym)
					}
				}
			}

			if (score === 0) continue

			// Camel-case component matching: "userProfile" → ["user", "profile"]
			for (const sym of allSymbols) {
				const parts = sym.replace(/([A-Z])/g, " $1").toLowerCase().split(/\s+/)
				const overlap = words.filter((w) => parts.includes(w))
				if (overlap.length >= 2) {
					score += overlap.length * 3
					matchedSymbols.push(sym)
				}
			}

			const uniqueMatched = [...new Set(matchedSymbols)]
			results.push({
				filePath: entry.filePath,
				score,
				matchedSymbols: uniqueMatched.slice(0, 5),
				excerpt: uniqueMatched.slice(0, 3).join(", ") || entry.filePath,
			})
		}

		return results.sort((a, b) => b.score - a.score).slice(0, limit)
	}
}
