/**
 * Detects installed editors, terminals, and file managers on the system
 * and provides the ability to open a directory in any of them.
 *
 * Currently supports macOS only; other platforms return an empty list.
 */

import { execFileSync, spawn } from "node:child_process"
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { app } from "electron"
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
	/** Base64-encoded PNG icon data URL, resolved at runtime from the installed app. */
	iconDataUrl?: string
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
	/** Returns the .app bundle path if found, for runtime icon extraction. */
	appPath?: () => string | null
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
		appPath: () => findPath(["/Applications/Visual Studio Code.app"]),
		args: (dir) => ["--goto", dir],
	},
	{
		id: "vscodeInsiders",
		label: "VS Code Insiders",
		detect: () =>
			detectVSCodeLike("/Applications/Visual Studio Code - Insiders.app", "code-insiders"),
		appPath: () => findPath(["/Applications/Visual Studio Code - Insiders.app"]),
		args: (dir) => ["--goto", dir],
	},
	{
		id: "cursor",
		label: "Cursor",
		detect: () => detectVSCodeLike("/Applications/Cursor.app", "cursor"),
		appPath: () => findPath(["/Applications/Cursor.app"]),
		args: (dir) => ["--goto", dir],
	},
	{
		id: "windsurf",
		label: "Windsurf",
		detect: () => detectVSCodeLike("/Applications/Windsurf.app", "windsurf"),
		appPath: () => findPath(["/Applications/Windsurf.app"]),
		args: (dir) => ["--goto", dir],
	},
	{
		id: "zed",
		label: "Zed",
		detect: () => whichSync("zed") ?? (findPath(["/Applications/Zed.app"]) ? "zed" : null),
		appPath: () => findPath(["/Applications/Zed.app"]),
		args: (dir) => [dir],
	},

	// --- File manager ---
	{
		id: "finder",
		label: "Finder",
		detect: () => (process.platform === "darwin" ? "open" : null),
		appPath: () => findPath(["/System/Library/CoreServices/Finder.app"]),
		args: (dir) => ["-R", dir],
	},

	// --- Terminals ---
	{
		id: "terminal",
		label: "Terminal",
		detect: () => detectApp("Terminal") ?? null,
		appPath: () =>
			findPath([
				"/System/Applications/Utilities/Terminal.app",
				"/Applications/Utilities/Terminal.app",
			]),
		args: (dir) => ["-a", "Terminal", dir],
	},
	{
		id: "iterm2",
		label: "iTerm2",
		detect: () => findPath(["/Applications/iTerm.app", "/Applications/iTerm2.app"]),
		appPath: () => findPath(["/Applications/iTerm.app", "/Applications/iTerm2.app"]),
		args: (dir) => ["-a", "iTerm", dir],
	},
	{
		id: "ghostty",
		label: "Ghostty",
		detect: () => findPath(["/Applications/Ghostty.app"]),
		appPath: () => findPath(["/Applications/Ghostty.app"]),
		args: (dir) => ["-a", "Ghostty", dir],
	},
	{
		id: "warp",
		label: "Warp",
		detect: () => findPath(["/Applications/Warp.app"]),
		appPath: () => findPath(["/Applications/Warp.app"]),
		args: (dir) => ["-a", "Warp", dir],
	},

	// --- JetBrains ---
	{
		id: "webstorm",
		label: "WebStorm",
		detect: () => detectJetBrains("WebStorm", "webstorm", ["/Applications/WebStorm.app"]),
		appPath: () => findPath(["/Applications/WebStorm.app"]),
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
		appPath: () =>
			findPath(["/Applications/IntelliJ IDEA.app", "/Applications/IntelliJ IDEA CE.app"]),
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
		appPath: () => findPath(["/Applications/PyCharm.app", "/Applications/PyCharm CE.app"]),
		args: (dir) => [dir],
	},
	{
		id: "goland",
		label: "GoLand",
		detect: () => detectJetBrains("GoLand", "goland", ["/Applications/GoLand.app"]),
		appPath: () => findPath(["/Applications/GoLand.app"]),
		args: (dir) => [dir],
	},
	{
		id: "rustrover",
		label: "RustRover",
		detect: () => detectJetBrains("RustRover", "rustrover", ["/Applications/RustRover.app"]),
		appPath: () => findPath(["/Applications/RustRover.app"]),
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
		appPath: () => findPath(["/Applications/Xcode.app"]),
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

/** In-memory cache for resolved icon data URLs, keyed by target ID. */
const iconCache = new Map<string, string>()

/**
 * Resolve an app icon from the .app bundle path using sips to convert
 * the .icns file to PNG. Falls back to Electron's app.getFileIcon() API.
 * Returns a data URL (PNG) or undefined.
 */
async function resolveAppIcon(targetDef: TargetDef): Promise<string | undefined> {
	const cached = iconCache.get(targetDef.id)
	if (cached) return cached

	const appBundlePath = targetDef.appPath?.()
	if (!appBundlePath) return undefined

	try {
		// Try converting the .icns file to PNG via sips (macOS built-in tool).
		// This avoids Electron's nativeImage.createFromPath() which can crash
		// on certain macOS / Electron version combinations with .icns files.
		const pngData = convertIcnsToPng(appBundlePath)
		if (pngData) {
			const dataUrl = `data:image/png;base64,${pngData}`
			iconCache.set(targetDef.id, dataUrl)
			return dataUrl
		}

		// Fallback to Electron's file icon API
		const icon = await app.getFileIcon(appBundlePath, { size: "large" })
		const dataUrl = `data:image/png;base64,${icon.toPNG().toString("base64")}`
		iconCache.set(targetDef.id, dataUrl)
		return dataUrl
	} catch (err) {
		log.warn(`Failed to resolve icon for "${targetDef.id}"`, err)
		return undefined
	}
}

/**
 * Extract the app icon from a .app bundle and convert it to a base64 PNG
 * using macOS `sips` (Scriptable Image Processing System). This is safer
 * than using Electron's nativeImage.createFromPath() on .icns files, which
 * can crash on certain macOS / Electron version combinations.
 */
function convertIcnsToPng(appBundlePath: string): string | null {
	try {
		// Read CFBundleIconFile from Info.plist
		const iconName = execFileSync(
			"defaults",
			["read", join(appBundlePath, "Contents", "Info"), "CFBundleIconFile"],
			{ encoding: "utf-8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] },
		).trim()

		const iconFileName = iconName.endsWith(".icns") ? iconName : `${iconName}.icns`
		const icnsPath = join(appBundlePath, "Contents", "Resources", iconFileName)

		if (!existsSync(icnsPath)) return null

		// Use sips to convert .icns to PNG via a temp file
		const tmpPath = join(
			tmpdir(),
			`palot-icon-${Date.now()}-${Math.random().toString(36).slice(2)}.png`,
		)
		try {
			execFileSync("sips", ["-s", "format", "png", "-z", "64", "64", icnsPath, "--out", tmpPath], {
				timeout: 5000,
				stdio: ["ignore", "ignore", "ignore"],
			})

			if (!existsSync(tmpPath)) return null
			const pngData = readFileSync(tmpPath)
			if (pngData.length === 0) return null
			return pngData.toString("base64")
		} finally {
			try {
				unlinkSync(tmpPath)
			} catch {
				// Ignore cleanup errors
			}
		}
	} catch {
		return null
	}
}

/**
 * Returns all known targets, which are available, and the user's preferred target.
 * Resolves app icons at runtime from installed .app bundles.
 */
export async function getOpenInTargets(): Promise<OpenInTargetsResult> {
	if (process.platform !== "darwin") {
		return { targets: [], availableTargets: [], preferredTarget: null }
	}

	const { ids } = detectAvailable()
	const availableSet = new Set(ids)

	// Resolve preferred: stored preference if still available, else first available
	const preferred =
		preferredTargetId && availableSet.has(preferredTargetId) ? preferredTargetId : (ids[0] ?? null)

	// Resolve icons in parallel for all available targets
	const iconResults = await Promise.allSettled(
		TARGETS.filter((t) => availableSet.has(t.id)).map(async (t) => ({
			id: t.id,
			iconDataUrl: await resolveAppIcon(t),
		})),
	)
	const iconMap = new Map<string, string>()
	for (const result of iconResults) {
		if (result.status === "fulfilled" && result.value.iconDataUrl) {
			iconMap.set(result.value.id, result.value.iconDataUrl)
		}
	}

	const targets: OpenInTarget[] = TARGETS.map((t) => ({
		id: t.id,
		label: t.label,
		available: availableSet.has(t.id),
		iconDataUrl: iconMap.get(t.id),
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
