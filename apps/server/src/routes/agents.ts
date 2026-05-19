import fs from "node:fs/promises"
import path from "node:path"
import { Hono } from "hono"

interface ManagedAgent {
	filename: string
	name: string
	description: string
	model: string
	mode: "primary" | "subagent" | "all"
	color: string
	raw: string
	prompt: string
	origin: "user" | "project" | "builtin"
	team?: string
	teamRole?: "leader" | "member"
}

const FRONTMATTER_PATTERN = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/

function readFrontmatterValue(frontmatter: string, key: string): string {
	const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))
	return match ? match[1].trim().replace(/^["']|["']$/g, "") : ""
}

function parseAgentDocument(raw: string, filename: string): ManagedAgent {
	const basename = filename.replace(/\.md$/i, "")
	const match = raw.match(FRONTMATTER_PATTERN)

	if (!match) {
		return {
			filename: basename,
			name: basename,
			description: "",
			model: "",
			mode: "subagent",
			color: "",
			raw,
			prompt: raw,
			origin: "user",
		}
	}

	const [, frontmatter, body] = match
	const modeRaw = readFrontmatterValue(frontmatter, "mode") || "subagent"
	const teamRoleRaw = readFrontmatterValue(frontmatter, "team-role")

	return {
		filename: basename,
		name:
			readFrontmatterValue(frontmatter, "name") ||
			readFrontmatterValue(frontmatter, "title") ||
			basename,
		description: readFrontmatterValue(frontmatter, "description"),
		model: readFrontmatterValue(frontmatter, "model"),
		mode: modeRaw === "primary" ? "primary" : modeRaw === "all" ? "all" : "subagent",
		color: readFrontmatterValue(frontmatter, "color") || "",
		raw,
		prompt: body.trim(),
		origin: "user",
		team: readFrontmatterValue(frontmatter, "team") || undefined,
		teamRole: teamRoleRaw === "leader" ? "leader" : teamRoleRaw === "member" ? "member" : undefined,
	}
}

async function listAgents(projectPath: string): Promise<ManagedAgent[]> {
	const agentsDir = path.join(projectPath, ".opencode", "agents")
	let files: string[]
	try {
		files = (await fs.readdir(agentsDir)).filter((file) => file.endsWith(".md")).sort()
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code
		if (code === "ENOENT" || code === "EACCES" || code === "EPERM") {
			return []
		}
		throw err
	}

	return Promise.all(
		files.map(async (file) => {
			const raw = await fs.readFile(path.join(agentsDir, file), "utf-8")
			return parseAgentDocument(raw, file)
		}),
	)
}

async function directoryExists(dir: string): Promise<boolean> {
	try {
		await fs.access(dir)
		return true
	} catch {
		return false
	}
}

async function loadBuiltinAgents(): Promise<ManagedAgent[]> {
	const candidates = [
		path.resolve(process.cwd(), "../desktop/src/main/builtin-agents"),
		path.resolve(import.meta.dir, "../../../desktop/src/main/builtin-agents"),
	]
	const dir = (
		await Promise.all(
			candidates.map(async (candidate) => ((await directoryExists(candidate)) ? candidate : null)),
		)
	).find((candidate) => candidate !== null)
	if (!dir) return []

	const files = (await fs.readdir(dir)).filter((file) => file.endsWith(".md")).sort()
	return Promise.all(
		files.map(async (file) => {
			const raw = await fs.readFile(path.join(dir, file), "utf-8")
			return { ...parseAgentDocument(raw, file), origin: "builtin" as const }
		}),
	)
}

const app = new Hono().get("/", async (c) => {
	const projectPath = c.req.query("projectPath")
	if (!projectPath) {
		return c.json({ error: "projectPath is required" }, 400)
	}

	try {
		const userAgents = await listAgents(projectPath)
		const userFilenames = new Set(userAgents.map((agent) => agent.filename))
		const builtins = (await loadBuiltinAgents()).filter(
			(agent) => !userFilenames.has(agent.filename),
		)
		const agents = [...userAgents, ...builtins]
		return c.json({ agents }, 200)
	} catch (err) {
		const message = err instanceof Error ? err.message : "Failed to list agents"
		return c.json({ error: message }, 500)
	}
})

export default app
