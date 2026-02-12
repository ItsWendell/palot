import { useAtomValue } from "jotai"
import { useEffect } from "react"
import { discoveryAtom } from "../atoms/discovery"
import { isMockModeAtom } from "../atoms/mock-mode"
import { appStore } from "../atoms/store"
import { createLogger } from "../lib/logger"
import { fetchDiscovery, fetchOpenCodeUrl } from "../services/backend"
import { connectToOpenCode, loadProjectSessions } from "../services/connection-manager"

const log = createLogger("discovery")

// Module-level guard to prevent concurrent discovery runs.
// The Jotai atom guard (loaded/loading) depends on a React re-render
// to propagate, which can race with React Strict Mode double-effects
// or fast re-mounts.
let discoveryInFlight = false

/** Reset the discovery guard so discovery can re-run (used when exiting mock mode). */
export function resetDiscoveryGuard(): void {
	discoveryInFlight = false
}

/**
 * On mount:
 * 1. Fetches discovered projects/sessions from disk (via Palot server)
 * 2. Ensures the single OpenCode server is running (via Palot backend)
 * 3. Connects to the OpenCode server (SSE events for all projects)
 * 4. Loads live sessions for all discovered projects
 */
export function useDiscovery() {
	const discovery = useAtomValue(discoveryAtom)
	const isMockMode = useAtomValue(isMockModeAtom)
	const { loaded, loading } = discovery

	useEffect(() => {
		// In mock mode, atoms are hydrated by useMockMode() -- skip real discovery
		if (isMockMode) return
		if (loaded || loading || discoveryInFlight) return
		discoveryInFlight = true

		// Set loading
		appStore.set(discoveryAtom, (prev) => ({
			...prev,
			loading: true,
			error: null,
		}))

		;(async () => {
			try {
				log.info("Starting discovery...")
				const discoveryData = await fetchDiscovery()
				log.info("Discovered projects", {
					projects: discoveryData.projects.length,
					sessionGroups: Object.keys(discoveryData.sessions).length,
				})
				appStore.set(discoveryAtom, {
					loaded: true,
					loading: false,
					error: null,
					projects: discoveryData.projects,
					sessions: discoveryData.sessions,
				})

				log.info("Ensuring OpenCode server is running...")
				const { url } = await fetchOpenCodeUrl()

				log.info("Connecting to OpenCode server", { url })
				await connectToOpenCode(url)

				const directories = new Set<string>()
				for (const project of discoveryData.projects) {
					if (project.id === "global") {
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
				discoveryInFlight = false
				appStore.set(discoveryAtom, (prev) => ({
					...prev,
					loading: false,
					error: err instanceof Error ? err.message : "Discovery failed",
				}))
			}
		})()
	}, [loaded, loading, isMockMode])
}
