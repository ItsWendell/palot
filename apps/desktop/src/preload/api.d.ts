/**
 * Type definitions for the Electron preload bridge.
 *
 * These types are shared between the preload script and the renderer.
 * The renderer accesses these via `window.palot`.
 */

export interface OpenCodeServerInfo {
	url: string
	pid: number | null
	managed: boolean
}

export interface ModelRef {
	providerID: string
	modelID: string
}

export interface ModelState {
	recent: ModelRef[]
	favorite: ModelRef[]
	variant: Record<string, string | undefined>
}

export interface UpdateState {
	status: "idle" | "checking" | "available" | "downloading" | "ready" | "error"
	version?: string
	releaseNotes?: string
	progress?: {
		percent: number
		bytesPerSecond: number
		transferred: number
		total: number
	}
	error?: string
}

// ============================================================
// Git types
// ============================================================

export interface GitBranchInfo {
	current: string
	detached: boolean
	local: string[]
	remote: string[]
}

export interface GitStatusInfo {
	isClean: boolean
	staged: number
	modified: number
	untracked: number
	conflicted: number
	summary: string
}

export interface GitCheckoutResult {
	success: boolean
	error?: string
}

export interface GitStashResult {
	success: boolean
	stashed: boolean
	error?: string
}

export interface GitDiffStat {
	filesChanged: number
	insertions: number
	deletions: number
	files: { path: string; insertions: number; deletions: number }[]
}

export interface GitCommitResult {
	success: boolean
	commitHash?: string
	error?: string
}

export interface GitPushResult {
	success: boolean
	error?: string
}

export interface GitApplyResult {
	success: boolean
	filesApplied: string[]
	error?: string
}

// ============================================================
// Open-in-targets types
// ============================================================

export interface OpenInTarget {
	id: string
	label: string
	available: boolean
	/** Base64-encoded PNG icon data URL, resolved at runtime from the installed app. */
	iconDataUrl?: string
}

export interface OpenInTargetsResult {
	targets: OpenInTarget[]
	availableTargets: string[]
	preferredTarget: string | null
}

// ============================================================
// Server config types (shared between main process and renderer)
// ============================================================

/** Built-in local server, auto-managed by Palot via OpenCodeManager. */
export interface LocalServerConfig {
	id: "local"
	name: string
	type: "local"
	/** Hostname the local server binds to (default "127.0.0.1"). Use "0.0.0.0" to expose on the network. */
	hostname?: string
	/** Port the local server listens on (default 4101). */
	port?: number
	/** Whether a password is configured for the local server (stored in safeStorage). */
	hasPassword?: boolean
}

/** Remote server reachable over HTTP(S). */
export interface RemoteServerConfig {
	id: string
	name: string
	type: "remote"
	/** Full base URL, e.g. "https://opencode.example.com:4096" */
	url: string
	/** Basic Auth username (defaults to "opencode" if omitted). */
	username?: string
	/** Whether a password is stored in safeStorage (never stored in settings.json). */
	hasPassword?: boolean
}

/** SSH tunnel server (future -- type is defined now to avoid config migration later). */
export interface SshServerConfig {
	id: string
	name: string
	type: "ssh"
	sshHost: string
	sshPort?: number
	sshUser: string
	sshAuthMethod: "key" | "password" | "agent"
	sshKeyPath?: string
	/** Where OpenCode listens on the remote machine (default 127.0.0.1). */
	remoteHost?: string
	remotePort: number
	/** Basic Auth username for the OpenCode server (defaults to "opencode"). */
	username?: string
	hasPassword?: boolean
}

export type ServerConfig = LocalServerConfig | RemoteServerConfig | SshServerConfig

// ============================================================
// mDNS discovery types
// ============================================================

/** A server discovered via mDNS on the local network. */
export interface DiscoveredMdnsServer {
	/** Unique key derived from host:port. */
	id: string
	/** Service name from mDNS (e.g. "opencode-4096"). */
	name: string
	/** Resolved hostname or IP address. */
	host: string
	/** Port the OpenCode server is listening on. */
	port: number
	/** IP addresses reported by the service. */
	addresses: string[]
}

