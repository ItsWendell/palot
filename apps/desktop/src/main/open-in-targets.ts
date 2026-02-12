/**
 * Detects installed editors, terminals, and file managers on the system
 * and provides the ability to open a directory in any of them.
 *
 * Currently supports macOS only; other platforms return an empty list.
 */

import { execFileSync, spawn } from "node:child_process"
import { existsSync, readdirSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { createLogger } from "./logger"

const log = createLogger("open-in-targets")

// ============================================================
// Types
// ============================================================

export interface OpenInTarget {
	id: string
	label: string
	/** Whether this target is detected as installed on the system. */
	available: boolean
}

export interface OpenInTargetsResult {
	targets: OpenInTarget[]
	availableTargets: string[]
	preferredTarget: string | null
}

// ============================================================
// Target definitions
// ============================================================

interface TargetDef {
	id: string
	label: string
	/** Returns the path to the binary if found, or null. */
	detect: () => string | null
	/** Returns the arguments to pass to the binary to open a directory. */
	args: (dir: string) => string[]
}

/**
 * Check if any of the given paths exist. Also checks ~/Applications/ variants.
 */
function findPath(paths: string[]): string | null {
	if (process.platform !== "darwin") return null
	const home = homedir()
	for (const p of paths) {
		const variants = [p, p.replace("/Applications/", `${home}/Applications/`)]
		for (const v of variants) {
			if (existsSync(v)) return v
		}
	}
	return null
}

/**
 * Check if a binary exists on PATH using `which`.
 */
function whichSync(binary: string): string | null {
	try {
		return execFileSync("which", [binary], {
			encoding: "utf-8",
			timeout: 3000,
			stdio: ["ignore", "pipe", "ignore"],
		}).trim()
	} catch {
		return null
	}
}

/**
 * Detect a VS Code-like editor by checking the standard install path
 * and looking for the CLI binary inside the .app bundle.
 */
function detectVSCodeLike(appPath: string, cliBinaryName: string): string | null {
	const appDir = findPath([appPath])
	if (!appDir) return null
	const cli = join(appDir, "Contents", "Resources", "app", "bin", cliBinaryName)
	return existsSync(cli) ? cli : null
}

/**
 * Detect a macOS .app by name in common locations.
 */
function detectApp(appName: string): string | null {
	const paths = [
		`/Applications/${appName}.app`,
		`/System/Applications/${appName}.app`,
		`/System/Applications/Utilities/${appName}.app`,
	]
	return findPath(paths)
}

/**
 * Scan JetBrains Toolbox for installed IDEs.
 */
let jetbrainsCache: Map<string, string> | null = null
function scanJetBrainsToolbox(): Map<string, string> {
	if (jetbrainsCache) return jetbrainsCache
	const toolboxDir = join(
		homedir(),
		"Library",
		"Application Support",
		"JetBrains",
		"Toolbox",
		"apps",
	)
	const result = new Map<string, string>()
	if (!existsSync(toolboxDir)) {
		jetbrainsCache = result
		return result
	}
	try {
		for (const app of readdirSync(toolboxDir)) {
			const appDir = join(toolboxDir, app)
			if (!statSync(appDir).isDirectory()) continue
			// Look for the latest channel/version with a launcher script
			const channelDir = join(appDir, "ch-0")
			if (!existsSync(channelDir)) continue
			try {
				const versions = readdirSync(channelDir)
					.filter((v) => !v.startsWith("."))
					.sort()
					.reverse()
				for (const ver of versions) {
					const binDir = join(channelDir, ver, `${app}.app`, "Contents", "MacOS", app)
					if (existsSync(binDir)) {
						result.set(app.toLowerCase(), binDir)
						break
					}
				}
			} catch {
				// skip
			}
		}
	} catch {
		// skip
	}
	jetbrainsCache = result
	return result
}

/**
 * Detect a JetBrains IDE. Checks direct install + Toolbox.
 */
function detectJetBrains(
	_appName: string,
	toolboxId: string,
	directPaths: string[],
): string | null {
	// Direct app install
	const appDir = findPath(directPaths)
	if (appDir) {
		const macosDir = join(appDir, "Contents", "MacOS")
		if (existsSync(macosDir)) {
			try {
				const entries = readdirSync(macosDir).filter((e) => !e.startsWith("."))
				if (entries.length > 0) return join(macosDir, entries[0])
			} catch {
				// fall through
			}
		}
	}
	// Toolbox
	const toolbox = scanJetBrainsToolbox()
	return toolbox.get(toolboxId) ?? null
}

const TARGETS: TargetDef[] = [
	// --- Editors ---
	{
		id: "vscode",
		label: "VS Code",
		detect: () => detectVSCodeLike("/Applications/Visual Studio Code.app", "code"),
		args: (dir) => ["--goto", dir],
	},
	{
		id: "vscodeInsiders",
		label: "VS Code Insiders",
		detect: () =>
			detectVSCodeLike("/Applications/Visual Studio Code - Insiders.app", "code-insiders"),
		args: (dir) => ["--goto", dir],
	},
	{
		id: "cursor",
		label: "Cursor",
		detect: () => detectVSCodeLike("/Applications/Cursor.app", "cursor"),
		args: (dir) => ["--goto", dir],
	},
	{
		id: "windsurf",
		label: "Windsurf",
		detect: () => detectVSCodeLike("/Applications/Windsurf.app", "windsurf"),
		args: (dir) => ["--goto", dir],
	},
	{
		id: "zed",
		label: "Zed",
		detect: () => whichSync("zed") ?? (findPath(["/Applications/Zed.app"]) ? "zed" : null),
		args: (dir) => [dir],
	},

	// --- File manager ---
	{
		id: "finder",
		label: "Finder",
		detect: () => (process.platform === "darwin" ? "open" : null),
		args: (dir) => ["-R", dir],
	},

	// --- Terminals ---
	{
		id: "terminal",
		label: "Terminal",
		detect: () => detectApp("Terminal") ?? null,
		args: (dir) => ["-a", "Terminal", dir],
	},
	{
		id: "iterm2",
		label: "iTerm2",
		detect: () => findPath(["/Applications/iTerm.app", "/Applications/iTerm2.app"]),
		args: (dir) => ["-a", "iTerm", dir],
	},
	{
		id: "ghostty",
		label: "Ghostty",
		detect: () => findPath(["/Applications/Ghostty.app"]),
		args: (dir) => ["-a", "Ghostty", dir],
	},
	{
		id: "warp",
		label: "Warp",
		detect: () => findPath(["/Applications/Warp.app"]),
		args: (dir) => ["-a", "Warp", dir],
	},

	// --- JetBrains ---
	{
		id: "webstorm",
		label: "WebStorm",
		detect: () => detectJetBrains("WebStorm", "webstorm", ["/Applications/WebStorm.app"]),
		args: (dir) => [dir],
	},
	{
		id: "intellij",
		label: "IntelliJ IDEA",
		detect: () =>
			detectJetBrains("IntelliJ IDEA", "intellij-idea-ultimate", [
				"/Applications/IntelliJ IDEA.app",
				"/Applications/IntelliJ IDEA CE.app",
			]),
		args: (dir) => [dir],
	},
	{
		id: "pycharm",
		label: "PyCharm",
		detect: () =>
			detectJetBrains("PyCharm", "pycharm", [
				"/Applications/PyCharm.app",
				"/Applications/PyCharm CE.app",
			]),
		args: (dir) => [dir],
	},
	{
		id: "goland",
		label: "GoLand",
		detect: () => detectJetBrains("GoLand", "goland", ["/Applications/GoLand.app"]),
		args: (dir) => [dir],
	},
	{
		id: "rustrover",
		label: "RustRover",
		detect: () => detectJetBrains("RustRover", "rustrover", ["/Applications/RustRover.app"]),
		args: (dir) => [dir],
	},

	// --- Other editors ---
	{
		id: "xcode",
		label: "Xcode",
		detect: () => {
			try {
				execFileSync("xcode-select", ["-p"], {
					timeout: 3000,
					stdio: ["ignore", "pipe", "ignore"],
				})
				return whichSync("xed")
			} catch {
				return null
			}
		},
		args: (dir) => [dir],
	},
]

// ============================================================
// Detection cache — cleared after 60 seconds
// ============================================================

let detectionCache: { ids: string[]; map: Map<string, string>; ts: number } | null = null
const CACHE_TTL = 60_000

function detectAvailable(): { ids: string[]; map: Map<string, string> } {
	if (detectionCache && Date.now() - detectionCache.ts < CACHE_TTL) {
		return { ids: detectionCache.ids, map: detectionCache.map }
	}

	const ids: string[] = []
	const map = new Map<string, string>()

	for (const target of TARGETS) {
		try {
			const binary = target.detect()
			if (binary) {
				ids.push(target.id)
				map.set(target.id, binary)
			}
		} catch (err) {
			log.error(`Failed to detect target "${target.id}"`, err)
		}
	}

	detectionCache = { ids, map, ts: Date.now() }
	return { ids, map }
}

// ============================================================
// Preference persistence (in-memory for now; survives app lifetime)
// ============================================================

let preferredTargetId: string | null = null

// ============================================================
// Public API
// ============================================================

/**
 * Returns all known targets, which are available, and the user's preferred target.
 */
export function getOpenInTargets(): OpenInTargetsResult {
	if (process.platform !== "darwin") {
		return { targets: [], availableTargets: [], preferredTarget: null }
	}

	const { ids } = detectAvailable()
	const availableSet = new Set(ids)

	// Resolve preferred: stored preference if still available, else first available
	const preferred =
		preferredTargetId && availableSet.has(preferredTargetId) ? preferredTargetId : (ids[0] ?? null)

	const targets: OpenInTarget[] = TARGETS.map((t) => ({
		id: t.id,
		label: t.label,
		available: availableSet.has(t.id),
	}))

	return {
		targets,
		availableTargets: ids,
		preferredTarget: preferred,
	}
}

/**
 * Opens a directory in the specified target app.
 */
export async function openInTarget(
	directory: string,
	targetId: string,
	options?: { persistPreferred?: boolean },
): Promise<{ success: boolean }> {
	if (process.platform !== "darwin") {
		throw new Error("Open-in targets are only supported on macOS")
	}

	const target = TARGETS.find((t) => t.id === targetId)
	if (!target) throw new Error(`Unknown open target: "${targetId}"`)

	const { map } = detectAvailable()
	const binary = map.get(targetId)
	if (!binary) throw new Error(`Target "${targetId}" is not available`)

	// Persist preference
	if (options?.persistPreferred) {
		preferredTargetId = targetId
	}

	// For terminal and file manager targets, use `open` command
	const isTerminalOrFinder = ["finder", "terminal", "iterm2", "ghostty", "warp"].includes(targetId)

	if (isTerminalOrFinder) {
		await spawnAsync("open", target.args(directory))
	} else {
		await spawnAsync(binary, target.args(directory))
	}

	return { success: true }
}

/**
 * Sets the preferred target without opening anything.
 */
export function setPreferredTarget(targetId: string): void {
	preferredTargetId = targetId
}

// ============================================================
// Helpers
// ============================================================

function spawnAsync(command: string, args: string[]): Promise<void> {
	return new Promise((resolve, reject) => {
		const proc = spawn(command, args, { stdio: "ignore", detached: true })
		proc.unref()
		proc.on("error", reject)
		// Resolve immediately — we don't wait for the app to close
		proc.on("spawn", () => resolve())
	})
}
