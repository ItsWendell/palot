/**
 * Hook for managing server configurations.
 *
 * Syncs the server list and active server from AppSettings into Jotai atoms,
 * and provides actions for adding, editing, removing, and switching servers.
 */

import { useAtomValue, useSetAtom } from "jotai"
import { useCallback, useEffect } from "react"
import type { DiscoveredMdnsServer, RemoteServerConfig, ServerConfig } from "../../preload/api"
import { DEFAULT_LOCAL_SERVER } from "../../shared/server-config"
import {
	activeServerConfigAtom,
	activeServerIdAtom,
	discoveredMdnsServersAtom,
	serversAtom,
} from "../atoms/connection"
import { discoveryAtom } from "../atoms/discovery"
import { sessionIdsAtom } from "../atoms/sessions"
import { appStore } from "../atoms/store"
import { createLogger } from "../lib/logger"
import { isElectron } from "../services/backend"
import { disconnect } from "../services/connection-manager"
import { resetDiscoveryGuard } from "./use-discovery"

const log = createLogger("use-servers")

/**
 * Syncs server settings from the main process settings store into Jotai atoms.
 * Should be called once near the root of the app.
 */
export function useServerSettingsSync() {
	const setServers = useSetAtom(serversAtom)
	const setActiveServerId = useSetAtom(activeServerIdAtom)
	const setDiscoveredMdns = useSetAtom(discoveredMdnsServersAtom)

	useEffect(() => {
		if (!isElectron) return

		// Load initial settings
		window.palot.getSettings().then((settings) => {
			if (settings.servers) {
				setServers(settings.servers.servers)
				setActiveServerId(settings.servers.activeServerId)
			}
		})

		// Subscribe to settings changes
		const unsub = window.palot.onSettingsChanged((settings) => {
			const s = settings as { servers?: { servers: ServerConfig[]; activeServerId: string } }
			if (s.servers) {
				setServers(s.servers.servers)
				setActiveServerId(s.servers.activeServerId)
			}
		})
		return unsub
	}, [setServers, setActiveServerId])

	// --- mDNS discovery sync ---
	useEffect(() => {
		if (!isElectron) return

		// Load current snapshot
		window.palot.mdns.getDiscovered().then((servers) => {
			setDiscoveredMdns(servers as DiscoveredMdnsServer[])
		})

		// Subscribe to live updates
		const unsub = window.palot.mdns.onChanged((servers) => {
			setDiscoveredMdns(servers as DiscoveredMdnsServer[])
		})
		return unsub
	}, [setDiscoveredMdns])
}

/**
 * Returns the list of configured servers, discovered servers, and the active server.
 */
export function useServers() {
	const servers = useAtomValue(serversAtom)
	const activeServer = useAtomValue(activeServerConfigAtom)
	const discoveredMdns = useAtomValue(discoveredMdnsServersAtom)
	return { servers, activeServer, discoveredMdns }
}

/**
 * Returns actions for managing servers.
 */
