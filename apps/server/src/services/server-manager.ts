import { readlink } from "node:fs/promises"
import type { OpencodeClient } from "@opencode-ai/sdk/client"
import { createOpencodeClient } from "@opencode-ai/sdk/client"

// ============================================================
// Types
// ============================================================

export interface RunningServer {
	/** Unique ID (pid-based for detected, generated for managed) */
	id: string
	/** Full URL to reach the server */
	url: string
	/** Project directory */
	directory: string
	/** Project name (last segment of directory) */
	name: string
	/** Process ID (if known) */
	pid: number | null
	/** Whether this server was spawned by Codedeck (vs already running) */
	managed: boolean
}

// ============================================================
// State
// ============================================================

interface ManagedServer {
	server: RunningServer
	process: ReturnType<typeof Bun.spawn>
	client: OpencodeClient
}

/** Servers we've spawned, keyed by project directory */
const managedServers = new Map<string, ManagedServer>()

/** Next port to assign when spawning */
let nextPort = 4101

// ============================================================
// Detection — find already-running opencode serve instances
// ============================================================

/**
 * Detects running `opencode serve` instances by parsing `ss` output
 * to find opencode processes listening on TCP ports, then reading
 * their cwd from /proc to determine the project directory.
 */
export async function detectRunningServers(): Promise<RunningServer[]> {
	const servers: RunningServer[] = []

	try {
		const proc = Bun.spawn({
			cmd: ["ss", "-tlnp"],
			stdout: "pipe",
			stderr: "pipe",
		})
		const output = await new Response(proc.stdout).text()
		await proc.exited

		for (const line of output.split("\n")) {
			if (!line.includes("opencode")) continue

			// Extract port from listen address
			const addrMatch = line.match(/\s[\d.*:[\]]+:(\d+)\s/)
			if (!addrMatch) continue
			const port = Number.parseInt(addrMatch[1], 10)

			// Extract PID
			const pidMatch = line.match(/pid=(\d+)/)
			if (!pidMatch) continue
			const pid = Number.parseInt(pidMatch[1], 10)

			// Read cwd from /proc to get the project directory
			let directory: string
			try {
				directory = await readlink(`/proc/${pid}/cwd`)
			} catch {
				continue
			}

			// Skip if this is a server we manage
			if (managedServers.has(directory)) continue

			const name = directory.split("/").pop() || directory

			servers.push({
				id: `detected-${pid}`,
				url: `http://127.0.0.1:${port}`,
				directory,
				name,
				pid,
				managed: false,
			})
		}
	} catch (err) {
		console.error("Failed to detect running servers:", err)
	}

	return servers
}

// ============================================================
// Spawning
// ============================================================

/**
 * Starts an OpenCode server for a project directory.
 * Uses Bun.spawn directly (not the SDK's createOpencodeServer)
 * because we need cwd control for per-project servers.
 *
 * Returns once the server is ready to accept connections.
 */
export async function startServer(directory: string): Promise<RunningServer> {
	// Check if we already manage a server for this directory
	const existing = managedServers.get(directory)
	if (existing) return existing.server

	// Check if there's already a detected server for this directory
	const detected = await detectRunningServers()
	const alreadyRunning = detected.find((s) => s.directory === directory)
	if (alreadyRunning) return alreadyRunning

	const port = nextPort++
	const hostname = "127.0.0.1"

	const proc = Bun.spawn({
		cmd: ["opencode", "serve", `--hostname=${hostname}`, `--port=${port}`],
		cwd: directory,
		stdout: "pipe",
		stderr: "pipe",
		env: {
			...process.env,
			PATH: `${process.env.HOME}/.opencode/bin:${process.env.PATH}`,
		},
	})

	const url = `http://${hostname}:${port}`
	const name = directory.split("/").pop() || directory

	const server: RunningServer = {
		id: `managed-${proc.pid}`,
		url,
		directory,
		name,
		pid: proc.pid,
		managed: true,
	}

	const client = createOpencodeClient({ baseUrl: url })

	managedServers.set(directory, { server, process: proc, client })

	// Clean up on exit
	proc.exited.then(() => {
		managedServers.delete(directory)
		console.log(`OpenCode server for ${name} (pid ${proc.pid}) exited`)
	})

	// Wait for the server to be ready
	await waitForReady(url, 15_000)

	console.log(`OpenCode server started for ${name} at ${url} (pid ${proc.pid})`)
	return server
}

/**
 * Stops a managed server.
 */
export function stopServer(directory: string): boolean {
	const entry = managedServers.get(directory)
	if (!entry) return false

	entry.process.kill()
	managedServers.delete(directory)
	return true
}

/**
 * Returns all known running servers (both detected and managed).
 */
export async function listServers(): Promise<RunningServer[]> {
	const detected = await detectRunningServers()
	const managed = Array.from(managedServers.values()).map((e) => e.server)
	return [...detected, ...managed]
}

/**
 * Gets the SDK client for a running server URL.
 * Returns the managed client if available, otherwise creates one.
 */
export function getClient(url: string): OpencodeClient {
	for (const entry of managedServers.values()) {
		if (entry.server.url === url) return entry.client
	}
	return createOpencodeClient({ baseUrl: url })
}

// ============================================================
// Helpers
// ============================================================

/**
 * Polls the session endpoint until the server responds.
 */
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
		await Bun.sleep(250)
	}

	throw new Error(`Server at ${url} did not become ready within ${timeoutMs}ms`)
}
