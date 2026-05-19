import fs from "node:fs/promises"
import path from "node:path"
import type { ManagedSkill } from "../shared/skills"

const FRONTMATTER_PATTERN = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/
const TAGS_PATTERN = /^tags:\s*\[([^\]]*)\]/m

function readFrontmatterValue(frontmatter: string, key: string): string {
	const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))
	return match ? match[1].trim().replace(/^["']|["']$/g, "") : ""
}

function parseTags(frontmatter: string): string[] {
	const match = frontmatter.match(TAGS_PATTERN)
	if (!match) return []

	return match[1]
		.split(",")
		.map((tag) => tag.trim().replace(/^["']|["']$/g, ""))
		.filter(Boolean)
}

/** Normalize user-provided skill names to a local markdown filename. */
export function normalizeSkillFilename(filename: string): string {
	const withoutExtension = filename.replace(/\.md$/i, "")
	const slug = withoutExtension.toLowerCase().replace(/[^a-z0-9-_]/g, "-").replace(/^-+|-+$/g, "")
	return `${slug || "untitled-skill"}.md`
}

/** Parse a skill markdown file into metadata and body content for the UI. */
export function parseSkillDocument(raw: string, filename: string): ManagedSkill {
	const basename = filename.replace(/\.md$/i, "")
	const match = raw.match(FRONTMATTER_PATTERN)

	if (!match) {
		return {
			filename: basename,
			name: basename,
			description: "",
			tags: [],
			author: "",
			created: "",
			content: raw,
			raw,
			origin: "user",
		}
	}

	const [, frontmatter, body] = match

	return {
		filename: basename,
		name: readFrontmatterValue(frontmatter, "name") || basename,
		description: readFrontmatterValue(frontmatter, "description"),
		tags: parseTags(frontmatter),
		author: readFrontmatterValue(frontmatter, "author"),
		created: readFrontmatterValue(frontmatter, "created"),
		content: body.trim(),
		raw,
		origin: "user",
	}
}

export class SkillsService {
	constructor(private readonly skillsDir: string) {}

	/** Build the production skills service rooted at ~/.config/opencode/skills. */
	static fromHomeDirectory(homeDirectory: string): SkillsService {
		return new SkillsService(path.join(homeDirectory, ".config", "opencode", "skills"))
	}

	/** Build a skills service rooted at an arbitrary external directory. */
	static fromExternalDirectory(dir: string): SkillsService {
		return new SkillsService(dir)
	}

	private async ensureDirectory(): Promise<void> {
		await fs.mkdir(this.skillsDir, { recursive: true })
	}

	auditLogPath(): string {
		return path.join(this.skillsDir, ".import-audit.jsonl")
	}

	/** List all skill documents in stable filename order, stamped with origin: "user". */
	async list(): Promise<ManagedSkill[]> {
		await this.ensureDirectory()
		const files = (await fs.readdir(this.skillsDir)).filter((file) => file.endsWith(".md")).sort()

		return Promise.all(
			files.map(async (file) => {
				const raw = await fs.readFile(path.join(this.skillsDir, file), "utf-8")
				const skill = parseSkillDocument(raw, file)
				return { ...skill, origin: "user" as const }
			}),
		)
	}

	/** List skills stamped with the given origin. */
	async listWithOrigin(origin: ManagedSkill["origin"]): Promise<ManagedSkill[]> {
		const skills = await this.list()
		return skills.map((s) => ({ ...s, origin }))
	}

	/** Scan ~/.opencode/skills/<repo-name>/ subdirectories for external skill files. */
	static async scanExternalRepositories(openCodeSkillsDir: string): Promise<ManagedSkill[]> {
		let entries: string[]
		try {
			entries = await fs.readdir(openCodeSkillsDir)
		} catch {
			return []
		}

		const results: ManagedSkill[] = []

		for (const entry of entries.sort()) {
			const repoPath = path.join(openCodeSkillsDir, entry)
			let stat: Awaited<ReturnType<typeof fs.stat>>
			try {
				stat = await fs.stat(repoPath)
			} catch {
				continue
			}
			if (!stat.isDirectory()) continue

			let files: string[]
			try {
				files = (await fs.readdir(repoPath)).filter((f) => f.endsWith(".md")).sort()
			} catch {
				continue
			}

			for (const file of files) {
				try {
					const raw = await fs.readFile(path.join(repoPath, file), "utf-8")
					const skill = parseSkillDocument(raw, file)
					results.push({ ...skill, origin: "external", externalRepo: entry })
				} catch {
					// skip unreadable files
				}
			}
		}

		return results
	}

	/** Write a skill document and return its normalized filename without .md. */
	async write(filename: string, raw: string): Promise<string> {
		await this.ensureDirectory()
		const safeFilename = normalizeSkillFilename(filename)
		await fs.writeFile(path.join(this.skillsDir, safeFilename), raw, "utf-8")
		return safeFilename.replace(/\.md$/i, "")
	}

	/** Delete a skill document by normalized filename. */
	async delete(filename: string): Promise<boolean> {
		const safeFilename = normalizeSkillFilename(filename)
		await fs.unlink(path.join(this.skillsDir, safeFilename))
		return true
	}
}
