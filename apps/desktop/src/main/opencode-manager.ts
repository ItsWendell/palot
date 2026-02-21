import { type ChildProcess, spawn } from "node:child_process"
import { homedir } from "node:os"
import path from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { dialog } from "electron"
import type { LocalServerConfig } from "../preload/api"
import { getCredential } from "./credential-store"
import { findFreePort } from "./find-free-port"
import { createLogger } from "./logger"
import { startNotificationWatcher, stopNotificationWatcher } from "./notification-watcher"
import { getListeningProcessOwner, isCurrentUser, isProcessAlive } from "./process-owner"
import { readLockfile, removeLockfile, writeLockfile } from "./server-lockfile"
import { getSettings } from "./settings-store"
import { waitForEnv } from "./shell-env"

const log = createLogger("opencode-manager")

// ============================================================
// Types
// ============================================================

export interface OpenCodeServer {
	url: string
	pid: number | null
	managed: boolean
}

/** Result of detecting an existing server on the target port. */
type DetectionResult =
	| { kind: "found"; server: OpenCodeServer }
	| { kind: "conflict"; url: string; ownerUid: number | null }
	| { kind: "none" }

// ============================================================
// State -- single server
// ============================================================

let singleServer: {
	server: OpenCodeServer
	process: ChildProcess | null
} | null = null

const DEFAULT_PORT = 4101
const DEFAULT_HOSTNAME = "127.0.0.1"

// ============================================================
// Public API
// ============================================================

/** Reads the local server config from persisted settings. */
function getLocalServerConfig(): LocalServerConfig {
	const settings = getSettings()
	const local = settings.servers.servers.find((s) => s.id === "local")
	return (local as LocalServerConfig) ?? { id: "local", name: "This Mac", type: "local" }
}

/**
 * Ensures the single OpenCode server is running.
 * Starts it if not already running. Returns the server info.
 *
 * Performs ownership checks to prevent connecting to a server owned by a
 * different OS user. If a conflict is detected, prompts the user with a
 * dialog offering to start on a different port or connect anyway.
 */
export async function ensureServer(): Promise<OpenCodeServer> {
	if (singleServer) {
		log.debug("Server already running", {
			url: singleServer.server.url,
			pid: singleServer.server.pid,
		})
		return singleServer.server
	}

	// Ensure the full shell environment is available before spawning the server.
	// startEnvResolution() fires early in app startup; by the time the renderer
	// triggers ensureServer() the promise is usually already resolved.
	await waitForEnv()

	const config = getLocalServerConfig()
	const hostname = config.hostname || DEFAULT_HOSTNAME
	const port = config.port || DEFAULT_PORT

	// --- Fast-path: check our own lockfile first ---
	const lockfile = readLockfile()
	if (lockfile) {
		const lockResult = await handleLockfile(lockfile, hostname)
		if (lockResult) return lockResult
	}

	// --- Probe the target port for an existing server ---
	log.info("Checking for existing server on port", port)
	const detection = await detectExistingServer(hostname, port)

	if (detection.kind === "found") {
		log.info("Detected existing same-user server", { url: detection.server.url })
		singleServer = { server: detection.server, process: null }
		startNotificationWatcher(detection.server.url)
		return detection.server
	}

	if (detection.kind === "conflict") {
		return handleConflict(detection, hostname, port, config)
	}

	// --- No existing server: spawn one on the configured port ---
	return spawnServer(hostname, port, config)
}

/**
 * Gets the single server URL, or null if not running.
 */
export function getServerUrl(): string | null {
	return singleServer?.server.url ?? null
}

/**
 * Stops the single server if we manage it and removes the lockfile.
 */
export function stopServer(): boolean {
	stopNotificationWatcher()
	if (!singleServer?.process) {
		log.debug("No managed server to stop")
		removeLockfile()
		return false
	}
	log.info("Stopping managed server", { pid: singleServer.process.pid })
	singleServer.process.kill()
	singleServer = null
	removeLockfile()
	return true
}

/**
 * Restarts the managed server (stop + start). Used when local server
 * settings (hostname, port, password) change.
 */
export async function restartServer(): Promise<OpenCodeServer> {
	log.info("Restarting server due to settings change")
	stopServer()
	return ensureServer()
}

// ============================================================
// Internal -- lockfile handling
// ============================================================

/**
 * Attempts to reconnect to a server described by an existing lockfile.
 * Returns an OpenCodeServer if successful, null if the lockfile is stale
 * or the server belongs to a different user (lockfile is cleaned up and
 * the caller should fall through to normal detection).
 */
