import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { parseKnowledgeDocument, KnowledgeService } from "./knowledge-service"

// ============================================================
// parseKnowledgeDocument
// ============================================================

describe("parseKnowledgeDocument", () => {
	test("parses all frontmatter fields", () => {
		const raw = [
			"---",
			'title: "Test Guide"',
			'description: "A test"',
			'source: "https://example.com"',
			'tags: "testing, docs"',
			'agents: "code-reviewer"',
			"updated: 2026-01-15",
			"---",
			"",
			"Body content here.",
		].join("\n")

		const doc = parseKnowledgeDocument(raw, "test-guide.md", "project")
		expect(doc.title).toBe("Test Guide")
		expect(doc.description).toBe("A test")
		expect(doc.source).toBe("https://example.com")
		expect(doc.tags).toBe("testing, docs")
		expect(doc.agents).toBe("code-reviewer")
		expect(doc.updated).toBe("2026-01-15")
		expect(doc.prompt).toBe("Body content here.")
	})

	test("falls back to filename when no frontmatter", () => {
		const doc = parseKnowledgeDocument("Just plain text.", "my-guide.md", "project")
		expect(doc.title).toBe("my-guide")
		expect(doc.filename).toBe("my-guide")
		expect(doc.prompt).toBe("Just plain text.")
	})

	test("strips .md from filename for slug", () => {
		const doc = parseKnowledgeDocument("---\ntitle: T\n---\nbody", "api-guide.md", "project")
		expect(doc.filename).toBe("api-guide")
	})
})

// ============================================================
// KnowledgeService.get() — path traversal guard
// ============================================================

describe("KnowledgeService.get — path traversal", () => {
	test("blocks ../traversal in filename", async () => {
		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ks-test-"))
		const svc = new KnowledgeService(tmpDir)
		const result = await svc.get("../../etc/passwd")
		expect(result).toBeNull()
		await fs.rm(tmpDir, { recursive: true })
	})

	test("blocks filenames with path separators", async () => {
		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ks-test-"))
		const svc = new KnowledgeService(tmpDir)
		const result = await svc.get("subdir/secret")
		expect(result).toBeNull()
		await fs.rm(tmpDir, { recursive: true })
	})

	test("blocks filenames with null bytes", async () => {
		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ks-test-"))
		const svc = new KnowledgeService(tmpDir)
		const result = await svc.get("valid\x00evil")
		expect(result).toBeNull()
		await fs.rm(tmpDir, { recursive: true })
	})

	test("returns null for non-existent valid filename", async () => {
		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ks-test-"))
		const svc = new KnowledgeService(tmpDir)
		const result = await svc.get("does-not-exist")
		expect(result).toBeNull()
		await fs.rm(tmpDir, { recursive: true })
	})

	test("reads valid file within knowledge directory", async () => {
		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ks-test-"))
		const svc = new KnowledgeService(tmpDir)
		await fs.writeFile(
			path.join(tmpDir, "my-doc.md"),
			"---\ntitle: My Doc\n---\nContent here.",
		)
		const result = await svc.get("my-doc")
		expect(result).not.toBeNull()
		expect(result?.title).toBe("My Doc")
		expect(result?.prompt).toBe("Content here.")
		await fs.rm(tmpDir, { recursive: true })
	})

	test("accepts filename with .md extension", async () => {
		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ks-test-"))
		const svc = new KnowledgeService(tmpDir)
		await fs.writeFile(path.join(tmpDir, "guide.md"), "Guide content.")
		const result = await svc.get("guide.md")
		expect(result).not.toBeNull()
		expect(result?.prompt).toBe("Guide content.")
		await fs.rm(tmpDir, { recursive: true })
	})
})
