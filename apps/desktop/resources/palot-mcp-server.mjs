#!/usr/bin/env node

/**
 * Palot Brain MCP Server — stdio transport, standalone Node.js ESM script.
 *
 * Exposes palot's shared brain (markdown files) and mem9 (semantic memory)
 * as MCP tools so all OpenCode agents can read/write shared context.
 *
 * This script is auto-registered in the global OpenCode config (~/.config/opencode/opencode.json)
 * by the Palot desktop app at startup. No manual config needed.
 *
 * Config (env vars):
 *   PALOT_BRAIN_DIR    — path to brain directory (default: .palot/brain relative to cwd)
 *   PALOT_MEM9_API_KEY — Mem9 API key (optional, tools degrade gracefully)
 *   PALOT_MEM9_BASE_URL — Mem9 base URL (default: https://api.mem9.ai)
 *   PALOT_MEM9_AGENT_ID — Mem9 agent ID (default: palot)
 */

// ---------------------------------------------------------------------------
// Config — resolved from env vars with sensible defaults
// ---------------------------------------------------------------------------

const BRAIN_DIR = resolve(process.env.PALOT_BRAIN_DIR ?? ".palot/brain")
const MEM9_API_KEY = process.env.PALOT_MEM9_API_KEY ?? null
const MEM9_BASE_URL = process.env.PALOT_MEM9_BASE_URL ?? "https://api.mem9.ai"
const MEM9_AGENT_ID = process.env.PALOT_MEM9_AGENT_ID ?? "palot"

import { createInterface } from "node:readline"
import fs from "node:fs/promises"
import path from "node:path"

// ---------------------------------------------------------------------------
// Path helpers (avoid the full path.resolve on every call)
// ---------------------------------------------------------------------------

