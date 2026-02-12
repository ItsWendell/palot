/**
 * Onboarding handlers for the Palot desktop app.
 *
 * Provides IPC-callable functions for the first-run experience:
 * - OpenCode CLI detection and version compatibility check
 * - OpenCode CLI installation (via curl/shell)
 * - Claude Code detection and migration via @palot/cc2oc
 */

import { type ChildProcess, spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { BrowserWindow } from "electron"
import type { OpenCodeCheckResult } from "./compatibility"
import { checkOpenCode } from "./compatibility"
import { createLogger } from "./logger"

const log = createLogger("onboarding")

// ============================================================
// Types
// ============================================================

export interface ClaudeCodeDetection {
	found: boolean
	hasGlobalSettings: boolean
	hasUserState: boolean
	projectCount: number
	mcpServerCount: number
	agentCount: number
	commandCount: number
	hasRules: boolean
	hasHooks: boolean
	skillCount: number
	totalSessions: number
	totalMessages: number
}

export interface MigrationPreview {
	categories: MigrationCategoryPreview[]
	warnings: string[]
	manualActions: string[]
	errors: string[]
	fileCount: number
	/** Number of sessions that will be imported (0 if history not selected) */
	sessionCount: number
	/** Number of projects the sessions span */
	sessionProjectCount: number
}

export interface MigrationCategoryPreview {
	category: string
	itemCount: number
	files: MigrationFilePreview[]
}

export interface MigrationFilePreview {
	path: string
	status: "new" | "modified" | "skipped"
	lineCount: number
	content?: string
}

export interface MigrationResult {
	success: boolean
	filesWritten: string[]
	filesSkipped: string[]
	backupDir: string | null
	warnings: string[]
	manualActions: string[]
	errors: string[]
}

// ============================================================
// OpenCode check (delegates to compatibility module)
// ============================================================

export async function checkOpenCodeInstallation(): Promise<OpenCodeCheckResult> {
	return checkOpenCode()
}

// ============================================================
// OpenCode install
// ============================================================

let installProcess: ChildProcess | null = null

/**
 * Installs OpenCode CLI by running the official install script.
 * Streams output lines to the renderer via the "onboarding:install-output" channel.
 * Returns when the install process exits.
 */
export async function installOpenCode(): Promise<{ success: boolean; error?: string }> {
	if (installProcess) {
		return { success: false, error: "Installation already in progress" }
	}

	return new Promise((resolve) => {
		const isWindows = process.platform === "win32"

		if (isWindows) {
			// Windows: use PowerShell to run the install script
			installProcess = spawn(
				"powershell",
				["-Command", "irm https://opencode.ai/install.ps1 | iex"],
				{
					cwd: homedir(),
					stdio: "pipe",
					env: process.env,
				},
			)
		} else {
			// macOS/Linux: use bash + curl
			installProcess = spawn("bash", ["-c", "curl -fsSL https://opencode.ai/install | bash"], {
				cwd: homedir(),
				stdio: "pipe",
				env: process.env,
			})
		}

		const proc = installProcess

		const sendOutput = (text: string) => {
			for (const win of BrowserWindow.getAllWindows()) {
				win.webContents.send("onboarding:install-output", text)
			}
		}

		proc.stdout?.on("data", (data: Buffer) => {
			const text = data.toString()
			sendOutput(text)
			log.debug(`[install:stdout] ${text.trim()}`)
		})

		proc.stderr?.on("data", (data: Buffer) => {
			const text = data.toString()
			sendOutput(text)
			log.debug(`[install:stderr] ${text.trim()}`)
		})

		proc.on("error", (err) => {
			log.error("Install process error", err)
			installProcess = null
			resolve({ success: false, error: err.message })
		})

		proc.on("exit", (code) => {
			installProcess = null
			if (code === 0) {
				log.info("OpenCode install completed successfully")
				resolve({ success: true })
			} else {
				log.warn("OpenCode install exited with code", code)
				resolve({ success: false, error: `Install script exited with code ${code}` })
			}
		})
	})
}

// ============================================================
// Claude Code detection
// ============================================================

/**
 * Quickly detects whether Claude Code configuration exists on this machine.
 * Does NOT import @palot/cc2oc -- just checks for file existence.
 * This keeps the main process startup fast when cc2oc isn't needed.
 */
export async function detectClaudeCode(): Promise<ClaudeCodeDetection> {
	const home = homedir()
	const claudeDir = path.join(home, ".claude")
	const claudeSettingsDir = path.join(home, ".Claude")

	const hasGlobalSettings = existsSync(path.join(claudeSettingsDir, "settings.json"))
	const hasUserState = existsSync(path.join(home, ".claude.json"))

	// Check for projects directory to estimate project count
	const projectsDir = path.join(claudeSettingsDir, "projects")
	let projectCount = 0
	try {
		const { readdirSync } = await import("node:fs")
		const entries = readdirSync(projectsDir, { withFileTypes: true })
		projectCount = entries.filter((e) => e.isDirectory()).length
	} catch {
		// Directory doesn't exist
	}

	const found = hasGlobalSettings || hasUserState || projectCount > 0

	return {
		found,
		hasGlobalSettings,
		hasUserState,
		projectCount,
		// These will be populated by the full scan if the user proceeds
		mcpServerCount: 0,
		agentCount: 0,
		commandCount: 0,
		hasRules: existsSync(path.join(claudeDir, "CLAUDE.md")) || existsSync("CLAUDE.md"),
		hasHooks: false,
		skillCount: 0,
		totalSessions: 0,
		totalMessages: 0,
	}
}

// ============================================================
// Migration (lazy-loads @palot/cc2oc)
// ============================================================

/**
 * Runs the full cc2oc scan and returns detailed detection results.
 * Lazy-loads @palot/cc2oc to keep the main process fast when not needed.
 */
export async function scanClaudeCode(): Promise<{
	detection: ClaudeCodeDetection
	scanResult: unknown
}> {
	const { scan } = await import("@palot/cc2oc")
	const scanResult = await scan({ global: true, includeHistory: true })

	const detection: ClaudeCodeDetection = {
		found: true,
		hasGlobalSettings: !!scanResult.global.settings,
		hasUserState: !!scanResult.global.userState,
		projectCount: scanResult.projects.length,
		mcpServerCount: countMcpServers(scanResult),
		agentCount: countAgents(scanResult),
		commandCount: countCommands(scanResult),
		hasRules: !!scanResult.global.claudeMd || scanResult.projects.some((p) => !!p.claudeMd),
		hasHooks: !!(scanResult.global.settings as Record<string, unknown>)?.hooks,
		skillCount:
			scanResult.global.skills.length +
			scanResult.projects.reduce((sum, p) => sum + p.skills.length, 0),
		totalSessions: scanResult.history?.totalSessions ?? 0,
		totalMessages: scanResult.history?.totalMessages ?? 0,
	}

	return { detection, scanResult }
}

/**
 * Runs a dry-run migration preview. Returns what would be changed without writing anything.
 */
export async function previewMigration(
	scanResult: unknown,
	categories: string[],
): Promise<MigrationPreview> {
	const { convert, validate } = await import("@palot/cc2oc")
	const includeHistory = categories.includes("history")
	// biome-ignore lint/suspicious/noExplicitAny: cc2oc ScanResult is dynamically imported
	const conversion = await convert(scanResult as any, {
		categories: categories as Array<
			| "config"
			| "mcp"
			| "agents"
			| "commands"
			| "skills"
			| "permissions"
			| "rules"
			| "hooks"
			| "history"
		>,
		includeHistory,
	})
	const validation = validate(conversion)

	const categoryPreviews: MigrationCategoryPreview[] = []

	// Global config
	if (Object.keys(conversion.globalConfig).length > 0) {
		const content = JSON.stringify(conversion.globalConfig, null, 2)
		categoryPreviews.push({
			category: "config",
			itemCount: 1,
			files: [
				{
					path: "~/.config/opencode/opencode.json",
					status: "new",
					lineCount: content.split("\n").length,
					content,
				},
			],
		})
	}

	// Project configs
	for (const [projectPath, config] of conversion.projectConfigs) {
		if (Object.keys(config).length > 0) {
			const content = JSON.stringify(config, null, 2)
			categoryPreviews.push({
				category: "mcp",
				itemCount: 1,
				files: [
					{
						path: path.join(projectPath, "opencode.json"),
						status: "new",
						lineCount: content.split("\n").length,
						content,
					},
				],
			})
		}
	}

	// Agents
	if (conversion.agents.size > 0) {
		const files: MigrationFilePreview[] = []
		for (const [filePath, content] of conversion.agents) {
			files.push({
				path: filePath,
				status: "new",
				lineCount: content.split("\n").length,
				content,
			})
		}
		categoryPreviews.push({ category: "agents", itemCount: files.length, files })
	}

	// Commands
	if (conversion.commands.size > 0) {
		const files: MigrationFilePreview[] = []
		for (const [filePath, content] of conversion.commands) {
			files.push({
				path: filePath,
				status: "new",
				lineCount: content.split("\n").length,
				content,
			})
		}
		categoryPreviews.push({ category: "commands", itemCount: files.length, files })
	}

	// Rules
	if (conversion.rules.size > 0) {
		const files: MigrationFilePreview[] = []
		for (const [filePath, content] of conversion.rules) {
			files.push({
				path: filePath,
				status: "new",
				lineCount: content.split("\n").length,
				content,
			})
		}
		categoryPreviews.push({ category: "rules", itemCount: files.length, files })
	}

	// Hooks
	if (conversion.hookPlugins.size > 0) {
		const files: MigrationFilePreview[] = []
		for (const [filePath, content] of conversion.hookPlugins) {
			files.push({
				path: filePath,
				status: "new",
				lineCount: content.split("\n").length,
				content,
			})
		}
		categoryPreviews.push({ category: "hooks", itemCount: files.length, files })
	}

	const totalFiles = categoryPreviews.reduce((sum, c) => sum + c.files.length, 0)

	// Count sessions and their projects for the info card
	const sessions = conversion.sessions ?? []
	const sessionProjectPaths = new Set(sessions.map((s) => s.session.directory))

	return {
		categories: categoryPreviews,
		warnings: [...conversion.report.warnings, ...validation.warnings],
		manualActions: [...conversion.report.manualActions],
		errors: [
			...conversion.report.errors,
			...validation.errors.map((e) => `${e.path}: ${e.message}`),
		],
		fileCount: totalFiles,
		sessionCount: sessions.length,
		sessionProjectCount: sessionProjectPaths.size,
	}
}

/**
 * Executes the migration, writing files to disk with a backup.
 */
export async function executeMigration(
	scanResult: unknown,
	categories: string[],
): Promise<MigrationResult> {
	const { convert, write } = await import("@palot/cc2oc")
	const includeHistory = categories.includes("history")
	// biome-ignore lint/suspicious/noExplicitAny: cc2oc ScanResult is dynamically imported
	const conversion = await convert(scanResult as any, {
		categories: categories as Array<
			| "config"
			| "mcp"
			| "agents"
			| "commands"
			| "skills"
			| "permissions"
			| "rules"
			| "hooks"
			| "history"
		>,
		includeHistory,
	})

	const writeResult = await write(conversion, {
		backup: true,
		mergeStrategy: "preserve-existing",
	})

	return {
		success: true,
		filesWritten: writeResult.filesWritten,
		filesSkipped: writeResult.filesSkipped,
		backupDir: writeResult.backupDir ?? null,
		warnings: [...conversion.report.warnings],
		manualActions: [...conversion.report.manualActions],
		errors: [...conversion.report.errors],
	}
}

/**
 * Restores a migration backup.
 */
export async function restoreMigrationBackup(): Promise<{
	success: boolean
	restored: string[]
	removed: string[]
	errors: string[]
}> {
	const { restore } = await import("@palot/cc2oc")
	const result = await restore()
	return {
		success: result.errors.length === 0,
		restored: result.restored,
		removed: result.removed,
		errors: result.errors.map((e) => `${e.path}: ${e.error}`),
	}
}

// ============================================================
// Helpers
// ============================================================

// biome-ignore lint/suspicious/noExplicitAny: cc2oc types are dynamically imported
function countMcpServers(scanResult: any): number {
	let count = 0
	// Global MCP from user state
	if (scanResult.global.userState?.projects) {
		for (const project of Object.values(scanResult.global.userState.projects) as Array<
			Record<string, unknown>
		>) {
			if (project.mcpServers && typeof project.mcpServers === "object") {
				count += Object.keys(project.mcpServers).length
			}
		}
	}
	// Per-project MCP
	for (const project of scanResult.projects) {
		if (project.mcpJson?.mcpServers) {
			count += Object.keys(project.mcpJson.mcpServers).length
		}
	}
	return count
}

// biome-ignore lint/suspicious/noExplicitAny: cc2oc types are dynamically imported
function countAgents(scanResult: any): number {
	let count = 0
	for (const project of scanResult.projects) {
		count += project.agents?.length ?? 0
	}
	return count
}

// biome-ignore lint/suspicious/noExplicitAny: cc2oc types are dynamically imported
function countCommands(scanResult: any): number {
	let count = 0
	for (const project of scanResult.projects) {
		count += project.commands?.length ?? 0
	}
	return count
}
