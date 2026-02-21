import { execSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { app, BrowserWindow, Menu, session, shell } from "electron"
import { initAutomations, shutdownAutomations } from "./automation"
import { initCredentialStore } from "./credential-store"
import { getOpaqueWindowsPref, registerIpcHandlers } from "./ipc-handlers"
import { installLiquidGlass, resolveWindowChrome } from "./liquid-glass"
import { createLogger } from "./logger"
import { startMdnsScanner, stopMdnsScanner } from "./mdns-scanner"
import { stopServer } from "./opencode-manager"
import { initSettingsStore } from "./settings-store"
import { startEnvResolution } from "./shell-env"
import { createTray, destroyTray } from "./tray"
import { initAutoUpdater, stopAutoUpdater } from "./updater"

const log = createLogger("app")

// ESM equivalent for __dirname
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Start resolving the shell environment asynchronously. On macOS/Linux, Electron
// GUI launches get a minimal launchd environment missing user PATH additions
// (homebrew, nvm, bun, etc.). This spawns a login shell in the background --
// window creation proceeds immediately without waiting. Operations that need the
// full PATH (e.g., spawning opencode) call waitForEnv() before proceeding.
startEnvResolution()

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

// Linux/Wayland: ensure GTK can find the GdkPixbuf loader modules and enable
// native Wayland rendering. These must be set before app.whenReady() since GTK
// initializes during that call.
if (process.platform === "linux") {
	// GTK needs the GdkPixbuf loaders cache to decode PNG/SVG icons from the
	// icon theme. Electron's bundled Chromium often can't locate the host system's
	// loaders, causing "Could not load a pixbuf from icon theme" warnings and
	// continuous GDK_IS_PIXBUF assertion failures — especially visible on Wayland
	// where GTK renders client-side window decorations (close/minimize/maximize
	// button icons are loaded from the theme on every frame).
	if (!process.env.GDK_PIXBUF_MODULE_FILE) {
		let loadersCachePath: string | undefined

		// Try pkg-config first — works across distros regardless of lib path layout
		try {
			loadersCachePath = execSync(
				"pkg-config --variable gdk_pixbuf_cache_file gdk-pixbuf-2.0",
				{ encoding: "utf-8", timeout: 1000, stdio: ["ignore", "pipe", "ignore"] },
			).trim()
		} catch {
			// pkg-config not installed or gdk-pixbuf-2.0 not registered — try known paths
		}

		if (!loadersCachePath || !fs.existsSync(loadersCachePath)) {
			const candidates = [
				"/usr/lib64/gdk-pixbuf-2.0/2.10.0/loaders.cache", // Fedora, RHEL, openSUSE
				"/usr/lib/x86_64-linux-gnu/gdk-pixbuf-2.0/2.10.0/loaders.cache", // Debian, Ubuntu
				"/usr/lib/gdk-pixbuf-2.0/2.10.0/loaders.cache", // Arch
			]
			loadersCachePath = candidates.find((p) => fs.existsSync(p))
		}

		if (loadersCachePath) {
			process.env.GDK_PIXBUF_MODULE_FILE = loadersCachePath
			log.info(`Set GDK_PIXBUF_MODULE_FILE=${loadersCachePath}`)
		}
	}

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

// Enable Chrome DevTools Protocol (CDP) in dev mode so external tools
// (agent-browser, Playwright, etc.) can connect for visual testing.
// Usage: `agent-browser connect 9222` or Playwright's `connectOverCDP`.
if (isDev) {
	app.commandLine.appendSwitch("remote-debugging-port", "9222")
}

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

	// Resolve the window icon for Linux/Windows. macOS uses the .app bundle icon.
	// Linux: use 256x256 icon — GTK's GdkPixbuf can choke on the full 1024x1024
	// icon on Wayland, causing GDK_IS_PIXBUF assertion failures.
	const windowIcon = isMac
		? undefined
		: app.isPackaged
			? path.join(process.resourcesPath, "icon.png")
			: path.join(
					__dirname,
					process.platform === "linux"
						? "../../resources/linux-icons/256x256.png"
						: "../../resources/icon.png",
				)

	const win = new BrowserWindow({
		title,
		width: 1200,
		height: 800,
		minWidth: 900,
		minHeight: 600,
		// Transparent background for macOS glass/vibrancy tiers.
		// On Linux/Windows (always opaque tier) use a solid background to prevent
		// the window from being see-through while the renderer loads.
		backgroundColor: isMac ? "#00000000" : "#000000",
		// Don't show the window until the renderer has painted its first frame.
		// Prevents a flash of transparent/empty content, especially on Wayland.
		show: false,
		// Three-tier window chrome — options from resolveWindowChrome()
		...chrome.options,
		// Window icon for Linux/Windows
		...(windowIcon && { icon: windowIcon }),
		webPreferences: {
			preload: path.join(__dirname, "../preload/index.cjs"),
			contextIsolation: true,
			sandbox: true,
			nodeIntegration: false,
			spellcheck: false,
			v8CacheOptions: "bypassHeatCheckAndEagerCompile",
		},
	})

	// Show the window once the renderer has painted — avoids a flash of
	// transparent/blank content while the page loads.
	win.once("ready-to-show", () => {
		win.show()
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
		initCredentialStore()
		registerIpcHandlers()
		initAutomations().catch(console.error)
		startMdnsScanner().catch((err) => log.warn("mDNS scanner failed to start", err))
		createWindow()
		createTray(() => BrowserWindow.getAllWindows()[0])
		initAutoUpdater().catch(console.error)

		app.on("activate", () => {
			if (BrowserWindow.getAllWindows().length === 0) createWindow()
		})
	})

	// On macOS, closing all windows keeps the app alive (dock/tray). The server
	// and background services (automations, mDNS) continue running so agents
	// can finish their work. On other platforms, closing all windows quits.
	app.on("window-all-closed", () => {
		if (process.platform !== "darwin") app.quit()
	})

	// All cleanup happens here, triggered by Cmd+Q, Dock > Quit, app.quit(),
	// or system-initiated quit (macOS logout SIGTERM). This is the single
	// source of truth for teardown -- stopServer() etc. are idempotent.
	app.on("before-quit", () => {
		destroyTray()
		shutdownAutomations()
		stopMdnsScanner()
		stopServer()
		stopAutoUpdater()
	})
}
