import { access, readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

// ============================================================
// Types
// ============================================================

interface ModelRef {
	providerID: string
	modelID: string
}

interface ModelState {
	recent: ModelRef[]
	favorite: ModelRef[]
	variant: Record<string, string | undefined>
}

// ============================================================
// Read model state
// ============================================================

const EMPTY_STATE: ModelState = { recent: [], favorite: [], variant: {} }

/**
 * Reads the OpenCode model state (recent models, favorites, variants).
 *
 * First discovers the state directory by querying the running OpenCode server,
 * then reads `{state}/model.json`.
 * Falls back to the default XDG path if the server is unreachable.
 */
export async function readModelState(): Promise<ModelState> {
	try {
		// Try to get state path from the running OpenCode server
		let statePath: string
		try {
			const pathRes = await fetch("http://127.0.0.1:4101/path", {
				signal: AbortSignal.timeout(2000),
			})
			if (pathRes.ok) {
				const paths = (await pathRes.json()) as { state: string }
				statePath = paths.state
			} else {
				statePath = join(homedir(), ".local", "state", "opencode")
			}
		} catch {
			statePath = join(homedir(), ".local", "state", "opencode")
		}

		const modelFile = join(statePath, "model.json")

		// Check if file exists
		try {
			await access(modelFile)
		} catch {
			return EMPTY_STATE
		}

		const content = await readFile(modelFile, "utf-8")
		const data = JSON.parse(content) as ModelState

		return {
			recent: Array.isArray(data.recent) ? data.recent : [],
			favorite: Array.isArray(data.favorite) ? data.favorite : [],
			variant: typeof data.variant === "object" && data.variant !== null ? data.variant : {},
		}
	} catch (err) {
		console.error("Failed to read model state:", err)
		return EMPTY_STATE
	}
}
