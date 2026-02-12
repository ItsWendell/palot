/**
 * Dynamic system tray for Palot.
 *
 * Shows live agent statuses grouped by project, pending action counts,
 * and quick-access actions. Rebuilds the context menu whenever session
 * state changes via the notification-watcher's SSE stream.
 *
 * macOS features:
 * - Template images that adapt to menu bar appearance (light/dark/Liquid Glass)
 * - Tray title badge showing pending permission/question count
 * - Status indicators via Unicode symbols (●/◐/○)
 */
import path from "node:path"
import { app, type BrowserWindow, Menu, nativeImage, Tray } from "electron"
import {
	type DiscoveredProject,
	type DiscoveredSession,
	type DiscoveryResult,
	discover,
} from "./discovery"
import { createLogger } from "./logger"
import {
	getPendingCount,
	getSessionStates,
	onStateChanged,
	type SessionState,
} from "./notification-watcher"
import { getServerUrl } from "./opencode-manager"

const log = createLogger("tray")

// ============================================================
// Constants
// ============================================================

const IS_MAC = process.platform === "darwin"

/** Max agents shown per project before "View More" submenu kicks in. */
const MAX_AGENTS_INLINE = 3

/** How often to refresh discovery data (offline sessions). */
const DISCOVERY_REFRESH_MS = 60_000

/** Status symbols for menu labels. */
const STATUS_ICON: Record<string, string> = {
	busy: "●",
	retry: "◐",
	idle: "○",
}

// ============================================================
// State
// ============================================================

let tray: Tray | null = null
let getWindow: (() => BrowserWindow | undefined) | null = null
let unsubscribeWatcher: (() => void) | null = null
let discoveryCache: DiscoveryResult | null = null
let discoveryTimer: ReturnType<typeof setInterval> | null = null

// ============================================================
// Public API
// ============================================================

export function createTray(windowGetter: () => BrowserWindow | undefined): void {
	if (tray) return

	getWindow = windowGetter

	const resourcesPath = app.isPackaged
		? process.resourcesPath
		: path.join(__dirname, "../../resources")

	let icon: Electron.NativeImage

	if (IS_MAC) {
		const templatePath = path.join(resourcesPath, "iconTemplate.png")
		icon = nativeImage.createFromPath(templatePath)
		icon.setTemplateImage(true)
	} else {
		const iconPath = path.join(resourcesPath, "icon.png")
		icon = nativeImage.createFromPath(iconPath)
	}

	tray = new Tray(icon)
	tray.setToolTip("Palot")

	// Click to show/focus window
	tray.on("click", () => {
		showWindow()
	})

	// Subscribe to notification-watcher state changes for live updates
	unsubscribeWatcher = onStateChanged(() => {
		rebuildMenu()
	})

	// Load discovery data for offline sessions, then refresh periodically
	refreshDiscovery()
	discoveryTimer = setInterval(refreshDiscovery, DISCOVERY_REFRESH_MS)

	// Build initial menu
	rebuildMenu()

	log.info(`Tray created (template: ${IS_MAC})`)
}

export function destroyTray(): void {
	if (unsubscribeWatcher) {
		unsubscribeWatcher()
		unsubscribeWatcher = null
	}
	if (discoveryTimer) {
		clearInterval(discoveryTimer)
		discoveryTimer = null
	}
	if (tray) {
		tray.destroy()
		tray = null
	}
	getWindow = null
	discoveryCache = null
}

// ============================================================
// Menu Building
// ============================================================

function rebuildMenu(): void {
	if (!tray) return

	const liveSessions = getSessionStates()
	const pendingCount = getPendingCount()
	const template: Electron.MenuItemConstructorOptions[] = []

	// --- Pending actions banner ---
	if (pendingCount > 0) {
		template.push({
			label: `⚠ ${pendingCount} Pending ${pendingCount === 1 ? "Approval" : "Approvals"}`,
			enabled: true,
			click: () => showWindow(),
		})
		template.push({ type: "separator" })
	}

	// --- Live agents grouped by project ---
	const agentSection = buildAgentSection(liveSessions)
	if (agentSection.length > 0) {
		template.push(...agentSection)
		template.push({ type: "separator" })
	}

	// --- Recent sessions (from discovery, not currently live) ---
	const recentSection = buildRecentSection(liveSessions)
	if (recentSection.length > 0) {
		template.push(...recentSection)
		template.push({ type: "separator" })
	}

	// --- Quick actions ---
	template.push({
		label: "Show Palot",
		click: () => showWindow(),
	})

	// Server status indicator
	const serverUrl = getServerUrl()
	if (serverUrl) {
		template.push({
			label: `Server Running`,
			enabled: false,
		})
	}

	template.push({ type: "separator" })
	template.push({
		label: "Quit",
		click: () => app.quit(),
	})

	const contextMenu = Menu.buildFromTemplate(template)
	tray.setContextMenu(contextMenu)

	// macOS: show pending count next to tray icon
	updateTrayTitle(pendingCount, liveSessions)
}

