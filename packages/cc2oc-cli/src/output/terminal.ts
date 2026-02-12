/**
 * Terminal output formatting utilities.
 */

import type { BackupInfo, DiffItem, DiffResult, MigrationReport, RestoreResult } from "@palot/cc2oc"
import consola from "consola"

/**
 * Print a migration report to the terminal.
 */
export function printReport(report: MigrationReport): void {
	if (report.migrated.length > 0) {
		consola.success(`Migrated (${report.migrated.length}):`)
		for (const item of report.migrated) {
			const details = item.details ? ` -- ${item.details}` : ""
			consola.log(`  [${item.category}] ${item.source} -> ${item.target}${details}`)
		}
	}

	if (report.skipped.length > 0) {
		consola.info(`Skipped (${report.skipped.length}):`)
		for (const item of report.skipped) {
			const details = item.details ? ` -- ${item.details}` : ""
			consola.log(`  [${item.category}] ${item.source}${details}`)
		}
	}

	if (report.warnings.length > 0) {
		consola.warn(`Warnings (${report.warnings.length}):`)
		for (const warning of report.warnings) {
			consola.log(`  ${warning}`)
		}
	}

	if (report.manualActions.length > 0) {
		consola.box({
			title: "Manual Actions Required",
			message: report.manualActions.map((a, i) => `${i + 1}. ${a}`).join("\n"),
		})
	}

	if (report.errors.length > 0) {
		consola.error(`Errors (${report.errors.length}):`)
		for (const error of report.errors) {
			consola.log(`  ${error}`)
		}
	}
}

/**
 * Print scan summary to the terminal.
 */
export function printScanSummary(data: {
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
	consola.log("")
	consola.log("Claude Code Configuration Found:")
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
 * Print write results summary.
 */
export function printWriteResult(data: {
	filesWritten: string[]
	filesSkipped: string[]
	backupDir?: string
	backupPaths: string[]
}): void {
	if (data.filesWritten.length > 0) {
		consola.success(`Files written (${data.filesWritten.length}):`)
		for (const f of data.filesWritten) {
			consola.log(`  + ${f}`)
		}
	}

	if (data.filesSkipped.length > 0) {
		consola.info(`Files skipped (${data.filesSkipped.length}):`)
		for (const f of data.filesSkipped) {
			consola.log(`  ~ ${f}`)
		}
	}

	if (data.backupDir) {
		consola.info(`Backup snapshot: ${data.backupDir}`)
		consola.log("  Run `cc2oc restore` to revert if needed.")
	}
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

/**
 * Print diff results.
 */
export function printDiff(diffResult: DiffResult): void {
	consola.log("")

	if (diffResult.onlyInClaudeCode.length > 0) {
		consola.warn(`Only in Claude Code (${diffResult.onlyInClaudeCode.length}):`)
		for (const item of diffResult.onlyInClaudeCode) {
			printDiffItem("+", item)
		}
	}

	if (diffResult.onlyInOpenCode.length > 0) {
		consola.info(`Only in OpenCode (${diffResult.onlyInOpenCode.length}):`)
		for (const item of diffResult.onlyInOpenCode) {
			printDiffItem("-", item)
		}
	}

	if (diffResult.different.length > 0) {
		consola.warn(`Different (${diffResult.different.length}):`)
		for (const item of diffResult.different) {
			printDiffItem("~", item)
		}
	}

	if (diffResult.matching.length > 0) {
		consola.success(`Matching (${diffResult.matching.length}):`)
		for (const item of diffResult.matching) {
			printDiffItem("=", item)
		}
	}

	consola.log("")
}

function printDiffItem(prefix: string, item: DiffItem): void {
	const details = item.details ? ` -- ${item.details}` : ""
	consola.log(`  ${prefix} [${item.category}] ${item.key}${details}`)
}
