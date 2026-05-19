import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { ProjectBrainService } from "./project-brain-service"

describe("ProjectBrainService", () => {
	test("listFiles returns slugs for files that exist", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "palot-brain-"))
		const service = new ProjectBrainService(dir)
		try {
			await fs.writeFile(path.join(dir, "README.md"), "# Hello", "utf-8")
			await fs.writeFile(path.join(dir, "architecture.md"), "# Arch", "utf-8")
			const slugs = await service.listFiles()
			expect(slugs).toEqual(["README", "architecture"])
		} finally {
			await fs.rm(dir, { recursive: true, force: true })
		}
	})

	test("readFile returns content for existing file", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "palot-brain-"))
		const service = new ProjectBrainService(dir)
		try {
			await fs.writeFile(path.join(dir, "tasks.md"), "# Tasks", "utf-8")
			const content = await service.readFile("tasks")
			expect(content).toBe("# Tasks")
		} finally {
			await fs.rm(dir, { recursive: true, force: true })
		}
	})

	test("readFile returns null for missing file", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "palot-brain-"))
		const service = new ProjectBrainService(dir)
		try {
			const content = await service.readFile("nonexistent")
			expect(content).toBeNull()
		} finally {
			await fs.rm(dir, { recursive: true, force: true })
		}
	})

	test("writeFile creates file", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "palot-brain-"))
		const service = new ProjectBrainService(dir)
		try {
			await service.writeFile("decisions", "# Decisions\n\nSome content.")
			const content = await fs.readFile(path.join(dir, "decisions.md"), "utf-8")
			expect(content).toBe("# Decisions\n\nSome content.")
		} finally {
			await fs.rm(dir, { recursive: true, force: true })
		}
	})

	test("writeFile overwrites existing file", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "palot-brain-"))
		const service = new ProjectBrainService(dir)
		try {
			await service.writeFile("issues", "first")
			await service.writeFile("issues", "second")
			const content = await service.readFile("issues")
			expect(content).toBe("second")
		} finally {
			await fs.rm(dir, { recursive: true, force: true })
		}
	})

	test("appendFile appends without overwriting existing content", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "palot-brain-"))
		const service = new ProjectBrainService(dir)
		try {
			await service.writeFile("run-history", "# Run History")
			await service.appendFile("run-history", "- first run")
			await service.appendFile("run-history", "- second run")
			const content = await service.readFile("run-history")
			expect(content).toBe("# Run History\n- first run\n- second run")
		} finally {
			await fs.rm(dir, { recursive: true, force: true })
		}
	})

	test("recordEvent appends a timestamped event section", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "palot-brain-"))
		const service = new ProjectBrainService(dir)
		try {
			await service.recordEvent("run-history", "agent completed", "summary")
			const content = await service.readFile("run-history")
			expect(content).toContain("## ")
			expect(content).toContain("— agent completed")
			expect(content).toContain("summary")
		} finally {
			await fs.rm(dir, { recursive: true, force: true })
		}
	})

	test("readFile and deleteFile reject path traversal slugs", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "palot-brain-"))
		const service = new ProjectBrainService(dir)
		try {
			await fs.writeFile(path.join(dir, "safe.md"), "safe", "utf-8")
			expect(await service.readFile("../safe")).toBeNull()
			expect(await service.deleteFile("../safe")).toBe(false)
			expect(await service.readFile("safe")).toBe("safe")
		} finally {
			await fs.rm(dir, { recursive: true, force: true })
		}
	})

	test("writeFile rejects path traversal slugs", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "palot-brain-"))
		const service = new ProjectBrainService(dir)
		try {
			await expect(service.writeFile("../outside", "nope")).rejects.toThrow("Invalid brain file slug")
			await expect(fs.readFile(path.join(dir, "..", "outside.md"), "utf-8")).rejects.toThrow()
		} finally {
			await fs.rm(dir, { recursive: true, force: true })
		}
	})

	test("buildSummary returns string at most 2000 chars", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "palot-brain-"))
		const service = new ProjectBrainService(dir)
		try {
			await service.writeFile("README", "# Nexus Builder\nA short description.")
			await service.writeFile("architecture", "# Arch\n" + "x".repeat(1000))
			await service.writeFile("tasks", "# Tasks\n| col1 | col2 |\n|------|------|\n| a | b |")
			await service.writeFile("issues", "# Issues\nNone.")
			const summary = await service.buildSummary()
			expect(typeof summary).toBe("string")
			expect(summary.length).toBeLessThanOrEqual(2000)
		} finally {
			await fs.rm(dir, { recursive: true, force: true })
		}
	})

	test("buildSummary works with missing files", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "palot-brain-"))
		const service = new ProjectBrainService(dir)
		try {
			const summary = await service.buildSummary()
			expect(typeof summary).toBe("string")
			expect(summary.length).toBeLessThanOrEqual(2000)
		} finally {
			await fs.rm(dir, { recursive: true, force: true })
		}
	})
})
