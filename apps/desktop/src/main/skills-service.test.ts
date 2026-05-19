import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { normalizeSkillFilename, parseSkillDocument, SkillsService } from "./skills-service"

const SAMPLE_SKILL_RAW = `---\nname: React Patterns\ndescription: UI guidance\ntags: ["react"]\nauthor: CJ\ncreated: 2026-05-12\n---\n\n# React Patterns`

describe("skills-service", () => {
	test("normalizes user-provided filenames safely", () => {
		expect(normalizeSkillFilename("React Patterns")).toBe("react-patterns.md")
		expect(normalizeSkillFilename("../secret")).toBe("secret.md")
		expect(normalizeSkillFilename("typescript-strict.md")).toBe("typescript-strict.md")
		expect(normalizeSkillFilename("!!!")).toBe("untitled-skill.md")
	})

	test("parses frontmatter metadata and markdown content", () => {
		const parsed = parseSkillDocument(
			`---\nname: React Patterns\ndescription: Component guidance\ntags: ["react", "hooks"]\nauthor: CJ\ncreated: 2026-05-12\n---\n\n# Body\nUse hooks carefully.`,
			"react-patterns.md",
		)

		expect(parsed.filename).toBe("react-patterns")
		expect(parsed.name).toBe("React Patterns")
		expect(parsed.description).toBe("Component guidance")
		expect(parsed.tags).toEqual(["react", "hooks"])
		expect(parsed.author).toBe("CJ")
		expect(parsed.created).toBe("2026-05-12")
		expect(parsed.content).toContain("Use hooks carefully.")
	})

	test("falls back gracefully for markdown without frontmatter", () => {
		const parsed = parseSkillDocument("# Untitled\nBody", "untitled.md")

		expect(parsed.name).toBe("untitled")
		expect(parsed.tags).toEqual([])
		expect(parsed.content).toBe("# Untitled\nBody")
	})

	test("performs skills CRUD against an isolated directory", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "palot-skills-"))
		const service = new SkillsService(dir)
		try {
			const filename = await service.write(
				"React Patterns",
				`---\nname: React Patterns\ndescription: UI guidance\ntags: ["react"]\nauthor: CJ\ncreated: 2026-05-12\n---\n\n# React Patterns`,
			)
			expect(filename).toBe("react-patterns")

			const skills = await service.list()
			expect(skills).toHaveLength(1)
			expect(skills[0].name).toBe("React Patterns")
			expect(skills[0].tags).toEqual(["react"])

			await service.delete(filename)
			expect(await service.list()).toEqual([])
		} finally {
			await fs.rm(dir, { recursive: true, force: true })
		}
	})

	test("list() stamps origin: user on all returned skills", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "palot-skills-"))
		const service = new SkillsService(dir)
		try {
			await service.write("React Patterns", SAMPLE_SKILL_RAW)
			const skills = await service.list()
			expect(skills).toHaveLength(1)
			expect(skills[0].origin).toBe("user")
		} finally {
			await fs.rm(dir, { recursive: true, force: true })
		}
	})

	test("parseSkillDocument stamps origin: user by default", () => {
		const skill = parseSkillDocument(SAMPLE_SKILL_RAW, "react-patterns.md")
		expect(skill.origin).toBe("user")
	})

	test("scanExternalRepositories returns skills from subdirectories with origin: external", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "palot-ext-"))
		try {
			const repoDir = path.join(root, "my-repo")
			await fs.mkdir(repoDir)
			await fs.writeFile(path.join(repoDir, "external-skill.md"), SAMPLE_SKILL_RAW, "utf-8")

			const skills = await SkillsService.scanExternalRepositories(root)
			expect(skills).toHaveLength(1)
			expect(skills[0].origin).toBe("external")
			expect(skills[0].externalRepo).toBe("my-repo")
			expect(skills[0].name).toBe("React Patterns")
		} finally {
			await fs.rm(root, { recursive: true, force: true })
		}
	})

	test("scanExternalRepositories returns empty array when directory does not exist", async () => {
		const skills = await SkillsService.scanExternalRepositories("/nonexistent/path/skills")
		expect(skills).toEqual([])
	})
})
