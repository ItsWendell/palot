/**
 * Type definitions for the Electron preload bridge.
 *
 * These types are shared between the preload script and the renderer.
 * The renderer accesses these via `window.codedeck`.
 */

export interface OpenCodeServerInfo {
	url: string
	pid: number | null
	managed: boolean
}

export interface DiscoveredProject {
	id: string
	worktree: string
	vcs: string
	time: { created: number; updated?: number }
}

export interface DiscoveredSession {
	id: string
	slug?: string
	projectID: string
	directory: string
	parentID?: string
	title: string
	version?: string
	time: { created: number; updated?: number }
	summary?: { additions: number; deletions: number; files: number }
}

export interface DiscoveryResult {
	projects: DiscoveredProject[]
	sessions: Record<string, DiscoveredSession[]>
}

export interface MessageEntry {
	info: {
		id: string
		sessionID: string
		role: string
		time: { created: number; completed?: number }
		parentID?: string
		modelID?: string
		providerID?: string
		[key: string]: unknown
	}
	parts: {
		id: string
		sessionID: string
		messageID: string
		type: string
		text?: string
		tool?: string
		callID?: string
		[key: string]: unknown
	}[]
}

export interface MessagesResult {
	messages: MessageEntry[]
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

// ============================================================
// Open-in-targets types
// ============================================================

export interface OpenInTarget {
	id: string
	label: string
	available: boolean
}

export interface OpenInTargetsResult {
	targets: OpenInTarget[]
	availableTargets: string[]
	preferredTarget: string | null
}

// ============================================================
// CLI install types
// ============================================================

export interface CliInstallResult {
	success: boolean
	error?: string
}

export interface AppInfo {
	version: string
	isDev: boolean
}

export type WindowChromeTier = "liquid-glass" | "vibrancy" | "opaque"

export interface CodedeckAPI {
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
	discover: () => Promise<DiscoveryResult>
	getSessionMessages: (sessionId: string) => Promise<MessagesResult>
	getModelState: () => Promise<ModelState>
	updateModelRecent: (model: ModelRef) => Promise<ModelState>

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
}

declare global {
	interface Window {
		codedeck: CodedeckAPI
	}
}
