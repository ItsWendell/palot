/**
 * OpenCode SDK client factory for the automation executor.
 *
 * Creates SDK clients from the Electron main process. Unlike the renderer
 * (which proxies through IPC to bypass Chromium connection limits), the main
 * process can use standard fetch directly since it runs in Node.js.
 *
 * The client is scoped to a specific project directory so that all session
 * and worktree operations target the correct OpenCode instance.
 */

import type { OpencodeClient } from "@opencode-ai/sdk/v2/client"
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import { createLogger } from "../logger"
import { getServerUrl } from "../opencode-manager"

const log = createLogger("automation-client")

/**
 * Creates an OpenCode SDK client for automation use in the main process.
 *
 * @param directory  Project directory to scope the client to
 * @returns SDK client, or null if no server is running
 */
export function createAutomationClient(directory: string): OpencodeClient | null {
	const url = getServerUrl()
	if (!url) {
		log.warn("Cannot create automation client: no OpenCode server running")
		return null
	}

	log.debug("Creating automation SDK client", { url, directory })
	return createOpencodeClient({
		baseUrl: url,
		directory,
	})
}

/**
 * Creates an unscoped (no directory) OpenCode SDK client.
 * Used for global operations like subscribing to SSE events.
 */
export function createBaseAutomationClient(): OpencodeClient | null {
	const url = getServerUrl()
	if (!url) {
		log.warn("Cannot create base automation client: no OpenCode server running")
		return null
	}

	return createOpencodeClient({ baseUrl: url })
}
