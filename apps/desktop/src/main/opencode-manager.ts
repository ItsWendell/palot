import { type ChildProcess, spawn } from "node:child_process"
import { homedir } from "node:os"
import path from "node:path"
import { setTimeout as sleep } from "node:timers/promises"

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

const OPENCODE_PORT = 4101
const OPENCODE_HOSTNAME = "127.0.0.1"

// ============================================================
// Public API
// ============================================================

/**
 * Ensures the single OpenCode server is running.
 * Starts it if not already running. Returns the server info.
 */
export async function ensureServer(): Promise<OpenCodeServer> {
	if (singleServer) return singleServer.server

	// Check if there's already an opencode server running on our port
	const existing = await detectExistingServer()
	if (existing) {
		singleServer = { server: existing, process: null }
		return existing
	}

	// Build PATH with ~/.opencode/bin prepended so we find the opencode binary
	const opencodeBinDir = path.join(homedir(), ".opencode", "bin")
	const augmentedPath = `${opencodeBinDir}:${process.env.PATH ?? ""}`

	const proc = spawn(
		"opencode",
		["serve", `--hostname=${OPENCODE_HOSTNAME}`, `--port=${OPENCODE_PORT}`],
		{
			cwd: homedir(),
			stdio: "pipe",
			env: { ...process.env, PATH: augmentedPath },
		},
	)

	const url = `http://${OPENCODE_HOSTNAME}:${OPENCODE_PORT}`
	const server: OpenCodeServer = {
		url,
		pid: proc.pid ?? null,
		managed: true,
	}

	singleServer = { server, process: proc }

	// Clean up on exit — allow lazy restart on next request
	proc.on("exit", () => {
		if (singleServer?.process === proc) {
			console.log(`OpenCode server (pid ${proc.pid}) exited — will restart on next request`)
			singleServer = null
		}
	})

	// Wait for the server to be ready
	await waitForReady(url, 15_000)

	console.log(`OpenCode server started at ${url} (pid ${proc.pid})`)
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
	if (!singleServer?.process) return false
	singleServer.process.kill()
	singleServer = null
	return true
}

// ============================================================
// Internal helpers
// ============================================================

async function detectExistingServer(): Promise<OpenCodeServer | null> {
	const url = `http://${OPENCODE_HOSTNAME}:${OPENCODE_PORT}`
	try {
		const res = await fetch(`${url}/session`, {
			signal: AbortSignal.timeout(2000),
		})
		if (res.ok) {
			return { url, pid: null, managed: false }
		}
	} catch {
		// Not running
	}
	return null
}

async function waitForReady(url: string, timeoutMs: number): Promise<void> {
	const start = Date.now()
	while (Date.now() - start < timeoutMs) {
		try {
			const res = await fetch(`${url}/session`, {
				signal: AbortSignal.timeout(1000),
			})
			if (res.ok) return
		} catch {
			// Not ready yet
		}
		await sleep(250)
	}
	throw new Error(`Server at ${url} did not become ready within ${timeoutMs}ms`)
}