async function handleLockfile(
	lockfile: { port: number; pid: number; startedAt: string },
	hostname: string,
): Promise<OpenCodeServer | null> {
	if (!isProcessAlive(lockfile.pid)) {
		log.info("Stale lockfile detected (PID dead), cleaning up", {
			pid: lockfile.pid,
			port: lockfile.port,
		})
		removeLockfile()
		return null
	}

	// PID is alive -- verify it's ours
	const owner = await getListeningProcessOwner(lockfile.port)
	if (owner && !isCurrentUser(owner.uid)) {
		log.warn("Lockfile PID is alive but owned by different user", {
			pid: lockfile.pid,
			uid: owner.uid,
		})
		removeLockfile()
		return null // Fall through to normal detection, which will trigger the conflict dialog
	}

	// PID alive + same user: probe to confirm it's actually an opencode server
	const url = `http://${hostname}:${lockfile.port}`
	if (await probeServer(url)) {
		log.info("Reconnecting to server from lockfile", { url, pid: lockfile.pid })
		const server: OpenCodeServer = { url, pid: lockfile.pid, managed: false }
		singleServer = { server, process: null }
		startNotificationWatcher(url)
		return server
	}

	// PID alive but not responding on the expected port -- stale lockfile
	log.info("Lockfile PID alive but server not responding, cleaning up", {
		pid: lockfile.pid,
		port: lockfile.port,
	})
	removeLockfile()
	return null
}

// ============================================================
// Internal -- detection with ownership check
// ============================================================

/**
 * Probes the target port for an existing OpenCode server and checks
 * whether the listening process belongs to the current OS user.
 */
async function detectExistingServer(
	hostname: string,
	port: number,
): Promise<DetectionResult> {
	const url = `http://${hostname}:${port}`
	const isResponding = await probeServer(url)
	if (!isResponding) {
		return { kind: "none" }
	}

	// Something is listening -- check who owns it
	const owner = await getListeningProcessOwner(port)

	if (!owner) {
		// Can't determine ownership (Windows, or lsof failed). On Windows this
		// is expected; on macOS/Linux treat as a soft conflict with a less
		// alarming prompt.
		if (process.platform === "win32") {
			log.debug("Existing server responded OK (ownership check skipped on Windows)", { url })
			return { kind: "found", server: { url, pid: null, managed: false } }
		}
		log.warn("Existing server found but could not determine owner", { url })
		return { kind: "conflict", url, ownerUid: null }
	}

	if (isCurrentUser(owner.uid)) {
		log.debug("Existing server belongs to current user", { url, pid: owner.pid, uid: owner.uid })
		return { kind: "found", server: { url, pid: owner.pid, managed: false } }
	}

	log.warn("Existing server belongs to a DIFFERENT user", { url, pid: owner.pid, uid: owner.uid })
	return { kind: "conflict", url, ownerUid: owner.uid }
}

// ============================================================
// Internal -- conflict resolution
// ============================================================

/**
 * Shows a dialog when the server on the target port belongs to a different
 * user. Offers three choices: start on a different port, connect anyway,
 * or cancel.
 */
async function handleConflict(
	conflict: { url: string; ownerUid: number | null },
	hostname: string,
	_configuredPort: number,
	config: LocalServerConfig,
): Promise<OpenCodeServer> {
	const ownerText =
		conflict.ownerUid !== null
			? `It appears to belong to a different user account (UID ${conflict.ownerUid}).`
			: "Its owner could not be determined."

	const { response } = await dialog.showMessageBox({
		type: "warning",
		title: "Server Ownership Conflict",
		message: "An OpenCode server is already running on the configured port.",
		detail:
			`${ownerText}\n\n` +
			"Connecting to a server owned by another user is a security risk: " +
			"they could access your sessions and files.\n\n" +
			"You can start your own server on a different port, or connect anyway " +
			"if you trust this server.",
		buttons: ["Start My Own Server", "Connect Anyway", "Cancel"],
		defaultId: 0,
		cancelId: 2,
	})

	if (response === 0) {
		// Start on a free port
		log.info("User chose to start own server on a different port")
		const freePort = await findFreePort(hostname)
		log.info("Found free port", { freePort })
		return spawnServer(hostname, freePort, config)
	}

	if (response === 1) {
		// Connect anyway (user accepts the risk)
		log.warn("User chose to connect to foreign server anyway", { url: conflict.url })
		const server: OpenCodeServer = { url: conflict.url, pid: null, managed: false }
		singleServer = { server, process: null }
		startNotificationWatcher(conflict.url)
		return server
	}

	// Cancel
	throw new Error("Server connection cancelled by user due to ownership conflict")
}

