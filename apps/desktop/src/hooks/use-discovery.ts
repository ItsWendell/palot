import { useEffect } from "react"
import { fetchDiscovery, fetchServers } from "../services/codedeck-server"
import { connectAndSubscribe } from "../services/connection-manager"
import { useAppStore } from "../stores/app-store"

/**
 * On mount:
 * 1. Fetches discovered projects/sessions from disk (via Codedeck server)
 * 2. Detects running OpenCode servers
 * 3. Auto-connects to all running servers for live status + SSE events
 *
 * Only runs once — subsequent calls are no-ops if already loaded.
 */
export function useDiscovery() {
	const loaded = useAppStore((s) => s.discovery.loaded)
	const loading = useAppStore((s) => s.discovery.loading)
	const setLoading = useAppStore((s) => s.setDiscoveryLoading)
	const setResult = useAppStore((s) => s.setDiscoveryResult)
	const setError = useAppStore((s) => s.setDiscoveryError)

	useEffect(() => {
		if (loaded || loading) return

		setLoading()

		Promise.all([fetchDiscovery(), fetchServers()])
			.then(async ([discoveryData, serversData]) => {
				// Store discovered projects/sessions
				setResult(discoveryData.projects, discoveryData.sessions)

				// Auto-connect to each running OpenCode server
				for (const server of serversData.servers) {
					try {
						await connectAndSubscribe(server.id, server.url, server.directory)
						console.log(`Auto-connected to ${server.name} at ${server.url}`)
					} catch (err) {
						console.error(`Failed to connect to ${server.name}:`, err)
					}
				}
			})
			.catch((err) => {
				console.error("Discovery failed:", err)
				setError(err instanceof Error ? err.message : "Discovery failed")
			})
	}, [loaded, loading, setLoading, setResult, setError])
}
