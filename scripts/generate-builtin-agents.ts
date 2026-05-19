/**
 * Fetches all agents from VoltAgent/awesome-claude-code-subagents and converts
 * them to palot's agent format, writing them to src/main/builtin-agents/.
 *
 * Run with: bun scripts/generate-builtin-agents.ts
 */

import { execSync } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUTPUT_DIR = path.join(__dirname, "../apps/desktop/src/main/builtin-agents")

const CATEGORY_COLORS: Record<string, string> = {
	"01-core-development": "accent",
	"02-language-specialists": "info",
	"03-infrastructure": "danger",
	"04-quality-security": "warning",
	"05-data-ai": "info",
	"06-developer-experience": "accent",
	"07-specialized-domains": "success",
	"08-business-product": "success",
	"09-meta-orchestration": "accent",
	"10-research-analysis": "info",
}

function mapModel(voltModel: string): string {
	if (voltModel === "opus") return "openrouter/deepseek/deepseek-r1"
	return "openrouter/deepseek/deepseek-chat-v3.1"
}

function ghApi<T>(endpoint: string): T {
	const result = execSync(`gh api "${endpoint}"`, { encoding: "utf-8" })
	return JSON.parse(result) as T
}

interface Frontmatter {
	name?: string
	description?: string
	model?: string
	[key: string]: string | undefined
}

function parseFrontmatter(content: string): { fm: Frontmatter; body: string } {
	const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
	if (!match) return { fm: {}, body: content }

	const fm: Frontmatter = {}
	for (const line of match[1].split("\n")) {
		const colonIdx = line.indexOf(":")
		if (colonIdx === -1) continue
		const key = line.slice(0, colonIdx).trim()
		const value = line
			.slice(colonIdx + 1)
			.trim()
			.replace(/^["']|["']$/g, "")
		fm[key] = value
	}

	return { fm, body: match[2].trim() }
}

function buildPalotAgent(opts: {
	name: string
	description: string
	model: string
	color: string
	body: string
}): string {
	// Flatten to single line and escape single quotes for YAML single-quote wrapping
	const flat = opts.description.replace(/\n/g, " ").replace(/'/g, "''")
	const desc = `'${flat}'`

	return [
		"---",
		`name: ${opts.name}`,
		`description: ${desc}`,
		`model: ${opts.model}`,
		"mode: subagent",
		`color: ${opts.color}`,
		"---",
		"",
		opts.body,
	].join("\n")
}

interface GhFile {
	name: string
	type: string
	content?: string
}

async function main() {
	await fs.mkdir(OUTPUT_DIR, { recursive: true })

	let total = 0
	let errors = 0

	for (const [category, color] of Object.entries(CATEGORY_COLORS)) {
		console.log(`\nProcessing ${category}...`)

		let files: GhFile[]
		try {
			files = ghApi<GhFile[]>(
				`repos/VoltAgent/awesome-claude-code-subagents/contents/categories/${category}`,
			)
		} catch (e) {
			console.error(`  Failed to list category: ${e}`)
			errors++
			continue
		}

		const agentFiles = files.filter((f) => f.name.endsWith(".md") && f.name !== "README.md")

		for (const file of agentFiles) {
			try {
				const data = ghApi<{ content: string }>(
					`repos/VoltAgent/awesome-claude-code-subagents/contents/categories/${category}/${file.name}`,
				)
				const raw = Buffer.from(data.content, "base64").toString("utf-8")
				const { fm, body } = parseFrontmatter(raw)

				const name = fm.name || file.name.replace(/\.md$/i, "")
				const description = fm.description || `${name} specialist agent`
				const model = mapModel(fm.model || "sonnet")

				const palotContent = buildPalotAgent({ name, description, model, color, body })
				await fs.writeFile(path.join(OUTPUT_DIR, file.name), palotContent, "utf-8")
				console.log(`  ✓ ${file.name}`)
				total++
			} catch (e) {
				console.error(`  ✗ ${file.name}: ${e}`)
				errors++
			}
		}
	}

	console.log(`\nDone: ${total} agents generated, ${errors} errors`)
	console.log(`Output: ${OUTPUT_DIR}`)
}

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