// ============================================================
// Internal -- server spawning
// ============================================================

/**
 * Spawns a new opencode server process on the given hostname:port.
 * Writes a lockfile on success.
 */
async function spawnServer(
	hostname: string,
	port: number,
	config: LocalServerConfig,
): Promise<OpenCodeServer> {
	// Build PATH with ~/.opencode/bin prepended so we find the opencode binary
	const opencodeBinDir = path.join(homedir(), ".opencode", "bin")
	const sep = process.platform === "win32" ? ";" : ":"
	const augmentedPath = `${opencodeBinDir}${sep}${process.env.PATH ?? ""}`

	// Build CLI args
	const args = ["serve", `--hostname=${hostname}`, `--port=${port}`]

	// Add password if configured
	if (config.hasPassword) {
		const password = getCredential("local")
		if (password) {
			args.push(`--password=${password}`)
		}
	}

	// Add mDNS flags if enabled
	if (config.mdns) {
		args.push("--mdns")
		if (config.mdnsDomain) {
			args.push(`--mdns-domain=${config.mdnsDomain}`)
		}
	}

	log.info("Spawning opencode server", {
		hostname,
		port,
		hasPassword: !!config.hasPassword,
		mdns: !!config.mdns,
		binDir: opencodeBinDir,
	})

	const proc = spawn("opencode", args, {
		cwd: homedir(),
		stdio: "pipe",
		env: { ...process.env, PATH: augmentedPath },
	})

	const url = `http://${hostname}:${port}`
	const server: OpenCodeServer = {
		url,
		pid: proc.pid ?? null,
		managed: true,
	}

	singleServer = { server, process: proc }

	// Capture stdout/stderr for diagnostics
	proc.stdout?.on("data", (data: Buffer) => {
		const text = data.toString().trim()
		if (text) log.debug(`[stdout] ${text}`)
	})

	proc.stderr?.on("data", (data: Buffer) => {
		const text = data.toString().trim()
		if (text) log.warn(`[stderr] ${text}`)
	})

	// Handle spawn errors (e.g. binary not found)
	proc.on("error", (err) => {
		log.error("Failed to spawn opencode process", err)
		if (singleServer?.process === proc) {
			singleServer = null
			removeLockfile()
		}
	})

	// Clean up on exit -- allow lazy restart on next request
	proc.on("exit", (code, signal) => {
		if (singleServer?.process === proc) {
			log.warn("Server process exited", { pid: proc.pid, code, signal })
			singleServer = null
			removeLockfile()
		}
	})

	// Wait for the server to be ready
	await waitForReady(url, 15_000)

	// Write lockfile after successful start
	if (proc.pid) {
		writeLockfile(port, proc.pid)
	}

	log.info("Server started successfully", { url, pid: proc.pid })
	startNotificationWatcher(url)
	return server
}

// ============================================================
// Internal -- HTTP probe & readiness
// ============================================================

/** Quick probe to check if a server responds on the given URL. */
async function probeServer(url: string): Promise<boolean> {
	try {
		const res = await fetch(`${url}/session`, {
			signal: AbortSignal.timeout(2000),
		})
		if (res.ok) {
			log.debug("Server probe OK", { url })
			return true
		}
		log.debug("Server probe returned error status", { url, status: res.status })
	} catch (err) {
		log.debug("Server probe failed", { url, reason: String(err) })
	}
	return false
}

async function waitForReady(url: string, timeoutMs: number): Promise<void> {
	const start = Date.now()
	let attempts = 0
	while (Date.now() - start < timeoutMs) {
		attempts++
		try {
			const res = await fetch(`${url}/session`, {
				signal: AbortSignal.timeout(1000),
			})
			if (res.ok) {
				log.debug("Server ready", { url, attempts, elapsed: Date.now() - start })
				return
			}
			log.debug("Server not ready yet", { url, status: res.status, attempts })
		} catch (err) {
			log.debug("Server not ready yet", { url, reason: String(err), attempts })
		}
		await sleep(250)
	}
	const error = new Error(`Server at ${url} did not become ready within ${timeoutMs}ms`)
	log.error(error.message, { attempts })
	throw error
}
