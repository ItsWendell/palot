import { useCallback, useEffect, useState } from "react"
import type { UpdateState } from "../../preload/api"
import { isElectron } from "../services/backend"

const defaultState: UpdateState = { status: "idle" }

/**
 * Hook that tracks the auto-updater state from the main process.
 * Subscribes to push events via the preload bridge and provides
 * action helpers for check / download / install.
 *
 * In browser mode (non-Electron), always returns idle state and no-op actions.
 */
export function useUpdater() {
	const [state, setState] = useState<UpdateState>(defaultState)

	// Fetch initial state and subscribe to changes
	useEffect(() => {
		if (!isElectron) return

		// Get current state on mount
		window.codedeck
			.getUpdateState()
			.then(setState)
			.catch(() => {})

		// Subscribe to state changes pushed from main process
		const unsubscribe = window.codedeck.onUpdateStateChanged((newState) => {
			setState(newState)
		})

		return unsubscribe
	}, [])

	const checkForUpdates = useCallback(async () => {
		if (!isElectron) return
		await window.codedeck.checkForUpdates()
	}, [])

	const downloadUpdate = useCallback(async () => {
		if (!isElectron) return
		await window.codedeck.downloadUpdate()
	}, [])

	const installUpdate = useCallback(() => {
		if (!isElectron) return
		window.codedeck.installUpdate()
	}, [])

	return {
		...state,
		checkForUpdates,
		downloadUpdate,
		installUpdate,
	}
}
