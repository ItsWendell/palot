import fs from "node:fs/promises"
import path from "node:path"

export function normalizeProjectDirectoryName(name: string): string {
	return name.trim()
}

export function assertSafeProjectDirectoryName(name: string): void {
	const normalized = normalizeProjectDirectoryName(name)
	if (!normalized) {
		throw new Error("Project name is required")
	}
	if (normalized === "." || normalized === ".." || normalized.includes("/") || normalized.includes("\\")) {
		throw new Error("Project name must be a single folder name")
	}
}

/** Create a project folder under a native-picker-selected parent directory. */
export async function createProjectDirectory(parentDirectory: string, name: string): Promise<string> {
	const normalized = normalizeProjectDirectoryName(name)
	assertSafeProjectDirectoryName(normalized)
	const newDirectory = path.join(parentDirectory, normalized)
	await fs.mkdir(newDirectory, { recursive: true })
	return newDirectory
}
