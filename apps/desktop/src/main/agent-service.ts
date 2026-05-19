import fs from "node:fs/promises"
import path from "node:path"
import type { ManagedAgent } from "../shared/agents"

const FRONTMATTER_PATTERN = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/

function readFrontmatterValue(frontmatter: string, key: string): string {
	const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))
	return match ? match[1].trim().replace(/^["']|["']$/g, "") : ""
}

/** Parse an agent markdown file into metadata and prompt body. */
export function parseAgentDocument(raw: string, filename: string): ManagedAgent {
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
		name: readFrontmatterValue(frontmatter, "name") || readFrontmatterValue(frontmatter, "title") || basename,
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

/** Normalize user-provided agent names to a local markdown filename. */
export function normalizeAgentFilename(filename: string): string {
	const withoutExtension = filename.replace(/\.md$/i, "")
	const slug = withoutExtension.toLowerCase().replace(/[^a-z0-9-_]/g, "-").replace(/^-+|-+$/g, "")
	return `${slug || "untitled-agent"}.md`
}

export class AgentService {
	constructor(private readonly agentsDir: string) {}

	/** Build an AgentService rooted at a project's .opencode/agents directory. */
	static fromProjectDirectory(projectDir: string): AgentService {
		return new AgentService(path.join(projectDir, ".opencode", "agents"))
	}

	private async ensureDirectory(): Promise<void> {
		await fs.mkdir(this.agentsDir, { recursive: true })
	}

	/** List all agent documents in stable filename order. */
	async list(): Promise<ManagedAgent[]> {
		await this.ensureDirectory()
		const files = (await fs.readdir(this.agentsDir))
			.filter((file) => file.endsWith(".md"))
			.sort()

		return Promise.all(
			files.map(async (file) => {
				const raw = await fs.readFile(path.join(this.agentsDir, file), "utf-8")
				return parseAgentDocument(raw, file)
			}),
		)
	}

	/** Get a single agent by filename (with or without .md). */
	async get(filename: string): Promise<ManagedAgent | null> {
		const safeFilename = normalizeAgentFilename(filename)
		const fullPath = path.join(this.agentsDir, safeFilename)
		try {
			const raw = await fs.readFile(fullPath, "utf-8")
			return parseAgentDocument(raw, safeFilename)
		} catch {
			return null
		}
	}

	/** Write an agent document and return its normalized filename without .md. */
	async write(filename: string, raw: string): Promise<string> {
		await this.ensureDirectory()
		const safeFilename = normalizeAgentFilename(filename)
		await fs.writeFile(path.join(this.agentsDir, safeFilename), raw, "utf-8")
		return safeFilename.replace(/\.md$/i, "")
	}

	/** Delete an agent document by normalized filename. */
	async delete(filename: string): Promise<boolean> {
		const safeFilename = normalizeAgentFilename(filename)
		await fs.unlink(path.join(this.agentsDir, safeFilename))
		return true
	}
}
