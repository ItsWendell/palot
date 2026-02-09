import path from "node:path"
import { app, BrowserWindow, Menu, session, shell } from "electron"
import { registerIpcHandlers } from "./ipc-handlers"
import { createLogger } from "./logger"
import { stopServer } from "./opencode-manager"
import { fixProcessEnv } from "./shell-env"
import { initAutoUpdater, stopAutoUpdater } from "./updater"

const log = createLogger("app")

// Fix process.env early — Electron GUI launches on macOS/Linux get a minimal
// launchd environment missing user PATH additions (homebrew, nvm, bun, etc.).
// This spawns a login shell once to capture the real environment.
fixProcessEnv()

// Minimal menu — required on macOS for Cmd+C/V/X/A to work in web contents.
// A null menu kills native Edit shortcuts on macOS. This minimal template is
// negligible overhead compared to the full default menu.
const menuTemplate: Electron.MenuItemConstructorOptions[] = [
	...(process.platform === "darwin" ? [{ role: "appMenu" as const }] : []),
	{ role: "editMenu" as const },
	{ role: "viewMenu" as const },
	{ role: "windowMenu" as const },
]
Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate))

// Chromium networking: disable HTTPS upgrades and HTTP/2 for localhost connections.
// The OpenCode server is plain HTTP/1.1 on 127.0.0.1. Chromium 134+ (Electron 40+)
// can silently upgrade http:// to https://, which causes ERR_ALPN_NEGOTIATION_FAILED
// when hitting a plain HTTP server. Disabling these features prevents that.
// Must be set before app.whenReady().
app.commandLine.appendSwitch("disable-features", "HttpsUpgrades")
app.commandLine.appendSwitch("allow-insecure-localhost")

// Linux/Wayland: enable native Wayland rendering to avoid blurry XWayland scaling.
// These flags must be set before app.whenReady().
if (process.platform === "linux") {
	app.commandLine.appendSwitch("ozone-platform-hint", "auto")
	app.commandLine.appendSwitch("enable-features", "WaylandWindowDecorations")
	app.commandLine.appendSwitch("enable-wayland-ime")
}

const isDev = !app.isPackaged

// Use a separate identity for dev so dev and production can run side-by-side.
// The single-instance lock and user-data directory are both keyed on app name,
// so changing it here prevents the two from conflicting.
if (isDev) {
	app.setName("Codedeck Dev")
	app.setPath("userData", path.join(app.getPath("appData"), "Codedeck Dev"))
}

function createWindow(): BrowserWindow {
	const title = isDev ? "Codedeck (Dev)" : "Codedeck"

	const isMac = process.platform === "darwin"

	const win = new BrowserWindow({
		title,
		width: 1200,
		height: 800,
		minWidth: 900,
		minHeight: 600,
		// macOS: use custom title bar with hidden inset for a native-like app bar.
		// Traffic lights are repositioned to align with our custom header.
		...(isMac && {
			titleBarStyle: "hiddenInset",
			trafficLightPosition: { x: 15, y: 15 },
		}),
		// Set window icon for dev mode on Linux/Windows (macOS uses the .app bundle icon)
		...(!isMac && {
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

	// In dev mode, ensure the window title always shows "(Dev)" suffix
	if (isDev) {
		win.on("page-title-updated", (event, pageTitle) => {
			if (!pageTitle.includes("(Dev)")) {
				event.preventDefault()
				win.setTitle(`${pageTitle} (Dev)`)
			}
		})
	}

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
		// Bypass Chromium's Private Network Access checks for OpenCode server requests.
		// Chromium (134+/Electron 40+) blocks renderer fetch() to private network addresses
		// (127.0.0.1) with ERR_ALPN_NEGOTIATION_FAILED when the PNA preflight response
		// doesn't include Access-Control-Allow-Private-Network. The OpenCode server (Bun/Hono)
		// doesn't send this header. Instead of patching the server, we inject the header
		// for all responses from the local server.
		session.defaultSession.webRequest.onHeadersReceived(
			{ urls: ["http://127.0.0.1:*/*"] },
			(details, callback) => {
				callback({
					responseHeaders: {
						...details.responseHeaders,
						"Access-Control-Allow-Private-Network": ["true"],
					},
				})
			},
		)
		log.info("Registered PNA header injection for 127.0.0.1 requests")

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
