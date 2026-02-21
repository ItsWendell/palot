/**
 * Process ownership utilities for cross-user server safety.
 *
 * On macOS/Linux, determines which OS user owns a process listening on a
 * given TCP port. Used to prevent Palot from silently connecting to an
 * OpenCode server owned by a different user (e.g., an orphaned process
 * from a previous login session).
 */

import { execFile } from "node:child_process"
import { createLogger } from "./logger"

const log = createLogger("process-owner")

// ============================================================
// Types
// ============================================================

export interface ProcessInfo {
	pid: number
	uid: number
}

// ============================================================
// Public API
// ============================================================

/**
 * Returns the PID and UID of the process listening on the given TCP port,
 * or null if no process is found or the platform doesn't support the check.
 *
 * On Windows, always returns null (cross-user login switching is not a
 * concern there).
 */
export async function getListeningProcessOwner(port: number): Promise<ProcessInfo | null> {
	if (process.platform === "win32") {
		return null
	}

	try {
		// lsof flags:
		//   -i :PORT    -- filter by TCP port
		//   -sTCP:LISTEN -- only listening sockets
		//   -Fn         -- output PID (prefixed with 'p')
		//   -Fu         -- output UID (prefixed with 'u')
		//   -n          -- no DNS resolution (faster)
		//   -P          -- no port name resolution
		const output = await execFileAsync("lsof", [
			`-i:${port}`,
			"-sTCP:LISTEN",
			"-Fn",
			"-Fu",
			"-n",
			"-P",
		])

		return parseLsofOutput(output)
	} catch (err) {
		log.debug("Failed to determine process owner", { port, reason: String(err) })
		return null
	}
}

/**
 * Returns true if the given UID matches the current process's user.
 */
export function isCurrentUser(uid: number): boolean {
	// process.getuid() is available on POSIX platforms only
	const getuid = (process as NodeJS.Process & { getuid?: () => number }).getuid
	if (!getuid) return true // Can't determine -- assume same user (Windows)
	return getuid() === uid
}

/**
 * Returns true if a process with the given PID is still alive.
 * Uses signal 0 (no-op signal) to probe without affecting the process.
 */
export function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0)
		return true
	} catch (err) {
		// ESRCH = no such process, EPERM = process exists but we can't signal it
		if ((err as NodeJS.ErrnoException).code === "EPERM") {
			return true // Process exists but owned by different user
		}
		return false
	}
}

// ============================================================
// Internal
// ============================================================

function execFileAsync(cmd: string, args: string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(cmd, args, { timeout: 5000 }, (err, stdout) => {
			if (err) {
				reject(err)
				return
			}
			resolve(stdout)
		})
	})
}

/**
 * Parses lsof -Fn -Fu output to extract PID and UID.
 *
 * lsof output format (one field per line, prefixed by type character):
 *   p<PID>
 *   u<UID>
 *   f<FD>
 *   ...
 *
 * We want the first p (PID) and u (UID) lines.
 */
function parseLsofOutput(output: string): ProcessInfo | null {
	let pid: number | null = null
	let uid: number | null = null

	for (const line of output.split("\n")) {
		if (line.startsWith("p") && pid === null) {
			const parsed = Number.parseInt(line.slice(1), 10)
			if (!Number.isNaN(parsed)) pid = parsed
		}
		if (line.startsWith("u") && uid === null) {
			const parsed = Number.parseInt(line.slice(1), 10)
			if (!Number.isNaN(parsed)) uid = parsed
		}
		if (pid !== null && uid !== null) break
	}

	if (pid === null || uid === null) {
		log.debug("Could not parse PID/UID from lsof output", { output: output.trim() })
		return null
	}

	return { pid, uid }
}
