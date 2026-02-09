import { contextBridge, ipcRenderer } from "electron"

/**
 * Preload bridge — exposes a typed API from the main process to the renderer.
 *
 * The renderer accesses these via `window.codedeck.*`.
 * All methods return Promises (backed by `ipcRenderer.invoke`).
 */
contextBridge.exposeInMainWorld("codedeck", {
	/** The host platform: "darwin", "win32", or "linux". */
	platform: process.platform,

	/** Returns app version and dev/production mode. */
	getAppInfo: () => ipcRenderer.invoke("app:info"),

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

	/** Updates the recent model list (adds model to front, deduplicates, caps at 10). */
	updateModelRecent: (model: { providerID: string; modelID: string }) =>
		ipcRenderer.invoke("model-state:update-recent", model),

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

	// --- Git operations ---

	git: {
		listBranches: (directory: string) => ipcRenderer.invoke("git:branches", directory),
		getStatus: (directory: string) => ipcRenderer.invoke("git:status", directory),
		checkout: (directory: string, branch: string) =>
			ipcRenderer.invoke("git:checkout", directory, branch),
		stashAndCheckout: (directory: string, branch: string) =>
			ipcRenderer.invoke("git:stash-and-checkout", directory, branch),
		stashPop: (directory: string) => ipcRenderer.invoke("git:stash-pop", directory),
	},

	// --- CLI install ---

	cli: {
		/** Checks whether the `codedeck` CLI command is installed. */
		isInstalled: () => ipcRenderer.invoke("cli:is-installed"),
		/** Installs the `codedeck` CLI command (symlinks to /usr/local/bin). */
		install: () => ipcRenderer.invoke("cli:install"),
		/** Uninstalls the `codedeck` CLI command. */
		uninstall: () => ipcRenderer.invoke("cli:uninstall"),
	},

	// --- Directory picker ---

	/** Opens a native folder picker dialog. Returns the selected path, or null if cancelled. */
	pickDirectory: () => ipcRenderer.invoke("dialog:open-directory"),

	// --- Fetch proxy (bypasses Chromium connection limits) ---

	/**
	 * Proxies an HTTP request through the main process using Electron's `net.fetch()`.
	 * This bypasses Chromium's 6-connections-per-origin limit for HTTP/1.1.
	 * The renderer serializes the Request, sends it over IPC, and gets back
	 * a serialized Response.
	 */
	fetch: (req: {
		url: string
		method: string
		headers: Record<string, string>
		body: string | null
	}) => ipcRenderer.invoke("fetch:request", req),
})
