import { useEffect } from "react"
import { fetchDiscovery, fetchOpenCodeUrl } from "../services/codedeck-server"
import { connectToOpenCode, loadProjectSessions } from "../services/connection-manager"
import { useAppStore } from "../stores/app-store"

/**
 * On mount:
 * 1. Fetches discovered projects/sessions from disk (via Codedeck server)
 * 2. Ensures the single OpenCode server is running (via Codedeck backend)
 * 3. Connects to the OpenCode server (SSE events for all projects)
 * 4. Loads live sessions for all discovered projects
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

		;(async () => {
			try {
				// 1. Discover projects/sessions from disk
				const discoveryData = await fetchDiscovery()
				setResult(discoveryData.projects, discoveryData.sessions)

				// 2. Ensure the single OpenCode server is running
				const { url } = await fetchOpenCodeUrl()

				// 3. Connect to the single server (starts SSE)
				await connectToOpenCode(url)

				// 4. Load live sessions for all discovered projects in parallel
				const directories = discoveryData.projects.map((p) => p.worktree)
				await Promise.allSettled(directories.map((dir) => loadProjectSessions(dir)))

				console.log(
					`Connected to OpenCode at ${url}, loaded sessions for ${directories.length} projects`,
				)
			} catch (err) {
				console.error("Discovery failed:", err)
				setError(err instanceof Error ? err.message : "Discovery failed")
			}
		})()
	}, [loaded, loading, setLoading, setResult, setError])
}
