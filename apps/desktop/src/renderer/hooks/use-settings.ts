import { useCallback, useEffect, useState } from "react"
import type { AppSettings } from "../../preload/api"
import { DEFAULT_SERVER_SETTINGS } from "../../shared/server-config"
import { DEFAULT_TRUST_SETTINGS } from "../../shared/trust"

const isElectron = typeof window !== "undefined" && "palot" in window

const DEFAULT_SETTINGS: AppSettings = {
	notifications: {
		completionMode: "unfocused",
		permissions: true,
		questions: true,
		errors: true,
		dockBadge: true,
	},
	opaqueWindows: false,
	servers: DEFAULT_SERVER_SETTINGS,
	trust: DEFAULT_TRUST_SETTINGS,
}

export function useSettings() {
	const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
	const [loading, setLoading] = useState(true)

	useEffect(() => {
		if (!isElectron) {
			setLoading(false)
			return
		}
		window.palot
			.getSettings()
			.then((s) => {
				setSettings(s as AppSettings)
			})
			.catch((err) => {
				console.error("Failed to load settings:", err)
			})
			.finally(() => {
				setLoading(false)
			})
	}, [])

	// Listen for settings changes pushed from the main process.
	// This ensures the renderer stays in sync if settings change externally
	// (e.g. notification action buttons update a setting from the main process).
	useEffect(() => {
		if (!isElectron) return
		return window.palot.onSettingsChanged((updated) => {
			setSettings(updated)
		})
	}, [])

	const updateSettings = useCallback(
		async (partial: Record<string, unknown>) => {
			if (!isElectron) return
			const prev = settings
			try {
				const updated = (await window.palot.updateSettings(partial)) as AppSettings
				setSettings(updated)
			} catch (err) {
				console.error("Failed to update settings:", err)
				setSettings(prev)
			}
		},
		[settings],
	)

	return { settings, loading, updateSettings }
}
