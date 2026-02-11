/**
 * Writer module.
 *
 * Writes conversion results to the filesystem.
 * Supports dry-run mode, backup, and configurable merge strategies.
 */
import type { ConversionResult } from "../types/conversion-result"
import type { OpenCodeConfig } from "../types/opencode"
import { ensureDir, exists, safeReadFile, writeFileSafe } from "../utils/fs"
import { stringifyJson } from "../utils/json"
import * as paths from "../utils/paths"
import { type MergeStrategy, mergeConfigs } from "./merge"

export interface WriteOptions {
	/** Simulate writes without touching disk */
	dryRun?: boolean
	/** Back up existing files before overwriting */
	backup?: boolean
	/** Overwrite existing files */
	force?: boolean
	/** How to handle existing opencode.json configs */
	mergeStrategy?: MergeStrategy
}

export interface WriteResult {
	/** Files that were written (or would be in dry-run) */
	filesWritten: string[]
	/** Files that were skipped because they already exist */
	filesSkipped: string[]
	/** Backup file paths created */
	backupPaths: string[]
}

/**
 * Write conversion results to disk.
 *
 * @param conversion - Output from `convert()`
 * @param options - Write options (dry-run, backup, force, merge strategy)
 * @returns Summary of files written/skipped/backed up
 */
export async function write(
	conversion: ConversionResult,
	options: WriteOptions = {},
): Promise<WriteResult> {
	const {
		dryRun = false,
		backup = false,
		force = false,
		mergeStrategy = "preserve-existing",
	} = options

	const result: WriteResult = {
		filesWritten: [],
		filesSkipped: [],
		backupPaths: [],
	}

	// ─── Write global config ─────────────────────────────────────────
	if (Object.keys(conversion.globalConfig).length > 0) {
		const globalConfigPath = paths.ocGlobalConfigPath()
		await writeConfigFile(
			globalConfigPath,
			conversion.globalConfig,
			{ dryRun, backup, force, mergeStrategy },
			result,
		)
	}

	// ─── Write per-project configs ───────────────────────────────────
	for (const [projectPath, config] of conversion.projectConfigs) {
		const configPath = paths.ocProjectConfigPath(projectPath)
		await writeConfigFile(configPath, config, { dryRun, backup, force, mergeStrategy }, result)
	}

	// ─── Write agent files ───────────────────────────────────────────
	for (const [targetPath, content] of conversion.agents) {
		await writeFile(targetPath, content, { dryRun, backup, force }, result)
	}

	// ─── Write command files ─────────────────────────────────────────
	for (const [targetPath, content] of conversion.commands) {
		await writeFile(targetPath, content, { dryRun, backup, force }, result)
	}

	// ─── Write rules files (AGENTS.md) ───────────────────────────────
	for (const [targetPath, content] of conversion.rules) {
		await writeFile(targetPath, content, { dryRun, backup, force }, result)
	}

	// ─── Write hook plugin stubs ─────────────────────────────────────
	for (const [targetPath, content] of conversion.hookPlugins) {
		await writeFile(targetPath, content, { dryRun, backup, force }, result)
	}

	// ─── Write session history (if present) ──────────────────────────
	if (conversion.sessions && conversion.sessions.length > 0) {
		const storageDir = paths.ocStorageDir()

		for (const session of conversion.sessions) {
			// Write session metadata
			const sessionPath = `${storageDir}/session/${session.projectId}/${session.session.id}.json`
			await writeFile(
				sessionPath,
				stringifyJson(session.session),
				{ dryRun, backup, force },
				result,
			)

			// Write messages
			for (const message of session.messages) {
				const messagePath = `${storageDir}/message/${session.session.id}/${message.id}.json`
				await writeFile(messagePath, stringifyJson(message), { dryRun, backup, force }, result)
			}
		}
	}

	// ─── Write prompt history (if present) ───────────────────────────
	if (conversion.promptHistory && conversion.promptHistory.length > 0) {
		const historyPath = paths.ocPromptHistoryPath()
		const lines = conversion.promptHistory.map((e) => JSON.stringify(e)).join("\n") + "\n"

		// Append to existing history
		if (!dryRun) {
			const existingContent = await safeReadFile(historyPath)
			const finalContent = existingContent ? existingContent + lines : lines
			await writeFileSafe(historyPath, finalContent)
		}
		result.filesWritten.push(historyPath)
	}

	return result
}

// ─── Internal helpers ────────────────────────────────────────────────

async function writeConfigFile(
	filePath: string,
	config: Partial<OpenCodeConfig>,
	options: {
		dryRun: boolean
		backup: boolean
		force: boolean
		mergeStrategy: MergeStrategy
	},
	result: WriteResult,
): Promise<void> {
	const existingContent = await safeReadFile(filePath)

	if (existingContent) {
		if (!options.force && options.mergeStrategy === "overwrite") {
			result.filesSkipped.push(filePath)
			return
		}

		// Merge with existing
		let existingConfig: Partial<OpenCodeConfig> = {}
		try {
			existingConfig = JSON.parse(existingContent) as Partial<OpenCodeConfig>
		} catch {
			// Existing file is malformed -- treat as empty
		}

		if (options.backup && !options.dryRun) {
			const backupPath = filePath + ".bak"
			await writeFileSafe(backupPath, existingContent)
			result.backupPaths.push(backupPath)
		}

		const merged = mergeConfigs(existingConfig, config, options.mergeStrategy)

		if (!options.dryRun) {
			await writeFileSafe(filePath, stringifyJson(merged))
		}
		result.filesWritten.push(filePath)
	} else {
		// New file
		if (!options.dryRun) {
			await writeFileSafe(filePath, stringifyJson(config))
		}
		result.filesWritten.push(filePath)
	}
}

async function writeFile(
	filePath: string,
	content: string,
	options: { dryRun: boolean; backup: boolean; force: boolean },
	result: WriteResult,
): Promise<void> {
	const fileExists = await exists(filePath)

	if (fileExists && !options.force) {
		result.filesSkipped.push(filePath)
		return
	}

	if (fileExists && options.backup && !options.dryRun) {
		const existingContent = await safeReadFile(filePath)
		if (existingContent) {
			const backupPath = filePath + ".bak"
			await writeFileSafe(backupPath, existingContent)
			result.backupPaths.push(backupPath)
		}
	}

	if (!options.dryRun) {
		await writeFileSafe(filePath, content)
	}
	result.filesWritten.push(filePath)
}

export { type MergeStrategy, mergeConfigs } from "./merge"
