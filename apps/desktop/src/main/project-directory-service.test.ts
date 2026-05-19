import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import {
	assertSafeProjectDirectoryName,
	createProjectDirectory,
	normalizeProjectDirectoryName,
} from "./project-directory-service"

describe("project-directory-service", () => {
	test("normalizes and validates project directory names", () => {
		expect(normalizeProjectDirectoryName("  New Project  ")).toBe("New Project")
		expect(() => assertSafeProjectDirectoryName("")).toThrow("Project name is required")
		expect(() => assertSafeProjectDirectoryName("../secret")).toThrow(
			"Project name must be a single folder name",
		)
		expect(() => assertSafeProjectDirectoryName("nested/project")).toThrow(
			"Project name must be a single folder name",
		)
	})

	test("creates a named project directory under the selected parent", async () => {
		const parent = await fs.mkdtemp(path.join(os.tmpdir(), "palot-project-create-"))
		try {
			const created = await createProjectDirectory(parent, "My Project")
			expect(created).toBe(path.join(parent, "My Project"))
			const stat = await fs.stat(created)
			expect(stat.isDirectory()).toBe(true)
		} finally {
			await fs.rm(parent, { recursive: true, force: true })
		}
	})
})
