/**
 * Main scanner entry point.
 * Discovers all Claude Code configuration files and returns structured data.
 */
import type { ScanOptions, ScanResult } from "../types/scan-result"
import { scanGlobal, scanHistory, scanProject } from "./claude-config"

/**
 * Scan for Claude Code configuration files.
 *
 * @param options - What to scan (global, specific project, history)
 * @returns Structured scan result with all discovered config data
 */
export async function scan(options: ScanOptions = {}): Promise<ScanResult> {
	const { global: scanGlobalConfig = true, project, includeHistory = false, since } = options

	const result: ScanResult = {
		global: { skills: [] },
		projects: [],
	}

	// Scan global config
	if (scanGlobalConfig) {
		result.global = await scanGlobal()
	}

	// Scan project(s)
	if (project) {
		const projectResult = await scanProject(project, result.global.userState)
		result.projects.push(projectResult)
	} else if (result.global.userState?.projects) {
		// Scan all known projects from ~/.claude.json
		const projectPaths = Object.keys(result.global.userState.projects)
		for (const projectPath of projectPaths) {
			const projectResult = await scanProject(projectPath, result.global.userState)
			result.projects.push(projectResult)
		}
	}

	// Scan history
	if (includeHistory) {
		result.history = await scanHistory(since)
	}

	return result
}
