/**
 * Brain MCP Registrar — Auto-registers the Nexus Builder Brain MCP server in the global
 * OpenCode config (~/.config/opencode/opencode.json).
 *
 * This removes the need for each project to manually add "palot-brain" to their
 * opencode.json — the Nexus Builder desktop app ensures it's globally available on startup.
 */

import fs from "node:fs"
import path from "node:path"
import { app } from "electron"
import { createLogger } from "./logger"

const log = createLogger("brain-mcp-registrar")

// ============================================================
// Constants
// ============================================================

/**
 * Path to the global OpenCode config file.
 * Same convention as OpenCode's own config resolution.
 */
const OPENCODE_CONFIG_DIR = path.join(app.getPath("home"), ".config", "opencode")
const OPENCODE_CONFIG_PATH = path.join(OPENCODE_CONFIG_DIR, "opencode.json")

/**
 * Name used to register the palot-brain MCP server in the OpenCode config.
 */
const MCP_SERVER_NAME = "palot-brain"

// ============================================================
// Public API
// ============================================================

export interface BrainMcpStatus {
	registered: boolean
	configPath: string
	mcpServerPath: string
}

/**
 * Gets the filesystem path to the MCP server script.
 *
 * In dev mode, points to the source file in the app resources directory.
 * In production, points to the bundled copy in the app's resources bundle.
 */
export function getMcpServerScriptPath(): string {
	if (app.isPackaged) {
		return path.join(process.resourcesPath, "palot-mcp-server.mjs")
	}

	// Dev: running from source via electron-vite
	return path.join(app.getAppPath(), "resources", "palot-mcp-server.mjs")
}

/**
 * Returns the MCP server config entry that will be written to opencode.json.
 */
export function getMcpServerConfig() {
	return {
		type: "local",
		command: ["node", getMcpServerScriptPath()],
		timeout: 10000,
	}
}

/**
 * Reads the current global OpenCode config, or returns null if it doesn't exist
 * or can't be parsed.
 */
function readCurrentConfig(): Record<string, unknown> | null {
	try {
		if (!fs.existsSync(OPENCODE_CONFIG_PATH)) return null
		const raw = fs.readFileSync(OPENCODE_CONFIG_PATH, "utf-8")
		return JSON.parse(raw) as Record<string, unknown>
	} catch (err) {
		log.warn("Failed to read OpenCode global config", { path: OPENCODE_CONFIG_PATH, err })
		return null
	}
}

/**
 * Writes a config object to the global OpenCode config file.
 * Creates the config directory if it doesn't exist.
 */
function writeConfig(config: Record<string, unknown>): boolean {
	try {
		fs.mkdirSync(OPENCODE_CONFIG_DIR, { recursive: true })
		fs.writeFileSync(OPENCODE_CONFIG_PATH, `${JSON.stringify(config, null, "\t")}\n`, "utf-8")
		return true
	} catch (err) {
		log.error("Failed to write OpenCode global config", { path: OPENCODE_CONFIG_PATH, err })
		return false
	}
}

/**
 * Register the Nexus Builder Brain MCP server in the global OpenCode config.
 *
 * Merges with any existing config:
 * - Preserves all existing top-level keys (model, agent, provider, etc.)
 * - Merges the `mcp` section: adds/updates `palot-brain`, preserves other MCP servers
 * - Does NOT overwrite other users' MCP server entries
 *
 * Safe to call multiple times — updates the script path if it changes (e.g.,
 * after app update where resources path changes).
 *
 * Returns status information about the registration.
 */
export function registerBrainMcpServer(): BrainMcpStatus {
	const mcpServerPath = getMcpServerScriptPath()
	const serverConfig = getMcpServerConfig()

	// Verify the script exists so we don't register a broken reference
	if (!fs.existsSync(mcpServerPath)) {
		log.error("MCP server script not found — cannot register", { mcpServerPath })
		return { registered: false, configPath: OPENCODE_CONFIG_PATH, mcpServerPath }
	}

	const current = readCurrentConfig() ?? {}
	const existingMcp = (current.mcp as Record<string, unknown>) ?? {}

	// Check if the entry already matches — skip write if unchanged
	const existingEntry = existingMcp[MCP_SERVER_NAME]
	if (existingEntry) {
		const existingStr = JSON.stringify(existingEntry)
		const newStr = JSON.stringify(serverConfig)
		if (existingStr === newStr) {
			log.debug("Brain MCP server already registered and up-to-date", {
				path: OPENCODE_CONFIG_PATH,
			})
			return { registered: true, configPath: OPENCODE_CONFIG_PATH, mcpServerPath }
		}
	}

	// Merge: keep existing MCP servers, add/update palot-brain
	const updatedConfig: Record<string, unknown> = {
		...current,
		mcp: {
			...existingMcp,
			[MCP_SERVER_NAME]: serverConfig,
		},
	}

	const success = writeConfig(updatedConfig)
	if (success) {
		log.info("Brain MCP server registered in global OpenCode config", {
			path: OPENCODE_CONFIG_PATH,
			script: mcpServerPath,
		})
	}

	return {
		registered: success,
		configPath: OPENCODE_CONFIG_PATH,
		mcpServerPath,
	}
}

/**
 * Remove the Nexus Builder Brain MCP entry from the global OpenCode config.
 *
 * Called on app quit / shutdown so stale entries don't linger if Nexus Builder is
 * uninstalled. Does NOT remove other users' MCP servers.
 */
export function unregisterBrainMcpServer(): boolean {
	const current = readCurrentConfig()
	if (!current) return false

	const existingMcp = current.mcp as Record<string, unknown> | undefined
	if (!existingMcp || !(MCP_SERVER_NAME in existingMcp)) {
		log.debug("No Brain MCP entry to remove")
		return false
	}

	// Remove only our entry, preserve other MCP servers
	const { [MCP_SERVER_NAME]: _removed, ...remainingMcp } = existingMcp

	const updatedConfig: Record<string, unknown> = {
		...current,
	}

	if (Object.keys(remainingMcp).length > 0) {
		updatedConfig.mcp = remainingMcp
	} else {
		// No MCP servers left — remove the mcp section entirely
		delete updatedConfig.mcp
	}

	const success = writeConfig(updatedConfig)
	if (success) {
		log.info("Brain MCP server removed from global OpenCode config")
	}
	return success
}
