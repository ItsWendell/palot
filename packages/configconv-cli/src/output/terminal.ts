/**
 * Terminal output formatting utilities for configconv CLI.
 */

import type { AgentFormat, BackupInfo, RestoreResult } from "@palot/configconv"
import consola from "consola"

/**
 * Format name for display.
 */
const FORMAT_LABELS: Record<AgentFormat, string> = {
	"claude-code": "Claude Code",
	opencode: "OpenCode",
	cursor: "Cursor",
}

/**
 * Print scan summary to the terminal (Claude Code format).
 */
export function printScanSummary(data: {
	format: AgentFormat
	globalSettings: boolean
	userState: boolean
	globalSkills: number
	projects: Array<{
		path: string
		mcp: number
		agents: number
		commands: number
		skills: number
		claudeMd: boolean
		agentsMd: boolean
	}>
	history?: { sessions: number; messages: number }
}): void {
	const label = FORMAT_LABELS[data.format]

	consola.log("")
	consola.log(`${label} Configuration Found:`)
	consola.log("")

	consola.log("  Global:")
	if (data.globalSettings) {
		consola.log("    ~/.Claude/settings.json         (model, permissions, env)")
	}
	if (data.userState) {
		consola.log("    ~/.claude.json                   (user state, project entries)")
	}
	if (data.globalSkills > 0) {
		consola.log(`    ~/.Claude/skills/                (${data.globalSkills} skills)`)
	}
	if (!data.globalSettings && !data.userState && data.globalSkills === 0) {
		consola.log("    (none found)")
	}

	for (const project of data.projects) {
		consola.log("")
		consola.log(`  Project: ${project.path}`)
		if (project.mcp > 0) {
			consola.log(`    MCP servers:  ${project.mcp}`)
		}
		if (project.agents > 0) {
			consola.log(`    Agents:       ${project.agents}`)
		}
		if (project.commands > 0) {
			consola.log(`    Commands:     ${project.commands}`)
		}
		if (project.skills > 0) {
			consola.log(`    Skills:       ${project.skills}`)
		}
		if (project.claudeMd) {
			consola.log("    CLAUDE.md:    yes")
		}
		if (project.agentsMd) {
			consola.log("    AGENTS.md:    yes (already exists)")
		}
	}

	if (data.history) {
		consola.log("")
		consola.log(`  History: ${data.history.sessions} sessions, ${data.history.messages} messages`)
	}

	consola.log("")
}

/**
 * Print a list of available backups.
 */
export function printBackupList(backups: BackupInfo[]): void {
	if (backups.length === 0) {
		consola.info("No backups found.")
		return
	}

	consola.log("")
	consola.log(`Available backups (${backups.length}):`)
	consola.log("")

	for (const backup of backups) {
		const fileCount = backup.manifest.files.length
		const date = new Date(backup.manifest.createdAt).toLocaleString()
		consola.log(`  ${backup.id}`)
		consola.log(`    Created: ${date}`)
		consola.log(`    Files:   ${fileCount}`)
		consola.log(`    Desc:    ${backup.manifest.description}`)
		consola.log("")
	}
}

/**
 * Print restore results.
 */
export function printRestoreResult(result: RestoreResult): void {
	if (result.restored.length > 0) {
		consola.success(`Restored (${result.restored.length}):`)
		for (const f of result.restored) {
			consola.log(`  < ${f}`)
		}
	}

	if (result.removed.length > 0) {
		consola.info(`Removed newly created files (${result.removed.length}):`)
		for (const f of result.removed) {
			consola.log(`  - ${f}`)
		}
	}

	if (result.errors.length > 0) {
		consola.error(`Errors (${result.errors.length}):`)
		for (const e of result.errors) {
			consola.log(`  ! ${e.path}: ${e.error}`)
		}
	}

	if (result.restored.length === 0 && result.removed.length === 0 && result.errors.length === 0) {
		consola.info("Nothing to restore.")
	}
}
