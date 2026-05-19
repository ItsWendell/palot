/**
 * Mem9Service — persistent memory and retrieval layer for Nexus Builder.
 *
 * Makes direct HTTP calls to the Mem9 REST API (v1alpha2).
 * No SDK dependency needed — the API surface is small.
 * Gracefully degrades when Mem9 is not configured.
 */

import fs from "node:fs/promises"
import path from "node:path"
import { createLogger } from "./logger"

const log = createLogger("mem9")

// ============================================================
// Types
// ============================================================

export interface Mem9Memory {
	id: string
	content: string
	source?: string | null
	tags?: string[] | null
	metadata?: Record<string, unknown> | null
	version?: number
	updated_by?: string | null
	created_at: string
	updated_at: string
	score?: number
	memory_type?: string
	state?: string
	agent_id?: string
	session_id?: string
	relative_age?: string
}

export interface Mem9SearchResult {
	memories: Mem9Memory[]
	total: number
	limit: number
	offset: number
}

export interface CreateMemoryInput {
	content: string
	source?: string
	tags?: string[]
	metadata?: Record<string, unknown>
}

export interface SearchInput {
	q?: string
	tags?: string
	source?: string
	limit?: number
	offset?: number
	memory_type?: string
}

export interface Mem9ServiceConfig {
	/** Mem9 API base URL (default: https://api.mem9.ai) */
	baseUrl: string
	/** Mem9 API key — required for cloud access */
	apiKey: string | null
	/** Agent identifier sent via X-Mnemo-Agent-Id */
	agentId: string
	/** Default request timeout in ms */
	defaultTimeoutMs: number
	/** Search request timeout in ms */
	searchTimeoutMs: number
}

const DEFAULT_CONFIG: Mem9ServiceConfig = {
	baseUrl: "https://api.mem9.ai",
	apiKey: null,
	agentId: "palot",
	defaultTimeoutMs: 8000,
	searchTimeoutMs: 15000,
}

// ============================================================
// Mem9Service
// ============================================================

export class Mem9Service {
	private config: Mem9ServiceConfig = DEFAULT_CONFIG
	private _initialized = false
	private _embeddingDone = false

	get initialized(): boolean {
		return this._initialized
	}

	get configured(): boolean {
		return this._initialized && this.config.apiKey !== null && this.config.apiKey.length > 0
	}

	/** Initialize with optional partial config. Returns true if ready. */
	init(partial?: Partial<Mem9ServiceConfig>): boolean {
		this.config = { ...DEFAULT_CONFIG, ...partial }
		this._initialized = true

		if (!this.config.apiKey) {
			log.info("Mem9 not configured — no API key. All operations will be no-ops.")
			return false
		}

		log.info("Mem9 initialized", {
			baseUrl: this.config.baseUrl,
			agentId: this.config.agentId,
		})
		return true
	}

	// ============================================================
	// Memory CRUD
	// ============================================================

	/** Store a memory. Returns null if Mem9 is not configured or on error. */
	async store(input: CreateMemoryInput): Promise<Mem9Memory | null> {
		if (!this.configured) return null
		try {
			return await this.request<Mem9Memory>("POST", "/memories", input)
		} catch (err) {
			log.error("Failed to store memory", err)
			return null
		}
	}

	/** Search memories. Returns empty results if Mem9 is not configured. */
	async search(input: SearchInput): Promise<Mem9SearchResult> {
		if (!this.configured) {
			return { memories: [], total: 0, limit: input.limit ?? 10, offset: input.offset ?? 0 }
		}
		try {
			const params = new URLSearchParams()
			if (input.q) params.set("q", input.q)
			if (input.tags) params.set("tags", input.tags)
			if (input.source) params.set("source", input.source)
			if (input.limit != null) params.set("limit", String(input.limit))
			if (input.offset != null) params.set("offset", String(input.offset))
			if (input.memory_type) params.set("memory_type", input.memory_type)

			const qs = params.toString()
			const raw = await this.request<{
				memories: Mem9Memory[]
				total: number
				limit: number
				offset: number
			}>("GET", `/memories${qs ? "?" + qs : ""}`, undefined, this.config.searchTimeoutMs)

			return {
				memories: raw.memories ?? [],
				total: raw.total,
				limit: raw.limit,
				offset: raw.offset,
			}
		} catch (err) {
			log.error("Failed to search memories", err)
			return { memories: [], total: 0, limit: input.limit ?? 10, offset: input.offset ?? 0 }
		}
	}

	/** Get a memory by ID. Returns null if not found or not configured. */
	async get(id: string): Promise<Mem9Memory | null> {
		if (!this.configured) return null
		try {
			return await this.request<Mem9Memory>("GET", `/memories/${encodeURIComponent(id)}`)
		} catch (err) {
			if (err instanceof Error && (err.message.includes("not found") || err.message.includes("404"))) {
				return null
			}
			log.error("Failed to get memory", err, { id })
			return null
		}
	}

