/**
 * Scanner for OpenCode configuration files.
 *
 * Discovers:
 * - ~/.config/opencode/opencode.json (global config)
 * - ~/.config/opencode/AGENTS.md (global rules)
 * - ~/.config/opencode/agents/*.md (global agents)
 * - ~/.config/opencode/commands/*.md (global commands)
 * - ~/.config/opencode/skills/ (global skills)
 * - opencode.json (project config)
 * - AGENTS.md (project root)
 * - .opencode/agents/*.md (project agents)
 * - .opencode/commands/*.md (project commands)
 * - .opencode/skills/ (project skills)
 */

import type {
	OpenCodeGlobalScanResult,
	OpenCodeProjectScanResult,
} from "../converter/to-canonical/opencode"
import type { OpenCodeConfig } from "../types/opencode"
import type { AgentFile, CommandFile, SkillInfo } from "../types/scan-result"
import { exists, getSymlinkInfo, globDir, safeReadDir, safeReadFile } from "../utils/fs"
import { parseJsonc } from "../utils/json"
import * as paths from "../utils/paths"
import { parseFrontmatter } from "../utils/yaml"

/**
 * Scan global OpenCode configuration.
 */
export async function scanOpenCodeGlobal(): Promise<OpenCodeGlobalScanResult> {
	const result: OpenCodeGlobalScanResult = {
		agents: [],
		commands: [],
		skills: [],
	}

	// ~/.config/opencode/opencode.json
	const configPath = paths.ocGlobalConfigPath()
	const configContent = await safeReadFile(configPath)
	if (configContent) {
		try {
			result.config = parseJsonc<Partial<OpenCodeConfig>>(configContent)
			result.configPath = configPath
		} catch {
			// Skip malformed config
		}
	}

	// ~/.config/opencode/AGENTS.md
	const agentsMdPath = paths.ocGlobalAgentsMdPath()
	const agentsMd = await safeReadFile(agentsMdPath)
	if (agentsMd) {
		result.agentsMd = agentsMd
		result.agentsMdPath = agentsMdPath
	}

	// Global agents
	result.agents = await scanMarkdownDir(paths.ocGlobalAgentsDir())

	// Global commands
	result.commands = await scanMarkdownDir(paths.ocGlobalCommandsDir())

	// Global skills
	result.skills = await scanSkillsDir(paths.ocGlobalSkillsDir())

	return result
}

/**
 * Scan a specific project for OpenCode configuration.
 */
export async function scanOpenCodeProject(projectPath: string): Promise<OpenCodeProjectScanResult> {
	const result: OpenCodeProjectScanResult = {
		path: projectPath,
		agents: [],
		commands: [],
		skills: [],
	}

	// opencode.json at project root
	const configPath = paths.ocProjectConfigPath(projectPath)
	const configContent = await safeReadFile(configPath)
	if (configContent) {
		try {
			result.config = parseJsonc<Partial<OpenCodeConfig>>(configContent)
			result.configPath = configPath
		} catch {
			// Skip malformed config
		}
	}

	// AGENTS.md
	const agentsMdPath = paths.ocProjectAgentsMdPath(projectPath)
	const agentsMd = await safeReadFile(agentsMdPath)
	if (agentsMd) {
		result.agentsMd = agentsMd
		result.agentsMdPath = agentsMdPath
	}

	// .opencode/agents/*.md
	result.agents = await scanMarkdownDir(paths.ocProjectAgentsDir(projectPath))

	// .opencode/commands/*.md
	result.commands = await scanMarkdownDir(paths.ocProjectCommandsDir(projectPath))

	// .opencode/skills/
	result.skills = await scanSkillsDir(paths.ocProjectSkillsDir(projectPath))

	return result
}

// ─── Helpers ─────────────────────────────────────────────────────────

async function scanMarkdownDir(dir: string): Promise<(AgentFile | CommandFile)[]> {
	if (!(await exists(dir))) return []

	const files = await globDir(dir, "**/*.md")
	const results: (AgentFile | CommandFile)[] = []

	for (const filePath of files) {
		const content = await safeReadFile(filePath)
		if (!content) continue

		const { frontmatter, body } = parseFrontmatter(content)
		const name = filePath.split("/").pop()!.replace(/\.md$/, "")

		results.push({ path: filePath, name, content, frontmatter, body })
	}

	return results
}

async function scanSkillsDir(dir: string): Promise<SkillInfo[]> {
	if (!(await exists(dir))) return []

	const entries = await safeReadDir(dir)
	const skills: SkillInfo[] = []

	for (const entry of entries) {
		const skillDir = `${dir}/${entry}`
		const skillMdPath = `${skillDir}/SKILL.md`
		const content = await safeReadFile(skillMdPath)
		const symlinkInfo = await getSymlinkInfo(skillDir)

		if (content) {
			const { frontmatter } = parseFrontmatter(content)
			skills.push({
				path: skillMdPath,
				name: (frontmatter.name as string) ?? entry,
				description: frontmatter.description as string | undefined,
				isSymlink: symlinkInfo.isSymlink,
				symlinkTarget: symlinkInfo.target,
			})
		} else if (await exists(skillDir)) {
			skills.push({
				path: skillDir,
				name: entry,
				isSymlink: symlinkInfo.isSymlink,
				symlinkTarget: symlinkInfo.target,
			})
		}
	}

	return skills
}
