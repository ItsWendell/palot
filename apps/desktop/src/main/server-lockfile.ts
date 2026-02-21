/**
 * Lockfile for the Palot-managed OpenCode server process.
 *
 * Written when Palot spawns a server, removed on clean shutdown. On next
 * launch, a stale lockfile (dead PID) tells us the previous instance
 * crashed and we need to spawn fresh. A live lockfile with a different
 * UID triggers the cross-user conflict dialog.
 *
 * Path: ~/.local/share/palot/server.lock
 */

import fs from "node:fs"
import path from "node:path"
import { getDataDir } from "./automation/paths"
import { createLogger } from "./logger"

const log = createLogger("server-lockfile")

const LOCKFILE_NAME = "server.lock"

// ============================================================
// Types
// ============================================================

export interface LockfileData {
	port: number
	pid: number
	startedAt: string
}

// ============================================================
// Public API
// ============================================================

/**
 * Write the server lockfile atomically (write .tmp, then rename).
 */
export function writeLockfile(port: number, pid: number): void {
	const lockPath = getLockfilePath()
	const data: LockfileData = {
		port,
		pid,
		startedAt: new Date().toISOString(),
	}

	try {
		const dir = path.dirname(lockPath)
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true })
		}
		const tmpPath = `${lockPath}.tmp`
		fs.writeFileSync(tmpPath, JSON.stringify(data, null, "\t"), "utf-8")
		fs.renameSync(tmpPath, lockPath)
		log.info("Lockfile written", { path: lockPath, port, pid })
	} catch (err) {
		log.error("Failed to write lockfile", err)
	}
}

/**
 * Read and parse the server lockfile. Returns null if the file
 * doesn't exist or can't be parsed.
 */
export function readLockfile(): LockfileData | null {
	const lockPath = getLockfilePath()
	try {
		if (!fs.existsSync(lockPath)) return null
		const raw = fs.readFileSync(lockPath, "utf-8")
		const data = JSON.parse(raw) as LockfileData
		if (typeof data.port !== "number" || typeof data.pid !== "number") {
			log.warn("Lockfile has invalid format, ignoring", { path: lockPath })
			return null
		}
		return data
	} catch (err) {
		log.debug("Failed to read lockfile", { path: lockPath, reason: String(err) })
		return null
	}
}

/**
 * Remove the server lockfile. Safe to call even if it doesn't exist.
 */
export function removeLockfile(): void {
	const lockPath = getLockfilePath()
	try {
		if (fs.existsSync(lockPath)) {
			fs.unlinkSync(lockPath)
			log.info("Lockfile removed", { path: lockPath })
		}
	} catch (err) {
		log.debug("Failed to remove lockfile", { path: lockPath, reason: String(err) })
	}
}

// ============================================================
// Internal
// ============================================================

function getLockfilePath(): string {
	return path.join(getDataDir(), LOCKFILE_NAME)
}