	/** Delete a memory. Returns false if not configured. */
	async remove(id: string): Promise<boolean> {
		if (!this.configured) return false
		try {
			await this.request("DELETE", `/memories/${encodeURIComponent(id)}`)
			return true
		} catch (err) {
			if (err instanceof Error && (err.message.includes("not found") || err.message.includes("404"))) {
				return false
			}
			log.error("Failed to delete memory", err, { id })
			return false
		}
	}

	// ============================================================
	// Semantic Retrieval for Agent Spawn
	// ============================================================

	/**
	 * Recall relevant memories as formatted context for prompt injection.
	 * Returns a formatted markdown string or null if no relevant memories found.
	 */
	async recall(query: string, limit = 5): Promise<string | null> {
		if (!this.configured) return null
		try {
			const result = await this.search({ q: query, limit })
			if (!result.memories || result.memories.length === 0) return null

			const parts: string[] = ["## Relevant Memories", ""]
			for (const mem of result.memories) {
				const score = mem.score != null ? ` (score: ${mem.score.toFixed(2)})` : ""
				const source = mem.source ? ` — ${mem.source}` : ""
				parts.push(`### ${mem.id.slice(0, 8)}${score}${source}`)
				parts.push("")
				parts.push(mem.content)
				parts.push("")
			}
			return parts.join("\n")
		} catch (err) {
			log.error("Failed to recall memories", err)
			return null
		}
	}

	// ============================================================
	// File Embedding
	// ============================================================

	/**
	 * Embed all knowledge files (.agents/knowledge/*.md) into Mem9.
	 * Each file becomes a memory with tags derived from its path.
	 * Returns the number of files successfully embedded.
	 */
	async embedKnowledgeFiles(projectPath: string): Promise<number> {
		if (!this.configured) return 0
		const knowledgeDir = path.join(projectPath, ".agents", "knowledge")
		return this.embedDirectory(knowledgeDir, {
			sourcePrefix: ".agents/knowledge/",
			defaultTags: ["knowledge"],
		})
	}

	/**
	 * Embed all brain files (.palot/brain/*.md) into Mem9.
	 * Returns the number of files successfully embedded.
	 */
	async embedBrainFiles(projectPath: string): Promise<number> {
		if (!this.configured) return 0
		const brainDir = path.join(projectPath, ".palot", "brain")
		return this.embedDirectory(brainDir, {
			sourcePrefix: ".palot/brain/",
			defaultTags: ["brain"],
		})
	}

	/** Embed all knowledge + brain files for a project. Returns total count. */
	async embedAllProjectFiles(projectPath: string): Promise<number> {
		if (this._embeddingDone) return 0
		const knowledgeCount = await this.embedKnowledgeFiles(projectPath)
		const brainCount = await this.embedBrainFiles(projectPath)
		const total = knowledgeCount + brainCount
		this._embeddingDone = total > 0
		if (total > 0) {
			log.info(`Embedded ${total} project files into Mem9`, {
				knowledge: knowledgeCount,
				brain: brainCount,
			})
		}
		return total
	}

	/** Reset embedding flag (e.g., when project path changes). */
	resetEmbeddingFlag(): void {
		this._embeddingDone = false
	}

	// ============================================================
	// Private
	// ============================================================

	private memoryPath(subpath: string): string {
		return `/v1alpha2/mem9s${subpath}`
	}

	private async request<T>(
		method: string,
		path: string,
		body?: unknown,
		timeoutMs?: number,
	): Promise<T> {
		const url = this.config.baseUrl.replace(/\/+$/, "") + this.memoryPath(path)
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			"X-Mnemo-Agent-Id": this.config.agentId,
			"X-API-Key": this.config.apiKey!,
		}
		const resp = await fetch(url, {
			method,
			headers,
			body: body != null ? JSON.stringify(body) : undefined,
			signal: AbortSignal.timeout(timeoutMs ?? this.config.defaultTimeoutMs),
		})

		if (resp.status === 204) return undefined as T

		const text = await resp.text()
		const data = text ? (JSON.parse(text) as unknown) : undefined
		if (!resp.ok) {
			const message =
				data && typeof data === "object" && "error" in data
					? String((data as Record<string, unknown>).error)
					: `HTTP ${resp.status}`
			throw new Error(message)
		}
		return data as T
	}

	private async embedDirectory(
		dir: string,
		opts: { sourcePrefix: string; defaultTags: string[] },
	): Promise<number> {
		let files: string[]
		try {
			files = (await fs.readdir(dir))
				.filter((f) => f.endsWith(".md") && !f.includes("generate-"))
				.sort()
		} catch {
			return 0 // Directory doesn't exist
		}

		let count = 0
		for (const file of files) {
			try {
				const content = await fs.readFile(path.join(dir, file), "utf-8")
				const slug = file.replace(/\.md$/i, "")
				await this.request("POST", "/memories", {
					content,
					source: `${opts.sourcePrefix}${file}`,
					tags: [...opts.defaultTags, slug],
					metadata: { type: opts.defaultTags[0], file },
				} satisfies CreateMemoryInput)
				count++
			} catch (err) {
				log.warn(`Failed to embed ${file}`, err)
			}
		}
		return count
	}
}

/** Singleton instance shared across the main process. */
export const mem9Service = new Mem9Service()