function resolve(p) {
	return path.resolve(p)
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const TOOLS = [
	{
		name: "brain_list",
		description:
			"List all shared brain memory files (slugs). Call this first to discover what shared knowledge exists before reading.",
		inputSchema: { type: "object", properties: {}, required: [] },
	},
	{
		name: "brain_read",
		description:
			"Read a shared brain memory file by slug. Use for tasks, decisions, run-history, issues, or any cross-agent knowledge.",
		inputSchema: {
			type: "object",
			properties: {
				slug: {
					type: "string",
					description: "File slug without .md extension (e.g. 'tasks', 'decisions')",
				},
			},
			required: ["slug"],
		},
	},
	{
		name: "brain_write",
		description:
			"Write or update a shared brain memory file. Use to record task state, decisions, findings — anything other agents should know.",
		inputSchema: {
			type: "object",
			properties: {
				slug: {
					type: "string",
					description: "File slug without .md (e.g. 'tasks', 'run-history')",
				},
				content: { type: "string", description: "Full markdown content to write" },
			},
			required: ["slug", "content"],
		},
	},
	{
		name: "brain_append",
		description:
			"Append content to a shared brain memory file without overwriting existing content. Prefer this for run-history, handoffs, findings, and multi-agent notes.",
		inputSchema: {
			type: "object",
			properties: {
				slug: {
					type: "string",
					description: "File slug without .md (e.g. 'run-history', 'decisions')",
				},
				content: { type: "string", description: "Markdown content to append" },
			},
			required: ["slug", "content"],
		},
	},
	{
		name: "brain_record_event",
		description:
			"Append a timestamped event section to a shared brain file. Use for durable run history, decisions, blockers, and handoff events.",
		inputSchema: {
			type: "object",
			properties: {
				slug: {
					type: "string",
					description: "File slug without .md (e.g. 'run-history', 'decisions')",
				},
				title: { type: "string", description: "Short event title" },
				body: { type: "string", description: "Markdown event body" },
			},
			required: ["slug", "title", "body"],
		},
	},
	{
		name: "brain_search",
		description:
			"Keyword search across all shared brain files. Returns matching slugs with excerpts.",
		inputSchema: {
			type: "object",
			properties: {
				keyword: { type: "string", description: "Search term" },
			},
			required: ["keyword"],
		},
	},
	{
		name: "mem9_store",
		description:
			"Store a persistent semantic memory in mem9. Use for important decisions, learned patterns, or facts that should survive across sessions.",
		inputSchema: {
			type: "object",
			properties: {
				content: { type: "string", description: "Memory content to store" },
				tags: {
					type: "array",
					items: { type: "string" },
					description: "Optional classification tags",
				},
				source: { type: "string", description: "Source agent or context identifier" },
			},
			required: ["content"],
		},
	},
	{
		name: "mem9_recall",
		description:
			"Semantically recall the most relevant memories from mem9 for a query. Use at session start to recover prior context.",
		inputSchema: {
			type: "object",
			properties: {
				query: { type: "string", description: "What to recall (natural language)" },
				limit: { type: "number", description: "Max memories to return (default 5)" },
			},
			required: ["query"],
		},
	},
]

// ---------------------------------------------------------------------------
// Brain operations (local markdown files)
// ---------------------------------------------------------------------------

async function brainList() {
	await fs.mkdir(BRAIN_DIR, { recursive: true })
	const files = await fs.readdir(BRAIN_DIR)
	return files
		.filter((f) => f.endsWith(".md"))
		.map((f) => f.replace(/\.md$/, ""))
		.sort()
}

function safeBrainPath(slug) {
	const normalized = String(slug).trim().replace(/\.md$/i, "")
	if (!/^[A-Za-z0-9_-]+$/.test(normalized)) throw new Error(`Invalid slug: ${slug}`)
	const brainRoot = resolve(BRAIN_DIR)
	const resolved = resolve(path.join(brainRoot, `${normalized}.md`))
	if (resolved !== brainRoot && !resolved.startsWith(`${brainRoot}${path.sep}`)) {
		throw new Error(`Invalid slug: path escapes brain directory`)
	}
	return resolved
}

async function brainRead(slug) {
	try {
		return await fs.readFile(safeBrainPath(slug), "utf-8")
	} catch {
		return null
	}
}

async function brainWrite(slug, content) {
	await fs.mkdir(BRAIN_DIR, { recursive: true })
	await fs.writeFile(safeBrainPath(slug), content, "utf-8")
}

async function brainAppend(slug, content) {
	await fs.mkdir(BRAIN_DIR, { recursive: true })
	let existing = ""
	try {
		existing = await fs.readFile(safeBrainPath(slug), "utf-8")
	} catch (err) {
		if (err.code !== "ENOENT") throw err
	}
	const separator = existing && !existing.endsWith("\n") ? "\n" : ""
	await fs.writeFile(safeBrainPath(slug), `${existing}${separator}${content}`, "utf-8")
}

async function brainRecordEvent(slug, title, body) {
	const timestamp = new Date().toISOString()
	await brainAppend(slug, `\n## ${timestamp} — ${title}\n\n${body.trim()}\n`)
}

async function brainSearch(keyword) {
	const slugs = await brainList()
	const needle = String(keyword).toLowerCase()
	const results = []

	for (const slug of slugs) {
		const content = await brainRead(slug)
		if (!content) continue
		const lower = content.toLowerCase()
		if (!lower.includes(needle)) continue
		const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
		const count = (lower.match(new RegExp(escaped, "g")) ?? []).length
		const idx = lower.indexOf(needle)
		const start = Math.max(0, idx - 60)
		const end = Math.min(content.length, idx + keyword.length + 60)
		const excerpt =
			(start > 0 ? "…" : "") + content.slice(start, end).trim() + (end < content.length ? "…" : "")
		results.push({ slug, excerpt, count })
	}

	return results.sort((a, b) => b.count - a.count).map(({ slug, excerpt }) => ({ slug, excerpt }))
}

// ---------------------------------------------------------------------------
// Mem9 operations (REST API, optional)
// ---------------------------------------------------------------------------

async function mem9Fetch(endpoint, init = {}) {
	if (!MEM9_API_KEY) throw new Error("mem9 not configured — set PALOT_MEM9_API_KEY env var")
	const headers = {
		"Content-Type": "application/json",
		"X-API-Key": MEM9_API_KEY,
		"X-Mnemo-Agent-Id": MEM9_AGENT_ID,
		...((init.headers) ?? {}),
	}
	const res = await fetch(`${MEM9_BASE_URL}${endpoint}`, {
		...init,
		headers,
	})
	if (!res.ok) throw new Error(`mem9 ${res.status}: ${await res.text()}`)
	return res.json()
}

async function mem9Store(content, tags, source) {
	return mem9Fetch("/v1alpha2/mem9s/memories", {
		method: "POST",
		body: JSON.stringify({ content, tags, source }),
	})
}

async function mem9Recall(query, limit = 5) {
	const params = new URLSearchParams({ q: query, limit: String(limit) })
	return mem9Fetch(`/v1alpha2/mem9s/memories/search?${params}`)
}

// ---------------------------------------------------------------------------
// Tool dispatch
// ---------------------------------------------------------------------------

async function callTool(name, args) {
	switch (name) {
		case "brain_list": {
			const slugs = await brainList()
			return [{ type: "text", text: slugs.length ? slugs.join("\n") : "(no brain files yet)" }]
		}
		case "brain_read": {
			const content = await brainRead(args.slug)
			return [{ type: "text", text: content ?? `No brain file found: "${args.slug}"` }]
		}
		case "brain_write": {
			await brainWrite(args.slug, args.content)
			return [{ type: "text", text: `Written: ${args.slug}.md` }]
		}
		case "brain_append": {
			await brainAppend(args.slug, args.content)
			return [{ type: "text", text: `Appended: ${args.slug}.md` }]
		}
		case "brain_record_event": {
			await brainRecordEvent(args.slug, args.title, args.body)
			return [{ type: "text", text: `Recorded event in: ${args.slug}.md` }]
		}
		case "brain_search": {
			const results = await brainSearch(args.keyword)
			if (!results.length) return [{ type: "text", text: "No matches found." }]
			return [{
				type: "text",
				text: results.map((r) => `## ${r.slug}\n${r.excerpt}`).join("\n\n"),
			}]
		}
		case "mem9_store": {
			const result = await mem9Store(args.content, args.tags, args.source)
			return [{ type: "text", text: `Memory stored: ${JSON.stringify(result)}` }]
		}
		case "mem9_recall": {
			const result = await mem9Recall(args.query, args.limit ?? 5)
			return [{ type: "text", text: JSON.stringify(result, null, 2) }]
		}
		default:
			throw new Error(`Unknown tool: ${name}`)
	}
}

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 stdio loop
// ---------------------------------------------------------------------------

function send(id, result) {
	process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`)
}

function sendError(id, code, message) {
	process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`)
}

