import { useEffect } from "react"
import { createLogger } from "../lib/logger"
import { fetchDiscovery, fetchOpenCodeUrl } from "../services/backend"
import { connectToOpenCode, loadProjectSessions } from "../services/connection-manager"
import { useAppStore } from "../stores/app-store"

const log = createLogger("discovery")

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
				log.info("Starting discovery...")
				const discoveryData = await fetchDiscovery()
				log.info("Discovered projects", {
					projects: discoveryData.projects.length,
					sessionGroups: Object.keys(discoveryData.sessions).length,
				})
				setResult(discoveryData.projects, discoveryData.sessions)

				// 2. Ensure the single OpenCode server is running
				log.info("Ensuring OpenCode server is running...")
				const { url } = await fetchOpenCodeUrl()

				// 3. Connect to the single server (starts SSE)
				log.info("Connecting to OpenCode server", { url })
				await connectToOpenCode(url)

				// 4. Load live sessions for all discovered projects in parallel
				const directories = new Set<string>()
				for (const project of discoveryData.projects) {
					if (project.id === "global") {
						// Global project: load by each session's actual directory
						const sessions = discoveryData.sessions[project.id] ?? []
						for (const s of sessions) {
							if (s.directory) directories.add(s.directory)
						}
					} else {
						directories.add(project.worktree)
					}
				}
				const results = await Promise.allSettled(
					[...directories].map((dir) => loadProjectSessions(dir)),
				)
				const failed = results.filter((r) => r.status === "rejected")
				if (failed.length > 0) {
					log.warn("Some project session loads failed", {
						total: directories.size,
						failed: failed.length,
					})
				}

				log.info("Discovery complete", {
					url,
					projects: directories.size,
				})
			} catch (err) {
				log.error("Discovery failed", err)
				setError(err instanceof Error ? err.message : "Discovery failed")
			}
		})()
	}, [loaded, loading, setLoading, setResult, setError])
}
