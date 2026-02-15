import { type ChildProcess, spawn } from "node:child_process"
import { homedir } from "node:os"
import path from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import type { LocalServerConfig } from "../preload/api"
import { getCredential } from "./credential-store"
import { createLogger } from "./logger"
import { startNotificationWatcher, stopNotificationWatcher } from "./notification-watcher"
import { getSettings } from "./settings-store"

const log = createLogger("opencode-manager")

// ============================================================
// Types
// ============================================================

export interface OpenCodeServer {
	url: string
	pid: number | null
	managed: boolean
}

// ============================================================
// State — single server
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
 */
export async function ensureServer(): Promise<OpenCodeServer> {
	if (singleServer) {
		log.debug("Server already running", {
			url: singleServer.server.url,
			pid: singleServer.server.pid,
		})
		return singleServer.server
	}

	const config = getLocalServerConfig()
	const hostname = config.hostname || DEFAULT_HOSTNAME
	const port = config.port || DEFAULT_PORT

	// Check if there's already an opencode server running on our port
	log.info("Checking for existing server on port", port)
	const existing = await detectExistingServer(hostname, port)
	if (existing) {
		log.info("Detected existing server", { url: existing.url })
		singleServer = { server: existing, process: null }
		startNotificationWatcher(existing.url)
		return existing
	}

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

	log.info("Spawning opencode server", {
		hostname,
		port,
		hasPassword: !!config.hasPassword,
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
		}
	})

	// Clean up on exit — allow lazy restart on next request
	proc.on("exit", (code, signal) => {
		if (singleServer?.process === proc) {
			log.warn("Server process exited", { pid: proc.pid, code, signal })
			singleServer = null
		}
	})

	// Wait for the server to be ready
	await waitForReady(url, 15_000)

	log.info("Server started successfully", { url, pid: proc.pid })
	startNotificationWatcher(url)
	return server
}

/**
 * Gets the single server URL, or null if not running.
 */
export function getServerUrl(): string | null {
	return singleServer?.server.url ?? null
}

/**
 * Stops the single server if we manage it.
 */
export function stopServer(): boolean {
	stopNotificationWatcher()
	if (!singleServer?.process) {
		log.debug("No managed server to stop")
		return false
	}
	log.info("Stopping managed server", { pid: singleServer.process.pid })
	singleServer.process.kill()
	singleServer = null
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
// Internal helpers
// ============================================================

async function detectExistingServer(
	hostname: string,
	port: number,
): Promise<OpenCodeServer | null> {
	const url = `http://${hostname}:${port}`
	try {
		const res = await fetch(`${url}/session`, {
			signal: AbortSignal.timeout(2000),
		})
		if (res.ok) {
			log.debug("Existing server responded OK", { url })
			return { url, pid: null, managed: false }
		}
		log.debug("Existing server responded with error", { url, status: res.status })
	} catch (err) {
		log.debug("No existing server detected", { url, reason: String(err) })
	}
	return null
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