/** The default built-in local server entry (defined in server-config.ts). */
export declare const DEFAULT_LOCAL_SERVER: LocalServerConfig

export interface ServerSettings {
	/** Ordered list of configured servers. The local server is always first. */
	servers: ServerConfig[]
	/** ID of the currently active server. */
	activeServerId: string
}

// ============================================================
// Settings types (shared between main process and renderer)
// ============================================================

export type CompletionNotificationMode = "off" | "unfocused" | "always"

export interface NotificationSettings {
	completionMode: CompletionNotificationMode
	permissions: boolean
	questions: boolean
	errors: boolean
	dockBadge: boolean
}

export interface AppSettings {
	notifications: NotificationSettings
	/** Whether the user prefers opaque (solid) windows. Read at window creation time. */
	opaqueWindows: boolean
	/** Server connection configuration. */
	servers: ServerSettings
}

// ============================================================
// CLI install types
// ============================================================

export interface CliInstallResult {
	success: boolean
	error?: string
}

// ============================================================
// Onboarding types
// ============================================================

export interface OpenCodeCheckResult {
	installed: boolean
	version: string | null
	path: string | null
	compatible: boolean
	compatibility: "ok" | "too-old" | "too-new" | "blocked" | "unknown"
	message: string | null
}

/** Supported migration source providers. */
export type MigrationProvider = "claude-code" | "cursor" | "opencode"

/** Detection result for a single provider. */
export interface ProviderDetection {
	provider: MigrationProvider
	found: boolean
	label: string
	summary: string
	mcpServerCount: number
	agentCount: number
	commandCount: number
	ruleCount: number
	skillCount: number
	projectCount: number
	hasGlobalSettings: boolean
	hasPermissions: boolean
	hasHooks: boolean
	totalSessions: number
	totalMessages: number
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

export interface MigrationPreview {
	categories: MigrationCategoryPreview[]
	warnings: string[]
	manualActions: string[]
	errors: string[]
	fileCount: number
	sessionCount: number
	sessionProjectCount: number
}

export interface MigrationResult {
	success: boolean
	filesWritten: string[]
	filesSkipped: string[]
	backupDir: string | null
	warnings: string[]
	manualActions: string[]
	errors: string[]
	/** Number of history sessions that were skipped as duplicates */
	historyDuplicatesSkipped: number
}

export interface MigrationProgress {
	phase: string
	current: number
	total: number
	duplicatesSkipped: number
}

export interface AppInfo {
	version: string
	isDev: boolean
}

export type WindowChromeTier = "liquid-glass" | "vibrancy" | "opaque"

// ============================================================
// Automation types
// ============================================================

export interface AutomationSchedule {
	rrule: string
	timezone: string
}

export type PermissionPreset = "default" | "allow-all" | "read-only"

export interface ExecutionConfig {
	model?: string
	effort: "low" | "medium" | "high"
	timeout: number
	retries: number
	retryDelay: number
	parallelWorkspaces: boolean
	approvalPolicy: "never" | "auto-edit"
	/** Whether to run in an isolated git worktree (default: true) */
	useWorktree: boolean
	/** Permission preset controlling agent tool access */
	permissionPreset: PermissionPreset
}

export type AutomationStatus = "active" | "paused" | "archived"

export interface Automation {
	id: string
	name: string
	prompt: string
	status: AutomationStatus
	schedule: AutomationSchedule
	workspaces: string[]
	execution: ExecutionConfig
	nextRunAt: number | null
	lastRunAt: number | null
	runCount: number
	consecutiveFailures: number
	createdAt: number
	updatedAt: number
}

export type AutomationRunStatus =
	| "queued"
	| "running"
	| "pending_review"
	| "accepted"
	| "archived"
	| "failed"

export interface AutomationRun {
	id: string
	automationId: string
	workspace: string
	status: AutomationRunStatus
	attempt: number
	sessionId: string | null
	worktreePath: string | null
	startedAt: number | null
	completedAt: number | null
	timeoutAt: number | null
	resultTitle: string | null
	resultSummary: string | null
	resultHasActionable: boolean | null
	resultBranch: string | null
	resultPrUrl: string | null
	errorMessage: string | null
	archivedReason: string | null
	archivedAssistantMessage: string | null
	readAt: number | null
	createdAt: number
	updatedAt: number
}

export interface CreateAutomationInput {
	name: string
	prompt: string
	schedule: { rrule: string; timezone?: string }
	workspaces: string[]
	execution?: Partial<ExecutionConfig>
}

export interface UpdateAutomationInput {
	id: string
	name?: string
	prompt?: string
	status?: AutomationStatus
	schedule?: { rrule: string; timezone?: string }
	workspaces?: string[]
	execution?: Partial<ExecutionConfig>
}

export interface PalotAPI {
	/** The host platform: "darwin", "win32", or "linux". */
	platform: NodeJS.Platform
	getAppInfo: () => Promise<AppInfo>