export function useServerActions() {
	const addServer = useCallback(async (server: RemoteServerConfig, password?: string) => {
		if (!isElectron) return

		// Store password securely if provided
		if (password) {
			await window.palot.credential.store(server.id, password)
		}

		const settings = await window.palot.getSettings()
		const currentServers = settings.servers?.servers ?? [DEFAULT_LOCAL_SERVER]

		await window.palot.updateSettings({
			servers: {
				servers: [...currentServers, { ...server, hasPassword: !!password }],
				activeServerId: settings.servers?.activeServerId ?? "local",
			},
		})
		log.info("Server added", { id: server.id, name: server.name })
	}, [])

	const updateServer = useCallback(
		async (serverId: string, updates: Partial<RemoteServerConfig>, password?: string | null) => {
			if (!isElectron) return

			// Update password if provided, delete if explicitly set to null
			if (password !== undefined) {
				if (password === null) {
					await window.palot.credential.delete(serverId)
				} else {
					await window.palot.credential.store(serverId, password)
				}
			}

			const settings = await window.palot.getSettings()
			const currentServers = settings.servers?.servers ?? [DEFAULT_LOCAL_SERVER]

			const updatedServers = currentServers.map((s) => {
				if (s.id !== serverId) return s
				return {
					...s,
					...updates,
					hasPassword:
						password === null ? false : password ? true : (s as RemoteServerConfig).hasPassword,
				}
			})

			await window.palot.updateSettings({
				servers: {
					servers: updatedServers,
					activeServerId: settings.servers?.activeServerId ?? "local",
				},
			})
			log.info("Server updated", { id: serverId })
		},
		[],
	)

	const removeServer = useCallback(async (serverId: string) => {
		if (!isElectron || serverId === "local") return

		// Delete stored credential
		await window.palot.credential.delete(serverId)

		const settings = await window.palot.getSettings()
		const currentServers = settings.servers?.servers ?? [DEFAULT_LOCAL_SERVER]

		const filteredServers = currentServers.filter((s) => s.id !== serverId)
		const activeId = settings.servers?.activeServerId
		const newActiveId = activeId === serverId ? "local" : activeId

		await window.palot.updateSettings({
			servers: {
				servers: filteredServers,
				activeServerId: newActiveId ?? "local",
			},
		})

		// If the removed server was active, trigger reconnection to local
		if (activeId === serverId) {
			triggerServerSwitch(newActiveId ?? "local")
		}

		log.info("Server removed", { id: serverId })
	}, [])

	const switchServer = useCallback(async (serverId: string) => {
		if (!isElectron) return

		const settings = await window.palot.getSettings()
		if (settings.servers?.activeServerId === serverId) return

		await window.palot.updateSettings({
			servers: {
				...settings.servers,
				servers: settings.servers?.servers ?? [DEFAULT_LOCAL_SERVER],
				activeServerId: serverId,
			},
		})

		triggerServerSwitch(serverId)
		log.info("Switched to server", { id: serverId })
	}, [])

	const testConnection = useCallback(
		async (url: string, username?: string, password?: string): Promise<string | null> => {
			if (!isElectron) return "Not running in Electron"
			return window.palot.testServerConnection(url, username, password)
		},
		[],
	)

	const saveDiscoveredServer = useCallback(
		async (mdnsServer: DiscoveredMdnsServer, password?: string) => {
			if (!isElectron) return

			// Build URL from mDNS data. Prefer a real IP address over the .local hostname.
			const resolvedHost = mdnsServer.addresses.find((a) => !a.includes(":")) || mdnsServer.host
			const url = `http://${resolvedHost}:${mdnsServer.port}`

			const id = `remote-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
			const server: RemoteServerConfig = {
				id,
				name: mdnsServer.name,
				type: "remote",
				url,
				hasPassword: !!password,
			}

			await addServer(server, password)
			log.info("Saved discovered server", { id, name: mdnsServer.name, url })
		},
		[addServer],
	)

	return {
		addServer,
		updateServer,
		removeServer,
		switchServer,
		testConnection,
		saveDiscoveredServer,
	}
}

// ============================================================
// Internal helpers
// ============================================================

/**
 * Disconnects from the current server and resets discovery so the app
 * reconnects to the newly active server on the next render cycle.
 *
 * Crucially, sets `activeServerIdAtom` synchronously so that the very
 * first React render after this call already has the correct server.
 * Without this, discovery would race against the async `onSettingsChanged`
 * IPC event and could run against the old (offline) server.
 */
function triggerServerSwitch(newActiveServerId: string) {
	disconnect()
	resetDiscoveryGuard()

	// Clear all session data from the previous server
	appStore.set(sessionIdsAtom, new Set<string>())

	// Point to the new server BEFORE resetting discovery, so the
	// discovery effect always sees the correct activeServer.
	appStore.set(activeServerIdAtom, newActiveServerId)

	// Reset discovery so it re-runs with the new server
	appStore.set(discoveryAtom, {
		loaded: false,
		loading: false,
		error: null,
		projects: [],
	})
}
