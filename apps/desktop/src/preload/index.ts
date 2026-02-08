import { contextBridge, ipcRenderer } from "electron"

/**
 * Preload bridge — exposes a typed API from the main process to the renderer.
 *
 * The renderer accesses these via `window.codedeck.*`.
 * All methods return Promises (backed by `ipcRenderer.invoke`).
 */
contextBridge.exposeInMainWorld("codedeck", {
	/** Ensures the OpenCode server is running. Spawns it if not. */
	ensureOpenCode: () => ipcRenderer.invoke("opencode:ensure"),

	/** Gets the URL of the running server, or null. */
	getServerUrl: () => ipcRenderer.invoke("opencode:url"),

	/** Stops the managed OpenCode server. */
	stopOpenCode: () => ipcRenderer.invoke("opencode:stop"),

	/** Discovers projects and sessions from local disk storage. */
	discover: () => ipcRenderer.invoke("discover"),

	/** Reads all messages and parts for a session from disk. */
	getSessionMessages: (sessionId: string) => ipcRenderer.invoke("session:messages", sessionId),

	/** Reads model state (recent models, favorites, variants). */
	getModelState: () => ipcRenderer.invoke("model-state"),

	// --- Auto-updater ---

	/** Gets the current auto-updater state. */
	getUpdateState: () => ipcRenderer.invoke("updater:state"),

	/** Manually triggers an update check. */
	checkForUpdates: () => ipcRenderer.invoke("updater:check"),

	/** Starts downloading the available update. */
	downloadUpdate: () => ipcRenderer.invoke("updater:download"),

	/** Quits the app and installs the downloaded update. */
	installUpdate: () => ipcRenderer.invoke("updater:install"),

	/** Subscribes to update state changes pushed from the main process. */
	onUpdateStateChanged: (callback: (state: unknown) => void) => {
		const listener = (_event: unknown, state: unknown) => callback(state)
		ipcRenderer.on("updater:state-changed", listener)
		return () => {
			ipcRenderer.removeListener("updater:state-changed", listener)
		}
	},
})
