import fs from "node:fs"
import fsAsync from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

// ESM equivalent for __dirname (electron-vite serves main process as ESM in dev)
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, net, shell, systemPreferences } from "electron"
import {
	acceptRun,
	archiveRun,
	createAutomation,
	deleteAutomation,
	getAutomation,
	listAutomations,
	listRuns,
	markRunRead,
	previewSchedule,
	runNow,
	updateAutomation,
} from "./automation"
import type { CreateAutomationInput, UpdateAutomationInput } from "./automation/types"
import { installCli, isCliInstalled, uninstallCli } from "./cli-install"
import { deleteCredential, getCredential, storeCredential } from "./credential-store"
import {
	applyChangesToLocal,
	applyDiffTextToLocal,
	checkout,
	commitAll,
	createBranch,
	getDiffStat,
	getGitRoot,
	getRemoteUrl,
	getStatus,
	listBranches,
	push,
	stashAndCheckout,
	stashPop,
} from "./git-service"
import { getResolvedChromeTier } from "./liquid-glass"
import { createLogger } from "./logger"
import { getDiscoveredServers } from "./mdns-scanner"

import { readModelState, updateModelRecent } from "./model-state"
import { dismissNotification, updateBadgeCount } from "./notifications"
import type { MigrationProvider } from "./onboarding"
import {
	checkOpenCodeInstallation,
	detectProviders,
	executeMigration,
	installOpenCode,
	previewMigration,
	restoreMigrationBackup,
	scanProvider,
} from "./onboarding"
import { getOpenInTargets, openInTarget, setPreferredTarget } from "./open-in-targets"
import { ensureServer, getServerUrl, restartServer, stopServer } from "./opencode-manager"
import { createProjectDirectory } from "./project-directory-service"
import { ProjectBrainService } from "./project-brain-service"
import { KnowledgeGraphService } from "./knowledge-graph-service"
import type { KnowledgeEntry, KnowledgeQueryOptions } from "./knowledge-graph-service"
import { TaskGraphService } from "./task-graph-service"
import { routeTask, routePrompt } from "./model-routing-service"
import { SemanticIndexService } from "./semantic-index-service"
import { SupervisorStateService } from "./supervisor-state-service"
import type { SubagentOutput } from "./supervisor-state-service"
import { AgentPerformanceService } from "./agent-performance-service"
import type { AgentPerformanceInput, AgentPerformanceLedger } from "../shared/agent-performance"

// Serializes concurrent agent-performance:record writes per project path.
// Without this, two agents completing simultaneously would both read the same
// stale ledger and the second write would silently overwrite the first.
const perfWriteQueues = new Map<string, Promise<AgentPerformanceLedger>>()
import { getOpaqueWindows, getSettings, onSettingsChanged, updateSettings } from "./settings-store"
import { AgentService, parseAgentDocument } from "./agent-service"
import { KnowledgeService } from "./knowledge-service"
import { mem9Service } from "./mem9-service"
import { SkillsService } from "./skills-service"
import { SkillImporter } from "./skill-importer"
import type { BrainTask, TaskStatus } from "../shared/tasks"
import {
	checkForUpdates,
	downloadUpdate,
	getUpdateState,
	installUpdate,
	openReleasePage,
} from "./updater"

const log = createLogger("ipc")

/** Read the opaque windows preference for use at window creation time. */
export { getOpaqueWindows as getOpaqueWindowsPref } from "./settings-store"

// ============================================================
// Serialized fetch types — used to pass Request/Response over IPC
// ============================================================

interface SerializedRequest {
	url: string
	method: string
	headers: Record<string, string>
	body: string | null
}

interface SerializedResponse {
	status: number
	statusText: string
	headers: Record<string, string>
	body: string | null
}

/**
 * Generic fetch proxy handler for the renderer process.
 *
 * The renderer serializes a Request into a plain object, sends it over IPC,
 * and the main process performs the actual HTTP request using `net.fetch()`
 * (Electron's network stack, which has no connection-per-origin limits).
 * The response is serialized back to the renderer.
 *
 * This bypasses Chromium's 6-connections-per-origin HTTP/1.1 limit, which
 * causes severe queueing when many parallel requests hit the OpenCode server.
 */