	/** Subscribe to chrome tier notification (fired once on load). */
	onChromeTier: (callback: (tier: WindowChromeTier) => void) => () => void
	/** Get the current chrome tier (pull-based, avoids race with push event). */
	getChromeTier: () => Promise<WindowChromeTier>

	ensureOpenCode: () => Promise<OpenCodeServerInfo>
	getServerUrl: () => Promise<string | null>
	stopOpenCode: () => Promise<boolean>
	restartOpenCode: () => Promise<OpenCodeServerInfo>
	getModelState: () => Promise<ModelState>
	updateModelRecent: (model: ModelRef) => Promise<ModelState>

	// Credential storage (safeStorage-backed, passwords never leave main process in plain text)
	credential: {
		/** Store an encrypted password for a server. */
		store: (serverId: string, password: string) => Promise<void>
		/** Retrieve a decrypted password for a server (only returns to renderer for auth headers). */
		get: (serverId: string) => Promise<string | null>
		/** Delete a stored password. */
		delete: (serverId: string) => Promise<void>
	}

	/** Test connectivity to a remote OpenCode server. Returns null on success or an error message. */
	testServerConnection: (
		url: string,
		username?: string,
		password?: string,
	) => Promise<string | null>

	// mDNS discovery
	mdns: {
		/** Get the current list of discovered servers. */
		getDiscovered: () => Promise<DiscoveredMdnsServer[]>
		/** Subscribe to discovered server list changes. Returns an unsubscribe function. */
		onChanged: (callback: (servers: DiscoveredMdnsServer[]) => void) => () => void
	}

	// Auto-updater
	getUpdateState: () => Promise<UpdateState>
	checkForUpdates: () => Promise<void>
	downloadUpdate: () => Promise<void>
	installUpdate: () => Promise<void>
	onUpdateStateChanged: (callback: (state: UpdateState) => void) => () => void

	// Git operations
	git: {
		listBranches: (directory: string) => Promise<GitBranchInfo>
		getStatus: (directory: string) => Promise<GitStatusInfo>
		checkout: (directory: string, branch: string) => Promise<GitCheckoutResult>
		stashAndCheckout: (directory: string, branch: string) => Promise<GitStashResult>
		stashPop: (directory: string) => Promise<GitStashResult>
		getRoot: (directory: string) => Promise<string | null>
		diffStat: (directory: string) => Promise<GitDiffStat>
		commitAll: (directory: string, message: string) => Promise<GitCommitResult>
		push: (directory: string, remote?: string) => Promise<GitPushResult>
		createBranch: (directory: string, branchName: string) => Promise<GitCheckoutResult>
		applyToLocal: (worktreeDir: string, localDir: string) => Promise<GitApplyResult>
		applyDiffText: (localDir: string, diffText: string) => Promise<GitApplyResult>
		getRemoteUrl: (directory: string, remote?: string) => Promise<string | null>
	}

	// Window preferences (opaque windows / transparency)
	/** Get the persisted opaque windows preference from the main process. */
	getOpaqueWindows: () => Promise<boolean>
	/** Set the opaque windows preference and persist it in the main process. */
	setOpaqueWindows: (value: boolean) => Promise<{ success: boolean }>
	/** Relaunch the app (used after toggling transparency). */
	relaunch: () => Promise<void>

