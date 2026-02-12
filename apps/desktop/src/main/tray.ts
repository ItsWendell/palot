/**
 * System tray icon for Palot.
 *
 * On macOS, uses template images (iconTemplate.png / iconTemplate@2x.png) which
 * automatically adapt to the menu bar appearance (light/dark, Liquid Glass on Tahoe).
 * On Linux/Windows, uses the full-color app icon.
 */
import path from "node:path"
import { app, type BrowserWindow, Menu, nativeImage, Tray } from "electron"
import { createLogger } from "./logger"

const log = createLogger("tray")

let tray: Tray | null = null

export function createTray(getWindow: () => BrowserWindow | undefined): void {
	if (tray) return

	const isMac = process.platform === "darwin"
	// In dev: __dirname is out/main/, resources is at ../../resources/
	// In packaged: buildResources contents are copied to process.resourcesPath
	const resourcesPath = app.isPackaged
		? process.resourcesPath
		: path.join(__dirname, "../../resources")

	let icon: Electron.NativeImage

	if (isMac) {
		// macOS: use template images for proper menu bar integration.
		// Electron auto-detects the "Template" suffix and sets isTemplate = true.
		// It also auto-discovers the @2x variant in the same directory.
		const templatePath = path.join(resourcesPath, "iconTemplate.png")
		icon = nativeImage.createFromPath(templatePath)
		icon.setTemplateImage(true)
	} else {
		// Linux/Windows: use the full-color app icon
		const iconPath = path.join(resourcesPath, "icon.png")
		icon = nativeImage.createFromPath(iconPath)
	}

	tray = new Tray(icon)
	tray.setToolTip("Palot")

	const contextMenu = Menu.buildFromTemplate([
		{
			label: "Show Palot",
			click: () => {
				const win = getWindow()
				if (win) {
					if (win.isMinimized()) win.restore()
					win.show()
					win.focus()
				}
			},
		},
		{ type: "separator" },
		{
			label: "Quit",
			click: () => {
				app.quit()
			},
		},
	])

	tray.setContextMenu(contextMenu)

	tray.on("click", () => {
		const win = getWindow()
		if (win) {
			if (win.isMinimized()) win.restore()
			win.show()
			win.focus()
		}
	})

	log.info(`Tray created (template: ${isMac})`)
}

export function destroyTray(): void {
	if (tray) {
		tray.destroy()
		tray = null
	}
}