async function handleFetchProxy(
	_event: Electron.IpcMainInvokeEvent,
	req: SerializedRequest,
): Promise<SerializedResponse> {
	// Restrict proxy to the OpenCode server origin — prevents SSRF from a
	// compromised renderer reaching cloud metadata endpoints or localhost services.
	const serverUrl = getServerUrl()
	if (serverUrl) {
		const allowed = new URL(serverUrl)
		const requested = new URL(req.url)
		if (requested.origin !== allowed.origin) {
			throw new Error(`Fetch proxy blocked: ${requested.origin} is not the OpenCode server`)
		}
	}
	log.info("IPC fetch proxy →", { method: req.method, url: req.url })
	const start = Date.now()
	const response = await net.fetch(req.url, {
		method: req.method,
		headers: req.headers,
		body: req.body ?? undefined,
	})

	const body = await response.text()
	const headers: Record<string, string> = {}
	response.headers.forEach((value, key) => {
		headers[key] = value
	})
	const durationMs = Date.now() - start

	log.info("IPC fetch proxy ←", {
		method: req.method,
		url: req.url,
		status: response.status,
		bodyLength: body.length,
		durationMs,
	})

	return {
		status: response.status,
		statusText: response.statusText,
		headers,
		body,
	}
}

/**
 * Wraps an IPC handler to log errors before they propagate to the renderer.
 * Without this, errors thrown in handlers are silently serialized across IPC
 * and the main process log shows nothing.
 */
function withLogging<TArgs extends unknown[], TResult>(
	channel: string,
	handler: (...args: TArgs) => TResult | Promise<TResult>,
): (...args: TArgs) => Promise<TResult> {
	return async (...args: TArgs) => {
		const start = Date.now()
		try {
			const result = await handler(...args)
			const durationMs = Date.now() - start
			if (durationMs > 500) {
				log.warn(`Handler "${channel}" slow`, { durationMs })
			}
			return result
		} catch (err) {
			log.error(`Handler "${channel}" failed`, { durationMs: Date.now() - start }, err)
			throw err
		}
	}
}

/**
 * Registers all IPC handlers that the renderer can invoke via contextBridge.
 *
 * Each handler corresponds to an endpoint that was previously served by
 * the Bun + Hono server on port 3100. Now they run in-process in Electron's
 * main process, communicating via IPC instead of HTTP.
 */
