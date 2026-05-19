import fs from "node:fs/promises"
import path from "node:path"
import type { KnowledgeSource } from "../shared/knowledge"

const FRONTMATTER_PATTERN = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/

function readFrontmatterValue(frontmatter: string, key: string): string {
	const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))
	return match ? match[1].trim().replace(/^["']|["']$/g, "") : ""
}

/** Parse a knowledge markdown file into metadata and body. */
export function parseKnowledgeDocument(raw: string, filename: string, origin: string): KnowledgeSource {
	const basename = filename.replace(/\.md$/i, "")
	const match = raw.match(FRONTMATTER_PATTERN)

	if (!match) {
		return {
			filename: basename,
			title: basename,
			description: "",
			source: origin,
			tags: "",
			agents: "",
			raw,
			prompt: raw,
			updated: new Date().toISOString().slice(0, 10),
		}
	}

	const [, frontmatter, body] = match

	return {
		filename: basename,
		title: readFrontmatterValue(frontmatter, "title") || basename,
		description: readFrontmatterValue(frontmatter, "description"),
		source: readFrontmatterValue(frontmatter, "source") || origin,
		tags: readFrontmatterValue(frontmatter, "tags") || "",
		agents: readFrontmatterValue(frontmatter, "agents") || "",
		raw,
		prompt: body.trim(),
		updated: readFrontmatterValue(frontmatter, "updated") || new Date().toISOString().slice(0, 10),
	}
}

export class KnowledgeService {
	constructor(private readonly knowledgeDir: string) {}

	static fromProjectRoot(projectPath: string): KnowledgeService {
		return new KnowledgeService(path.join(projectPath, ".agents", "knowledge"))
	}

	static fromHomeDirectory(homeDir: string): KnowledgeService {
		return new KnowledgeService(path.join(homeDir, ".config", "palot", "knowledge"))
	}

	private async ensureDirectory(): Promise<void> {
		await fs.mkdir(this.knowledgeDir, { recursive: true })
	}

	/** List all knowledge documents in stable filename order. */
	async list(): Promise<KnowledgeSource[]> {
		await this.ensureDirectory()
		const files = (await fs.readdir(this.knowledgeDir))
			.filter((file) => file.endsWith(".md") && !file.endsWith("generate-obsidian-knowledge.ts"))
			.sort()

		return Promise.all(
			files.map(async (file) => {
				const raw = await fs.readFile(path.join(this.knowledgeDir, file), "utf-8")
				return parseKnowledgeDocument(raw, file, "project")
			}),
		)
	}

	/** Get a single knowledge source by filename (with or without .md). */
	async get(filename: string): Promise<KnowledgeSource | null> {
		const normalized = filename.replace(/\.md$/i, "")
		if (!/^[A-Za-z0-9_.-]+$/.test(normalized)) return null
		const safeFilename = normalized + ".md"
		const root = path.resolve(this.knowledgeDir)
		const fullPath = path.resolve(root, safeFilename)
		if (!fullPath.startsWith(root + path.sep)) return null
		try {
			const raw = await fs.readFile(fullPath, "utf-8")
			return parseKnowledgeDocument(raw, safeFilename, "project")
		} catch {
			return null
		}
	}
}