	// CLI install
	cli: {
		isInstalled: () => Promise<boolean>
		install: () => Promise<CliInstallResult>
		uninstall: () => Promise<CliInstallResult>
	}

	// Open in external app
	openIn: {
		getTargets: () => Promise<OpenInTargetsResult>
		open: (directory: string, targetId: string, persistPreferred?: boolean) => Promise<void>
		setPreferred: (targetId: string) => Promise<{ success: boolean }>
	}

	// Native theme (syncs macOS glass tint to app color scheme)
	/** Set the native theme source ("light" | "dark" | "system") to control macOS glass tint. */
	setNativeTheme: (source: string) => Promise<void>

	// System accent color
	/** Get the system accent color as an 8-char hex RRGGBBAA string, or null if unavailable. */
	getAccentColor: () => Promise<string | null>
	/** Subscribe to system accent color changes. Returns an unsubscribe function. */
	onAccentColorChanged: (callback: (color: string) => void) => () => void

	// Directory picker
	pickDirectory: () => Promise<string | null>

	// Fetch proxy (bypasses Chromium connection limits)
	fetch: (req: {
		url: string
		method: string
		headers: Record<string, string>
		body: string | null
	}) => Promise<{
		status: number
		statusText: string
		headers: Record<string, string>
		body: string | null
	}>

	// Notifications
	/** Subscribe to navigation events from native OS notification clicks. */
	onNotificationNavigate: (callback: (data: { sessionId: string }) => void) => () => void
	/** Dismiss any active notification for a session. */
	dismissNotification: (sessionId: string) => Promise<void>
	/** Update the dock badge / app badge count. */
	updateBadgeCount: (count: number) => Promise<void>

	// Settings
	/** Get the full app settings object. */
	getSettings: () => Promise<AppSettings>
	/** Update settings with a partial object (deep-merged). Returns the updated settings. */
	updateSettings: (partial: Record<string, unknown>) => Promise<AppSettings>
	/** Subscribe to settings changes pushed from the main process. */
	onSettingsChanged: (callback: (settings: AppSettings) => void) => () => void

	// Onboarding
	// Automations
	automation: {
		list: () => Promise<Automation[]>
		get: (id: string) => Promise<Automation | null>
		create: (input: CreateAutomationInput) => Promise<Automation>
		update: (input: UpdateAutomationInput) => Promise<Automation | null>
		delete: (id: string) => Promise<boolean>
		runNow: (id: string) => Promise<boolean>
		listRuns: (automationId?: string) => Promise<AutomationRun[]>
		archiveRun: (runId: string) => Promise<boolean>
		acceptRun: (runId: string) => Promise<boolean>
		markRunRead: (runId: string) => Promise<boolean>
		previewSchedule: (rrule: string, timezone: string) => Promise<string[]>
	}
	/** Subscribe to automation run state changes. */
	onAutomationRunsUpdated: (callback: () => void) => () => void

	onboarding: {
		checkOpenCode: () => Promise<OpenCodeCheckResult>
		installOpenCode: () => Promise<{ success: boolean; error?: string }>
		onInstallOutput: (callback: (text: string) => void) => () => void
		/** Quick-detect all supported providers (Claude Code, Cursor, OpenCode). */
		detectProviders: () => Promise<ProviderDetection[]>
		/** Full scan of a specific provider's configuration. */
		scanProvider: (
			provider: MigrationProvider,
		) => Promise<{ detection: ProviderDetection; scanResult: unknown }>
		/** Dry-run migration preview for a provider. */
		previewMigration: (
			provider: MigrationProvider,
			scanResult: unknown,
			categories: string[],
		) => Promise<MigrationPreview>
		/** Execute migration (writes files with backup). */
		executeMigration: (
			provider: MigrationProvider,
			scanResult: unknown,
			categories: string[],
		) => Promise<MigrationResult>
		/** Subscribe to migration progress updates (history writing). */
		onMigrationProgress: (callback: (progress: MigrationProgress) => void) => () => void
		/** Restore the most recent migration backup. */
		restoreBackup: () => Promise<{
			success: boolean
			restored: string[]
			removed: string[]
			errors: string[]
		}>
	}
}

declare global {
	interface Window {
		palot: PalotAPI
	}
}