export function registerIpcHandlers(): void {
	// --- App info ---

	ipcMain.handle("app:info", () => ({
		version: app.getVersion(),
		isDev: !app.isPackaged,
	}))

	// --- OpenCode server lifecycle ---

	ipcMain.handle(
		"opencode:ensure",
		withLogging("opencode:ensure", async () => await ensureServer()),
	)

	ipcMain.handle("opencode:url", () => getServerUrl())

	ipcMain.handle(
		"opencode:stop",
		withLogging("opencode:stop", () => stopServer()),
	)

	ipcMain.handle(
		"opencode:restart",
		withLogging("opencode:restart", async () => await restartServer()),
	)

	// --- Model state ---

	ipcMain.handle(
		"model-state",
		withLogging("model-state", async () => await readModelState()),
	)

	ipcMain.handle(
		"model-state:update-recent",
		withLogging(
			"model-state:update-recent",
			async (_, model: { providerID: string; modelID: string }) => await updateModelRecent(model),
		),
	)

	// --- Auto-updater ---

	ipcMain.handle("updater:state", () => getUpdateState())

	ipcMain.handle("updater:check", async () => await checkForUpdates())

	ipcMain.handle("updater:download", async () => await downloadUpdate())

	ipcMain.handle("updater:install", async () => await installUpdate())

	ipcMain.handle("updater:open-release-page", async () => await openReleasePage())

	// --- Git operations ---

	ipcMain.handle(
		"git:branches",
		withLogging("git:branches", async (_, directory: string) => await listBranches(directory)),
	)

	ipcMain.handle(
		"git:status",
		withLogging("git:status", async (_, directory: string) => await getStatus(directory)),
	)

	ipcMain.handle(
		"git:checkout",
		withLogging(
			"git:checkout",
			async (_, directory: string, branch: string) => await checkout(directory, branch),
		),
	)

	ipcMain.handle(
		"git:stash-and-checkout",
		withLogging(
			"git:stash-and-checkout",
			async (_, directory: string, branch: string) => await stashAndCheckout(directory, branch),
		),
	)

	ipcMain.handle(
		"git:stash-pop",
		withLogging("git:stash-pop", async (_, directory: string) => await stashPop(directory)),
	)

	ipcMain.handle(
		"git:diff-stat",
		withLogging("git:diff-stat", async (_, directory: string) => await getDiffStat(directory)),
	)

	ipcMain.handle(
		"git:commit-all",
		withLogging(
			"git:commit-all",
			async (_, directory: string, message: string) => await commitAll(directory, message),
		),
	)

	ipcMain.handle(
		"git:push",
		withLogging(
			"git:push",
			async (_, directory: string, remote?: string) => await push(directory, remote),
		),
	)

	ipcMain.handle(
		"git:create-branch",
		withLogging(
			"git:create-branch",
			async (_, directory: string, branchName: string) => await createBranch(directory, branchName),
		),
	)

	ipcMain.handle(
		"git:apply-to-local",
		withLogging(
			"git:apply-to-local",
			async (_, worktreeDir: string, localDir: string) =>
				await applyChangesToLocal(worktreeDir, localDir),
		),
	)

	ipcMain.handle(
		"git:apply-diff-text",
		withLogging(
			"git:apply-diff-text",
			async (_, localDir: string, diffText: string) =>
				await applyDiffTextToLocal(localDir, diffText),
		),
	)

	ipcMain.handle(
		"git:root",
		withLogging("git:root", async (_, directory: string) => await getGitRoot(directory)),
	)

	ipcMain.handle(
		"git:remote-url",
		withLogging(
			"git:remote-url",
			async (_, directory: string, remote?: string) => await getRemoteUrl(directory, remote),
		),
	)

	// --- Directory picker ---

	ipcMain.handle(
		"dialog:open-directory",
		withLogging("dialog:open-directory", async () => {
			const result = await dialog.showOpenDialog({
				properties: ["openDirectory"],
				title: "Select a project folder",
			})
			if (result.canceled || result.filePaths.length === 0) return null
			return result.filePaths[0]
		}),
	)

	// --- Create project directory ---

	ipcMain.handle(
		"dialog:create-directory",
		withLogging("dialog:create-directory", async (_, name: string) => {
			const result = await dialog.showOpenDialog({
				properties: ["openDirectory", "createDirectory"],
				title: "Choose where to create your project",
				buttonLabel: "Select Location",
			})
			if (result.canceled || result.filePaths.length === 0) return null
			return createProjectDirectory(result.filePaths[0], name)
		}),
	)

	// --- Reveal path in system file manager ---

	ipcMain.handle("shell:show-in-finder", (_, filePath: string) => {
		shell.showItemInFolder(filePath)
	})

	// --- Fetch proxy (bypasses Chromium connection limits) ---

	ipcMain.handle("fetch:request", withLogging("fetch:request", handleFetchProxy))

	// --- CLI install ---

	ipcMain.handle("cli:is-installed", () => isCliInstalled())

	ipcMain.handle("cli:install", () => installCli())

	ipcMain.handle("cli:uninstall", () => uninstallCli())

	// --- Open in external app ---

	ipcMain.handle("open-in:targets", () => getOpenInTargets())

	ipcMain.handle(
		"open-in:open",
		withLogging(
			"open-in:open",
			async (_, directory: string, targetId: string, persistPreferred?: boolean) =>
				await openInTarget(directory, targetId, { persistPreferred }),
		),
	)

	ipcMain.handle("open-in:set-preferred", (_, targetId: string) => {
		setPreferredTarget(targetId)
		return { success: true }
	})

	// --- Chrome tier (pull-based, avoids race with push-based "chrome-tier" event) ---

	ipcMain.handle("chrome-tier:get", () => getResolvedChromeTier())

	// --- Window preferences (opaque windows) ---

	ipcMain.handle("prefs:get-opaque-windows", () => {
		return getOpaqueWindows()
	})

	ipcMain.handle("prefs:set-opaque-windows", (_, value: boolean) => {
		updateSettings({ opaqueWindows: value })
		return { success: true }
	})

	ipcMain.handle("app:relaunch", () => {
		app.relaunch()
		app.exit(0)
	})

	// --- Notifications ---

	ipcMain.handle("notification:dismiss", (_, sessionId: string) => {
		dismissNotification(sessionId)
	})

	ipcMain.handle("notification:badge", (_, count: number) => {
		updateBadgeCount(count)
	})

	// --- Settings ---

	ipcMain.handle("settings:get", () => getSettings())

	ipcMain.handle("settings:update", (_, partial) => updateSettings(partial))

	// --- Credential storage (safeStorage-backed) ---

	ipcMain.handle(
		"credential:store",
		withLogging("credential:store", (_, serverId: string, password: string) => {
			storeCredential(serverId, password)
		}),
	)

	ipcMain.handle("credential:get", (_, serverId: string) => getCredential(serverId))

	ipcMain.handle(
		"credential:delete",
		withLogging("credential:delete", (_, serverId: string) => {
			deleteCredential(serverId)
		}),
	)

	// --- mDNS discovery ---

	ipcMain.handle("mdns:get-discovered", () => getDiscoveredServers())

	// --- Remote server connectivity test ---

	ipcMain.handle(
		"server:test-connection",
		withLogging(
			"server:test-connection",
			async (_, url: string, username?: string, password?: string) => {
				try {
					const headers: Record<string, string> = {}
					if (password) {
						const user = username || "opencode"
						headers.Authorization = `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`
					}
					const res = await net.fetch(`${url}/session`, {
						method: "GET",
						headers,
						signal: AbortSignal.timeout(5000),
					})
					if (res.ok) return null
					if (res.status === 401) return "Authentication failed. Check username and password."
					return `Server responded with HTTP ${res.status} ${res.statusText}`
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err)
					if (msg.includes("ECONNREFUSED")) return "Connection refused. Is the server running?"
					if (msg.includes("ENOTFOUND")) return "Host not found. Check the URL."
					if (msg.includes("ETIMEDOUT") || msg.includes("timeout")) return "Connection timed out."
					if (msg.includes("CERT")) return `TLS/certificate error: ${msg}`
					return `Connection failed: ${msg}`
				}
			},
		),
	)

	// --- Native theme (controls macOS glass tint color) ---

	ipcMain.handle("theme:set-native", (_, source: string) => {
		if (source === "light" || source === "dark") {
			nativeTheme.themeSource = source
		} else {
			nativeTheme.themeSource = "system"
		}
	})

	// --- System accent color (macOS / Windows) ---

	ipcMain.handle("theme:accent-color", () => {
		try {
			return systemPreferences.getAccentColor()
		} catch {
			return null
		}
	})

	// Broadcast accent color changes to all renderer windows
	systemPreferences.on("accent-color-changed", (_event, newColor) => {
		for (const win of BrowserWindow.getAllWindows()) {
			win.webContents.send("theme:accent-color-changed", newColor)
		}
	})

	// --- Onboarding ---

	ipcMain.handle(
		"onboarding:check-opencode",
		withLogging("onboarding:check-opencode", async () => await checkOpenCodeInstallation()),
	)

	ipcMain.handle(
		"onboarding:install-opencode",
		withLogging("onboarding:install-opencode", async () => await installOpenCode()),
	)

	ipcMain.handle(
		"onboarding:detect-providers",
		withLogging("onboarding:detect-providers", async () => await detectProviders()),
	)

	ipcMain.handle(
		"onboarding:scan-provider",
		withLogging(
			"onboarding:scan-provider",
			async (_, provider: MigrationProvider) => await scanProvider(provider),
		),
	)

	ipcMain.handle(
		"onboarding:preview-migration",
		withLogging(
			"onboarding:preview-migration",
			async (_, provider: MigrationProvider, scanResult: unknown, categories: string[]) =>
				await previewMigration(provider, scanResult, categories),
		),
	)

	ipcMain.handle(
		"onboarding:execute-migration",
		withLogging(
			"onboarding:execute-migration",
			async (_, provider: MigrationProvider, scanResult: unknown, categories: string[]) =>
				await executeMigration(provider, scanResult, categories),
		),
	)

	ipcMain.handle(
		"onboarding:restore-backup",
		withLogging("onboarding:restore-backup", async () => await restoreMigrationBackup()),
	)

	// --- Automations ---

	ipcMain.handle(
		"automation:list",
		withLogging("automation:list", () => listAutomations()),
	)

	ipcMain.handle(
		"automation:get",
		withLogging("automation:get", (_, id: string) => getAutomation(id)),
	)

	ipcMain.handle(
		"automation:create",
		withLogging("automation:create", async (_, input: CreateAutomationInput) => {
			const result = await createAutomation(input)
			for (const win of BrowserWindow.getAllWindows()) {
				win.webContents.send("automation:runs-updated")
			}
			return result
		}),
	)

	ipcMain.handle(
		"automation:update",
		withLogging("automation:update", async (_, input: UpdateAutomationInput) => {
			const result = await updateAutomation(input)
			for (const win of BrowserWindow.getAllWindows()) {
				win.webContents.send("automation:runs-updated")
			}
			return result
		}),
	)

	ipcMain.handle(
		"automation:delete",
		withLogging("automation:delete", async (_, id: string) => {
			const result = await deleteAutomation(id)
			for (const win of BrowserWindow.getAllWindows()) {
				win.webContents.send("automation:runs-updated")
			}
			return result
		}),
	)

	ipcMain.handle(
		"automation:run-now",
		withLogging("automation:run-now", async (_, id: string) => {
			// runNow is fire-and-forget: it returns immediately after validating
			// the automation exists. Execution happens in the background, and
			// broadcastRunsUpdated() is called from within executeAutomation.
			return runNow(id)
		}),
	)

	ipcMain.handle(
		"automation:list-runs",
		withLogging("automation:list-runs", (_, automationId?: string) => listRuns(automationId)),
	)

	ipcMain.handle(
		"automation:archive-run",
		withLogging("automation:archive-run", async (_, runId: string) => {
			const result = await archiveRun(runId)
			for (const win of BrowserWindow.getAllWindows()) {
				win.webContents.send("automation:runs-updated")
			}
			return result
		}),
	)

	ipcMain.handle(
		"automation:accept-run",
		withLogging("automation:accept-run", async (_, runId: string) => {
			const result = await acceptRun(runId)
			for (const win of BrowserWindow.getAllWindows()) {
				win.webContents.send("automation:runs-updated")
			}
			return result
		}),
	)

	ipcMain.handle(
		"automation:mark-run-read",
		withLogging("automation:mark-run-read", async (_, runId: string) => {
			const result = await markRunRead(runId)
			for (const win of BrowserWindow.getAllWindows()) {
				win.webContents.send("automation:runs-updated")
			}
			return result
		}),
	)

	ipcMain.handle(
		"automation:preview-schedule",
		withLogging("automation:preview-schedule", (_, rrule: string, timezone: string) =>
			previewSchedule(rrule, timezone),
		),
	)

	// --- Skills ---

	const skillsService = SkillsService.fromHomeDirectory(app.getPath("home"))
	const skillImporter = new SkillImporter({ auditLogPath: skillsService.auditLogPath() })
	// Global brain for backward-compat summary; per-project handlers use fromRepoRoot()
	const globalBrainService = new ProjectBrainService(path.join(app.getPath("userData"), "brain"))
	const taskGraphService = new TaskGraphService(globalBrainService)

	function getBrainService(projectPath?: string): ProjectBrainService {
		if (projectPath) return ProjectBrainService.fromRepoRoot(projectPath)
		// Walk up from the app root looking for .palot/brain/
		const fallback = app.getAppPath()
		if (fs.existsSync(path.join(fallback, ".palot", "brain"))) {
			return ProjectBrainService.fromRepoRoot(fallback)
		}
		const parent = path.resolve(fallback, "..")
		if (fs.existsSync(path.join(parent, ".palot", "brain"))) {
			return ProjectBrainService.fromRepoRoot(parent)
		}
		return globalBrainService
	}

	ipcMain.handle("skills:list", withLogging("skills:list", () => skillsService.list()))

	ipcMain.handle("skills:list-all", withLogging("skills:list-all", async () => {
		const userSkills = await skillsService.listWithOrigin("user")
		const externalSkills = await SkillsService.scanExternalRepositories(
			path.join(app.getPath("home"), ".opencode", "skills"),
		)
		return [...userSkills, ...externalSkills]
	}))

	ipcMain.handle("skills:import-github", withLogging("skills:import-github", (_, url: string) => {
		return skillImporter.importFromGitHub(url)
	}))

	ipcMain.handle("skills:write", withLogging("skills:write", (_, filename: string, raw: string) => {
		return skillsService.write(filename, raw)
	}))

	ipcMain.handle("skills:delete", withLogging("skills:delete", (_, filename: string) => {
		return skillsService.delete(filename)
	}))

	ipcMain.handle("skills:brain-summary", withLogging("skills:brain-summary", () => globalBrainService.buildSummary()))

	// --- Agents ---

	// Load agents bundled with the app. Returns an empty array if the directory
	// doesn't exist yet (e.g. first run before generation).
	async function loadBuiltinAgents() {
		const dir = path.join(__dirname, "builtin-agents")
		const exists = await fsAsync.access(dir).then(() => true, () => false)
		if (!exists) return []
		const files = (await fsAsync.readdir(dir)).filter((f) => f.endsWith(".md")).sort()
		return Promise.all(
			files.map(async (file) => {
				const raw = await fsAsync.readFile(path.join(dir, file), "utf-8")
				return { ...parseAgentDocument(raw, file), origin: "builtin" as const }
			}),
		)
	}

	// Read agents from a project's .opencode/agents/ directory.
	// Falls back to the app root (monorepo root in dev, package root in prod) when
	// no projectPath is provided.
	function getAgentService(projectPath?: string): AgentService {
		if (projectPath) return AgentService.fromProjectDirectory(projectPath)
		// In development, the app root may be the desktop package dir;
		// walk up until we find .opencode/agents/
		const fallback = app.getAppPath()
		if (fs.existsSync(path.join(fallback, ".opencode", "agents"))) {
			return AgentService.fromProjectDirectory(fallback)
		}
		// Try parent directory (monorepo root)
		const parent = path.resolve(fallback, "..")
		if (fs.existsSync(path.join(parent, ".opencode", "agents"))) {
			return AgentService.fromProjectDirectory(parent)
		}
		// Last resort: app root (create the dir if missing)
		return AgentService.fromProjectDirectory(fallback)
	}

	ipcMain.handle("agents:list", withLogging("agents:list", async (_, projectPath?: string) => {
		const builtins = await loadBuiltinAgents()
		const userAgents = await getAgentService(projectPath).list()
		const userFilenames = new Set(userAgents.map((a) => a.filename))
		const filteredBuiltins = builtins.filter((b) => !userFilenames.has(b.filename))
		return [...userAgents, ...filteredBuiltins]
	}))
	ipcMain.handle("agents:get", withLogging("agents:get", (_, filename: string, projectPath?: string) =>
		getAgentService(projectPath).get(filename),
	))
	ipcMain.handle("agents:write", withLogging("agents:write", (_, filename: string, raw: string, projectPath?: string) =>
		getAgentService(projectPath).write(filename, raw),
	))
	ipcMain.handle("agents:delete", withLogging("agents:delete", (_, filename: string, projectPath?: string) =>
		getAgentService(projectPath).delete(filename),
	))

	// --- Knowledge Sources (agent reference docs) ---

	// Resolve the knowledge directory. When a projectPath is given, use
	// the project-local .agents/knowledge/ directory. Otherwise walk up
	// from the app root looking for .agents/knowledge/, with a final
	// fallback to ~/.config/palot/knowledge/.
	function getKnowledgeService(projectPath?: string): KnowledgeService {
		if (projectPath) return KnowledgeService.fromProjectRoot(projectPath)
		const fallback = app.getAppPath()
		if (fs.existsSync(path.join(fallback, ".agents", "knowledge"))) {
			return KnowledgeService.fromProjectRoot(fallback)
		}
		const parent = path.resolve(fallback, "..")
		if (fs.existsSync(path.join(parent, ".agents", "knowledge"))) {
			return KnowledgeService.fromProjectRoot(parent)
		}
		return KnowledgeService.fromHomeDirectory(app.getPath("home"))
	}

	ipcMain.handle("knowledge-src:list", withLogging("knowledge-src:list", (_, projectPath?: string) =>
		getKnowledgeService(projectPath).list(),
	))
	ipcMain.handle("knowledge-src:get", withLogging("knowledge-src:get", (_, filename: string, projectPath?: string) =>
		getKnowledgeService(projectPath).get(filename),
	))

	// --- Brain ---

	ipcMain.handle("brain:list", withLogging("brain:list", (_, projectPath?: string) =>
		getBrainService(projectPath).listFiles(),
	))

	ipcMain.handle("brain:read", withLogging("brain:read", (_, slug: string, projectPath?: string) =>
		getBrainService(projectPath).readFile(slug),
	))

	ipcMain.handle("brain:write", withLogging("brain:write", (_, slug: string, content: string, projectPath?: string) =>
		getBrainService(projectPath).writeFile(slug, content),
	))

	ipcMain.handle("brain:append", withLogging("brain:append", (_, slug: string, content: string, projectPath?: string) =>
		getBrainService(projectPath).appendFile(slug, content),
	))

	ipcMain.handle("brain:record-event", withLogging("brain:record-event", (_, slug: string, title: string, body: string, projectPath?: string) =>
		getBrainService(projectPath).recordEvent(slug, title, body),
	))

	ipcMain.handle("brain:delete", withLogging("brain:delete", (_, slug: string, projectPath?: string) =>
		getBrainService(projectPath).deleteFile(slug),
	))

	ipcMain.handle("brain:search", withLogging("brain:search", (_, keyword: string, projectPath?: string) =>
		getBrainService(projectPath).searchFiles(keyword),
	))

	ipcMain.handle("brain:context-summary", withLogging("brain:context-summary", (_, projectPath: string, sessionId?: string) =>
		getBrainService(projectPath).buildContextSummary(sessionId),
	))

	// --- Mem9 (persistent memory) ---

	ipcMain.handle("mem9:init", withLogging("mem9:init", (_, config?: { apiKey?: string; baseUrl?: string; agentId?: string }) => {
		return mem9Service.init(config)
	}))

	ipcMain.handle("mem9:status", withLogging("mem9:status", () => {
		return { initialized: mem9Service.initialized, configured: mem9Service.configured }
	}))

	ipcMain.handle("mem9:store", withLogging("mem9:store", async (_, input: {
		content: string
		source?: string
		tags?: string[]
		metadata?: Record<string, unknown>
	}) => {
		return mem9Service.store(input)
	}))

	ipcMain.handle("mem9:search", withLogging("mem9:search", async (_, params: {
		q?: string
		tags?: string
		source?: string
		limit?: number
		offset?: number
	}) => {
		return mem9Service.search(params)
	}))

	ipcMain.handle("mem9:get", withLogging("mem9:get", async (_, id: string) => {
		return mem9Service.get(id)
	}))

	ipcMain.handle("mem9:delete", withLogging("mem9:delete", async (_, id: string) => {
		return mem9Service.remove(id)
	}))

	ipcMain.handle("mem9:recall", withLogging("mem9:recall", async (_, query: string, limit?: number) => {
		return mem9Service.recall(query, limit)
	}))

	ipcMain.handle("mem9:embed-knowledge", withLogging("mem9:embed-knowledge", async (_, projectPath: string) => {
		return mem9Service.embedKnowledgeFiles(projectPath)
	}))

	ipcMain.handle("mem9:embed-brain", withLogging("mem9:embed-brain", async (_, projectPath: string) => {
		return mem9Service.embedBrainFiles(projectPath)
	}))

	ipcMain.handle("mem9:embed-all", withLogging("mem9:embed-all", async (_, projectPath: string) => {
		return mem9Service.embedAllProjectFiles(projectPath)
	}))

	// --- Tasks ---

	ipcMain.handle("tasks:load", withLogging("tasks:load", () => taskGraphService.load()))

	ipcMain.handle("tasks:upsert", withLogging("tasks:upsert", (_, task: BrainTask) => taskGraphService.upsertTask(task)))

	ipcMain.handle("tasks:update-status", withLogging("tasks:update-status", (_, taskId: string, status: TaskStatus) => taskGraphService.updateStatus(taskId, status)))

	ipcMain.handle("tasks:execution-plan", withLogging("tasks:execution-plan", (_, tasks: BrainTask[]) => taskGraphService.buildExecutionPlan(tasks)))

	ipcMain.handle("tasks:route-model", withLogging("tasks:route-model", (_, taskOrText: BrainTask | string) => {
		if (typeof taskOrText === "string") return routePrompt(taskOrText)
		return routeTask(taskOrText)
	}))

	// --- Supervisor State ---

	ipcMain.handle("supervisor:load", withLogging("supervisor:load", (_, projectPath: string) => {
		return new SupervisorStateService(getBrainService(projectPath)).load()
	}))

	ipcMain.handle("supervisor:save", withLogging("supervisor:save", (_, projectPath: string, state: unknown) => {
		return new SupervisorStateService(getBrainService(projectPath)).save(state as Parameters<SupervisorStateService["save"]>[0])
	}))

	ipcMain.handle("supervisor:append-output", withLogging("supervisor:append-output", (_, projectPath: string, output: SubagentOutput) => {
		return new SupervisorStateService(getBrainService(projectPath)).appendSubagentOutput(output)
	}))

	ipcMain.handle("supervisor:set-milestone", withLogging("supervisor:set-milestone", (_, projectPath: string, milestone: string) => {
		return new SupervisorStateService(getBrainService(projectPath)).setMilestone(milestone)
	}))

	ipcMain.handle("supervisor:mark-task-active", withLogging("supervisor:mark-task-active", (_, projectPath: string, taskId: string) => {
		return new SupervisorStateService(getBrainService(projectPath)).markTaskActive(taskId)
	}))

	// --- Agent Performance ---

	ipcMain.handle("agent-performance:list", withLogging("agent-performance:list", (_, projectPath?: string) => {
		return new AgentPerformanceService(getBrainService(projectPath)).load()
	}))

	ipcMain.handle("agent-performance:record", withLogging("agent-performance:record", (_, projectPath: string, input: AgentPerformanceInput) => {
		const prev = perfWriteQueues.get(projectPath) ?? Promise.resolve({} as AgentPerformanceLedger)
		const next = prev.then(() => new AgentPerformanceService(getBrainService(projectPath)).record(input))
		perfWriteQueues.set(projectPath, next.catch(() => ({}) as unknown as AgentPerformanceLedger))
		return next
	}))

	// --- Knowledge graph ---

	function getKg(projectPath?: string) {
		return new KnowledgeGraphService(getBrainService(projectPath))
	}

	// --- Knowledge Graph (structured entries) ---

	ipcMain.handle("knowledge:add", withLogging("knowledge:add", (_, projectPath: string, entry: Omit<KnowledgeEntry, "id" | "createdAt" | "updatedAt">) => {
		return getKg(projectPath).add(entry)
	}))

	ipcMain.handle("knowledge:query", withLogging("knowledge:query", (_, projectPath: string, options: KnowledgeQueryOptions) => {
		return getKg(projectPath).query(options)
	}))

	ipcMain.handle("knowledge:remove", withLogging("knowledge:remove", (_, projectPath: string, id: string) => {
		return getKg(projectPath).remove(id)
	}))

	ipcMain.handle("knowledge:context", withLogging("knowledge:context", (_, projectPath: string, forPrompt?: string) => {
		return getKg(projectPath).getContext(forPrompt)
	}))

	// --- Semantic index ---

	ipcMain.handle("semantic:build", withLogging("semantic:build", (_, projectPath: string) => {
		return new SemanticIndexService(getBrainService(projectPath)).build(projectPath)
	}))

	ipcMain.handle("semantic:search", withLogging("semantic:search", (_, projectPath: string, query: string, limit?: number) => {
		return new SemanticIndexService(getBrainService(projectPath)).search(query, limit)
	}))

	// --- Settings push channel (main -> renderer) ---
	// Notify all renderer windows when settings change so they can update reactively.

	onSettingsChanged((settings) => {
		for (const win of BrowserWindow.getAllWindows()) {
			win.webContents.send("settings:changed", settings)
		}
	})
}
