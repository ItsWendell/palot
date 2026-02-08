import path from "node:path"
import { app, BrowserWindow, Menu, shell } from "electron"
import { registerIpcHandlers } from "./ipc-handlers"
import { stopServer } from "./opencode-manager"
import { initAutoUpdater, stopAutoUpdater } from "./updater"

// Skip default menu construction — saves startup time.
// Must be called before app.whenReady(). See: https://electronjs.org/docs/latest/tutorial/performance
Menu.setApplicationMenu(null)

// Linux/Wayland: enable native Wayland rendering to avoid blurry XWayland scaling.
// These flags must be set before app.whenReady().
if (process.platform === "linux") {
	app.commandLine.appendSwitch("ozone-platform-hint", "auto")
	app.commandLine.appendSwitch("enable-features", "WaylandWindowDecorations")
	app.commandLine.appendSwitch("enable-wayland-ime")
}

function createWindow(): BrowserWindow {
	const win = new BrowserWindow({
		width: 1200,
		height: 800,
		minWidth: 900,
		minHeight: 600,
		// Set window icon for dev mode on Linux/Windows (macOS uses the .app bundle icon)
		...(process.platform !== "darwin" && {
			icon: path.join(__dirname, "../../resources/icon.png"),
		}),
		webPreferences: {
			preload: path.join(__dirname, "../preload/index.cjs"),
			contextIsolation: true,
			sandbox: true,
			nodeIntegration: false,
			spellcheck: false,
			v8CacheOptions: "bypassHeatCheckAndEagerCompile",
		},
	})

	// Open external links in default browser instead of new Electron windows
	win.webContents.setWindowOpenHandler(({ url }) => {
		shell.openExternal(url)
		return { action: "deny" }
	})

	// Dev: load from Vite dev server | Prod: load built files
	if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
		win.loadURL(process.env.ELECTRON_RENDERER_URL)
	} else {
		win.loadFile(path.join(__dirname, "../renderer/index.html"))
	}

	return win
}

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
	app.quit()
} else {
	app.on("second-instance", () => {
		const win = BrowserWindow.getAllWindows()[0]
		if (win) {
			if (win.isMinimized()) win.restore()
			win.focus()
		}
	})

	app.whenReady().then(() => {
		registerIpcHandlers()
		createWindow()
		initAutoUpdater().catch(console.error)

		app.on("activate", () => {
			if (BrowserWindow.getAllWindows().length === 0) createWindow()
		})
	})

	app.on("window-all-closed", () => {
		// Clean up the managed opencode server and auto-updater
		stopServer()
		stopAutoUpdater()
		if (process.platform !== "darwin") app.quit()
	})
}