let pending = 0
let inputClosed = false

function checkExit() {
	if (inputClosed && pending === 0) process.exit(0)
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })

rl.on("line", async (line) => {
	if (!line.trim()) return

	let msg
	try {
		msg = JSON.parse(line)
	} catch {
		sendError(null, -32700, "Parse error")
		return
	}

	const { id, method, params } = msg
	const isNotification = id === undefined || id === null
	if (!isNotification) pending++

	try {
		switch (method) {
			case "initialize":
				send(id, {
					protocolVersion: "2024-11-05",
					capabilities: { tools: {} },
					serverInfo: { name: "palot-brain", version: "1.0.0" },
				})
				break

			case "notifications/initialized":
				break

			case "tools/list":
				send(id, { tools: TOOLS })
				break

			case "tools/call": {
				const { name, arguments: args = {} } = params
				const content = await callTool(name, args)
				send(id, { content })
				break
			}

			case "ping":
				send(id, {})
				break

			default:
				sendError(id, -32601, `Method not found: ${method}`)
		}
	} catch (e) {
		sendError(id, -32603, e instanceof Error ? e.message : String(e))
	} finally {
		if (!isNotification) {
			pending--
			checkExit()
		}
	}
})

rl.on("close", () => {
	inputClosed = true
	checkExit()
})
