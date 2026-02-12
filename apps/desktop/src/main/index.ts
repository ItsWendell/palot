import { execSync } from "node:child_process"
import path from "node:path"
import { app, BrowserWindow, Menu, session, shell } from "electron"
import { getOpaqueWindowsPref, registerIpcHandlers } from "./ipc-handlers"
import { installLiquidGlass, resolveWindowChrome } from "./liquid-glass"
import { createLogger } from "./logger"
import { stopServer } from "./opencode-manager"
import { initSettingsStore } from "./settings-store"
import { fixProcessEnv } from "./shell-env"
import { createTray, destroyTray } from "./tray"
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

// Collect Chromium feature flags — must be merged into a single --disable-features
// switch because Electron's appendSwitch overwrites (not appends) duplicate keys.
const disabledFeatures: string[] = []

// Chromium networking: disable HTTPS upgrades for localhost connections.
// The OpenCode server is plain HTTP/1.1 on 127.0.0.1. Chromium 134+ (Electron 40+)
// can silently upgrade http:// to https://, which causes ERR_ALPN_NEGOTIATION_FAILED
// when hitting a plain HTTP server. Disabling this feature prevents that.
// Must be set before app.whenReady().
disabledFeatures.push("HttpsUpgrades")
app.commandLine.appendSwitch("allow-insecure-localhost")

// Linux/Wayland: enable native Wayland rendering and fix fractional scaling.
// These flags must be set before app.whenReady().
if (process.platform === "linux") {
	app.commandLine.appendSwitch("ozone-platform-hint", "auto")
	app.commandLine.appendSwitch("enable-features", "WaylandWindowDecorations")
	app.commandLine.appendSwitch("enable-wayland-ime")
	app.commandLine.appendSwitch("font-render-hinting", "slight")

	// Chromium's WaylandFractionalScaleV1 has a known bug where non-maximized
	// windows render at 1x and the compositor upscales them, causing blurry text
	// and UI (Chromium issue 40934705). Work around this by detecting the GNOME
	// fractional scale factor via Mutter's D-Bus API and forcing it explicitly.
	// This runs synchronously before app.whenReady() since command-line switches
	// must be set early. Falls back gracefully if detection fails (non-GNOME, X11).
	if (process.env.WAYLAND_DISPLAY || process.env.XDG_SESSION_TYPE === "wayland") {
		try {
			const dbusOutput = execSync(
				"gdbus call --session --dest org.gnome.Mutter.DisplayConfig " +
					"--object-path /org/gnome/Mutter/DisplayConfig " +
					"--method org.gnome.Mutter.DisplayConfig.GetCurrentState",
				{ timeout: 2000, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] },
			)
			// Logical monitors section contains: (x, y, scale, uint32 transform, bool primary, ...)
			const match = dbusOutput.match(/\(\d+,\s*\d+,\s*([\d.]+),\s*uint32\s+\d+,\s*true/)
			if (match) {
				const scale = Number.parseFloat(match[1])
				if (scale > 0 && scale !== Math.floor(scale)) {
					// Fractional scale detected — disable the buggy Wayland fractional
					// scale protocol and force the correct DPI scale factor directly.
					disabledFeatures.push("WaylandFractionalScaleV1")
					app.commandLine.appendSwitch("force-device-scale-factor", scale.toString())
					log.info(`Wayland fractional scale detected (${scale}), forcing device scale factor`)
				}
			}
		} catch {
			// D-Bus call failed (not GNOME, not Wayland, or timeout) — ignore.
			// Chromium's default Wayland scaling will be used.
		}
	}
}

// Apply all collected disabled features as a single comma-separated switch.
if (disabledFeatures.length > 0) {
	app.commandLine.appendSwitch("disable-features", disabledFeatures.join(","))
}

const isDev = !app.isPackaged

// Use a separate identity for dev so dev and production can run side-by-side.
// The single-instance lock and user-data directory are both keyed on app name,
// so changing it here prevents the two from conflicting.
if (isDev) {
	app.setName("Palot Dev")
	app.setPath("userData", path.join(app.getPath("appData"), "Palot Dev"))
}

async function createWindow(): Promise<BrowserWindow> {
	const title = isDev ? "Palot (Dev)" : "Palot"

	const isMac = process.platform === "darwin"

	// Resolve window chrome tier: liquid glass > vibrancy > opaque
	const isOpaque = getOpaqueWindowsPref()
	const chrome = await resolveWindowChrome(isOpaque)

	const win = new BrowserWindow({
		title,
		width: 1200,
		height: 800,
		minWidth: 900,
		minHeight: 600,
		// Fully transparent background — required for glass/vibrancy to show through
		backgroundColor: "#00000000",
		// Three-tier window chrome — options from resolveWindowChrome()
		...chrome.options,
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

	// Install liquid glass effect after window creation (tier 1 only)
	if (chrome.tier === "liquid-glass") {
		await installLiquidGlass(win, isOpaque)
	}

	// Notify the renderer which chrome tier is active so it can adapt CSS
	win.webContents.once("did-finish-load", () => {
		win.webContents.send("chrome-tier", chrome.tier)
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

	// Workaround: transparent/vibrancy windows on macOS lose click interactivity
	// after DevTools are toggled (Electron recomposites the window and marks
	// transparent regions as click-through). Force detached mode and re-assert
	// mouse events on every DevTools open/close cycle.
	if (process.platform === "darwin") {
		const fixClickThrough = () => {
			win.setIgnoreMouseEvents(false)
		}
		win.webContents.on("devtools-opened", fixClickThrough)
		win.webContents.on("devtools-closed", fixClickThrough)
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

		initSettingsStore()
		registerIpcHandlers()
		createWindow()
		createTray(() => BrowserWindow.getAllWindows()[0])
		initAutoUpdater().catch(console.error)

		app.on("activate", () => {
			if (BrowserWindow.getAllWindows().length === 0) createWindow()
		})
	})

	app.on("window-all-closed", () => {
		// Clean up the managed opencode server, tray, and auto-updater
		destroyTray()
		stopServer()
		stopAutoUpdater()
		if (process.platform !== "darwin") app.quit()
	})
}