// ============================================================
// Agent Section — live sessions grouped by project directory
// ============================================================

interface ProjectGroup {
	name: string
	directory: string
	agents: Array<{
		sessionId: string
		title: string
		status: string
		parentID?: string
	}>
}

function buildAgentSection(
	liveSessions: ReadonlyMap<string, SessionState>,
): Electron.MenuItemConstructorOptions[] {
	if (liveSessions.size === 0) return []

	// Group by directory, excluding sub-agents
	const groups = new Map<string, ProjectGroup>()

	for (const [sessionId, state] of liveSessions) {
		if (state.parentID) continue // Skip sub-agents
		const dir = state.directory || "Unknown"
		let group = groups.get(dir)
		if (!group) {
			group = {
				name: projectNameFromDir(dir),
				directory: dir,
				agents: [],
			}
			groups.set(dir, group)
		}
		group.agents.push({
			sessionId,
			title: state.title || "Untitled",
			status: state.status,
		})
	}

	if (groups.size === 0) return []

	// Sort groups: busiest first, then alphabetical
	const sortedGroups = Array.from(groups.values()).sort((a, b) => {
		const aBusy = a.agents.filter((a) => a.status === "busy" || a.status === "retry").length
		const bBusy = b.agents.filter((a) => a.status === "busy" || a.status === "retry").length
		if (aBusy !== bBusy) return bBusy - aBusy
		return a.name.localeCompare(b.name)
	})

	const items: Electron.MenuItemConstructorOptions[] = []

	// Header
	const totalBusy = Array.from(liveSessions.values()).filter(
		(s) => !s.parentID && (s.status === "busy" || s.status === "retry"),
	).length
	const headerLabel =
		totalBusy > 0
			? `Active Agents (${totalBusy} running)`
			: `Agents (${liveSessions.size} sessions)`
	items.push({ label: headerLabel, enabled: false })

	for (const group of sortedGroups) {
		// Sort agents: busy first, then by title
		group.agents.sort((a, b) => {
			const aActive = a.status === "busy" || a.status === "retry" ? 0 : 1
			const bActive = b.status === "busy" || b.status === "retry" ? 0 : 1
			if (aActive !== bActive) return aActive - bActive
			return a.title.localeCompare(b.title)
		})

		if (sortedGroups.length > 1) {
			// Multi-project: use submenu per project
			const busyInGroup = group.agents.filter(
				(a) => a.status === "busy" || a.status === "retry",
			).length
			const projectLabel = busyInGroup > 0 ? `${group.name}  (${busyInGroup} running)` : group.name

			items.push({
				label: projectLabel,
				submenu: buildAgentItems(group.agents),
			})
		} else {
			// Single project: inline agents directly
			items.push(...buildAgentItems(group.agents))
		}
	}

	return items
}

function buildAgentItems(agents: ProjectGroup["agents"]): Electron.MenuItemConstructorOptions[] {
	const items: Electron.MenuItemConstructorOptions[] = []
	const visible = agents.slice(0, MAX_AGENTS_INLINE)
	const overflow = agents.slice(MAX_AGENTS_INLINE)

	for (const agent of visible) {
		items.push(agentMenuItem(agent))
	}

	if (overflow.length > 0) {
		items.push({
			label: `View More (${overflow.length})`,
			submenu: overflow.map((a) => agentMenuItem(a)),
		})
	}

	return items
}

function agentMenuItem(agent: {
	sessionId: string
	title: string
	status: string
}): Electron.MenuItemConstructorOptions {
	const icon = STATUS_ICON[agent.status] ?? "○"
	// Truncate long titles for menu readability
	const maxLen = 40
	const title = agent.title.length > maxLen ? `${agent.title.slice(0, maxLen)}...` : agent.title

	return {
		label: `${icon}  ${title}`,
		click: () => navigateToSession(agent.sessionId),
	}
}

// ============================================================
// Recent Section — offline sessions from discovery
// ============================================================

