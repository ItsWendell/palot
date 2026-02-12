/**
 * OpenCode CLI version compatibility definitions for Palot.
 *
 * Updated with each Palot release to reflect tested OpenCode versions.
 * The environment check in the onboarding flow uses these ranges to
 * decide whether to pass, warn, or block.
 */

import { execFile } from "node:child_process"
import { homedir } from "node:os"
import path from "node:path"
import { createLogger } from "./logger"

const log = createLogger("compatibility")

// ============================================================
// Compatibility range
// ============================================================

export const OPENCODE_COMPAT = {
	/** Minimum version required for core functionality. Below this: block. */
	min: "0.1.80",
	/** Highest version actively tested. Above this: warn (not block). */
	recommended: "1.0.0",
	/** Known-broken versions. These are hard-blocked with a specific message. */
	blocked: [] as string[],
}

// ============================================================
// Types
// ============================================================

export interface OpenCodeCheckResult {
	installed: boolean
	version: string | null
	path: string | null
	compatible: boolean
	compatibility: "ok" | "too-old" | "too-new" | "blocked" | "unknown"
	message: string | null
}

// ============================================================
// Version comparison helpers
// ============================================================

/** Parse a semver-like string into [major, minor, patch]. Returns null on failure. */
function parseSemver(version: string): [number, number, number] | null {
	// Strip leading 'v' and any pre-release suffix for comparison
	const clean = version.replace(/^v/, "").split("-")[0]
	const parts = clean.split(".")
	if (parts.length < 2) return null
	const major = Number.parseInt(parts[0], 10)
	const minor = Number.parseInt(parts[1], 10)
	const patch = parts[2] ? Number.parseInt(parts[2], 10) : 0
	if (Number.isNaN(major) || Number.isNaN(minor) || Number.isNaN(patch)) return null
	return [major, minor, patch]
}

/** Returns -1, 0, or 1 for a < b, a == b, a > b. */
function compareSemver(a: string, b: string): number {
	const pa = parseSemver(a)
	const pb = parseSemver(b)
	if (!pa || !pb) return 0
	for (let i = 0; i < 3; i++) {
		if (pa[i] < pb[i]) return -1
		if (pa[i] > pb[i]) return 1
	}
	return 0
}

// ============================================================
// Binary detection
// ============================================================

/** Build the augmented PATH that includes ~/.opencode/bin. */
function getAugmentedPath(): string {
	const opencodeBinDir = path.join(homedir(), ".opencode", "bin")
	const sep = process.platform === "win32" ? ";" : ":"
	return `${opencodeBinDir}${sep}${process.env.PATH ?? ""}`
}

/** Run a command and return stdout, or null on failure. */
function execAsync(
	cmd: string,
	args: string[],
	env: Record<string, string | undefined>,
): Promise<string | null> {
	return new Promise((resolve) => {
		execFile(cmd, args, { env, timeout: 5000 }, (err, stdout) => {
			if (err) {
				resolve(null)
				return
			}
			resolve(stdout.trim())
		})
	})
}

/** Try to find the opencode binary and get its version. */
async function detectOpenCode(): Promise<{ version: string | null; path: string | null }> {
	const augmentedPath = getAugmentedPath()
	const env = { ...process.env, PATH: augmentedPath }

	// Try `opencode --version` (the correct flag)
	const versionOutput = await execAsync("opencode", ["--version"], env)
	if (versionOutput) {
		// Parse version from output -- could be "v0.2.14", "opencode v0.2.14", or "local"
		const match = versionOutput.match(/v?(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?)/)
		const version = match ? match[1] : versionOutput.trim()

		// Try to find the path with `which` or `where`
		const whichCmd = process.platform === "win32" ? "where" : "which"
		const binaryPath = await execAsync(whichCmd, ["opencode"], env)

		return { version, path: binaryPath }
	}

	// Fallback: check if the binary exists at all (might not support --version)
	const whichCmd = process.platform === "win32" ? "where" : "which"
	const binaryPath = await execAsync(whichCmd, ["opencode"], env)
	if (binaryPath) {
		return { version: "unknown", path: binaryPath }
	}

	return { version: null, path: null }
}

// ============================================================
// Public API
// ============================================================

/**
 * Check whether OpenCode is installed and compatible with this version of Palot.
 * Runs the binary to get its version, then compares against the compatibility range.
 */
export async function checkOpenCode(): Promise<OpenCodeCheckResult> {
	log.info("Checking OpenCode installation...")

	const { version, path: binaryPath } = await detectOpenCode()

	if (!version) {
		log.warn("OpenCode CLI not found")
		return {
			installed: false,
			version: null,
			path: null,
			compatible: false,
			compatibility: "unknown",
			message: "OpenCode CLI not found. Install it from https://opencode.ai",
		}
	}

	log.info("OpenCode found", { version, path: binaryPath })

	// Non-semver versions (e.g. "local", "dev", "unknown") are assumed compatible --
	// these are typically local/dev builds where the user knows what they're doing.
	const isSemver = parseSemver(version) !== null
	if (!isSemver) {
		log.info("Non-semver version detected, assuming compatible", { version })
		return {
			installed: true,
			version,
			path: binaryPath,
			compatible: true,
			compatibility: "ok",
			message: null,
		}
	}

	// Check blocked versions
	if (OPENCODE_COMPAT.blocked.includes(version)) {
		return {
			installed: true,
			version,
			path: binaryPath,
			compatible: false,
			compatibility: "blocked",
			message: `OpenCode ${version} has known issues with this version of Palot. Please update.`,
		}
	}

	// Check minimum version
	if (compareSemver(version, OPENCODE_COMPAT.min) < 0) {
		return {
			installed: true,
			version,
			path: binaryPath,
			compatible: false,
			compatibility: "too-old",
			message: `OpenCode ${version} is too old. Palot requires ${OPENCODE_COMPAT.min} or newer.`,
		}
	}

	// Check recommended range
	if (compareSemver(version, OPENCODE_COMPAT.recommended) > 0) {
		return {
			installed: true,
			version,
			path: binaryPath,
			compatible: true,
			compatibility: "too-new",
			message: `OpenCode ${version} is newer than tested. Some features may not work as expected.`,
		}
	}

	return {
		installed: true,
		version,
		path: binaryPath,
		compatible: true,
		compatibility: "ok",
		message: null,
	}
}