function buildRecentSection(
	liveSessions: ReadonlyMap<string, SessionState>,
): Electron.MenuItemConstructorOptions[] {
	if (!discoveryCache) return []

	const { projects, sessions: sessionsByProject } = discoveryCache
	const liveIds = new Set(liveSessions.keys())

	// Collect all non-live, non-sub-agent sessions with their project info
	const recentSessions: Array<{
		session: DiscoveredSession
		project: DiscoveredProject
	}> = []

	for (const project of projects) {
		const projectSessions = sessionsByProject[project.id] ?? []
		for (const session of projectSessions) {
			if (liveIds.has(session.id)) continue
			if (session.parentID) continue
			recentSessions.push({ session, project })
		}
	}

	if (recentSessions.length === 0) return []

	// Sort by most recently updated
	recentSessions.sort((a, b) => {
		const aTime = a.session.time.updated ?? a.session.time.created
		const bTime = b.session.time.updated ?? b.session.time.created
		return bTime - aTime
	})

	const items: Electron.MenuItemConstructorOptions[] = []
	items.push({ label: "Recent Sessions", enabled: false })

	// Show top 5 recent sessions
	const topRecent = recentSessions.slice(0, 5)
	for (const { session, project } of topRecent) {
		const projectName = projectNameFromDir(session.directory || project.worktree)
		const timeAgo = formatRelativeTime(session.time.updated ?? session.time.created)
		const maxLen = 30
		const title =
			session.title.length > maxLen ? `${session.title.slice(0, maxLen)}...` : session.title

		items.push({
			label: `${title}`,
			sublabel: `${projectName} - ${timeAgo}`,
			click: () => navigateToSession(session.id),
		})
	}

	if (recentSessions.length > 5) {
		items.push({
			label: `View All (${recentSessions.length})`,
			click: () => showWindow(),
		})
	}

	return items
}

// ============================================================
// Tray Title / Icon State (macOS)
// ============================================================

function updateTrayTitle(
	pendingCount: number,
	liveSessions: ReadonlyMap<string, SessionState>,
): void {
	if (!tray) return

	if (IS_MAC) {
		// Show counts next to the tray icon
		const busyCount = Array.from(liveSessions.values()).filter(
			(s) => !s.parentID && (s.status === "busy" || s.status === "retry"),
		).length

		let title = ""
		if (pendingCount > 0) {
			title = `${pendingCount}!`
		} else if (busyCount > 0) {
			title = `${busyCount}`
		}

		tray.setTitle(title, { fontType: "monospacedDigit" })
	}

	// Update tooltip with summary
	const totalSessions = Array.from(liveSessions.values()).filter((s) => !s.parentID).length
	const busyCount = Array.from(liveSessions.values()).filter(
		(s) => !s.parentID && (s.status === "busy" || s.status === "retry"),
	).length

	let tooltip = "Palot"
	if (totalSessions > 0) {
		tooltip += ` - ${totalSessions} agent${totalSessions !== 1 ? "s" : ""}`
		if (busyCount > 0) {
			tooltip += ` (${busyCount} running)`
		}
	}
	if (pendingCount > 0) {
		tooltip += ` - ${pendingCount} pending`
	}
	tray.setToolTip(tooltip)
}

// ============================================================
// Discovery Data
// ============================================================

async function refreshDiscovery(): Promise<void> {
	try {
		discoveryCache = await discover()
		// Rebuild menu with fresh discovery data (only if not already rebuilding from SSE)
		rebuildMenu()
	} catch (err) {
		log.warn("Failed to refresh discovery data for tray", err)
	}
}

// ============================================================
// Navigation & Window Helpers
// ============================================================

function showWindow(): void {
	const win = getWindow?.()
	if (win) {
		if (win.isMinimized()) win.restore()
		win.show()
		win.focus()
	}
}

function navigateToSession(sessionId: string): void {
	const win = getWindow?.()
	if (win) {
		if (win.isMinimized()) win.restore()
		win.show()
		win.focus()
		win.webContents.send("notification:navigate", { sessionId })
	}
}

function projectNameFromDir(directory: string): string {
	return directory.split("/").pop() || "/"
}

function formatRelativeTime(timestampMs: number): string {
	const seconds = Math.max(0, Math.floor((Date.now() - timestampMs) / 1000))
	if (seconds < 60) return "now"
	const minutes = Math.floor(seconds / 60)
	if (minutes < 60) return `${minutes}m ago`
	const hours = Math.floor(minutes / 60)
	if (hours < 24) return `${hours}h ago`
	const days = Math.floor(hours / 24)
	if (days < 30) return `${days}d ago`
	const months = Math.floor(days / 30)
	return `${months}mo ago`
}
