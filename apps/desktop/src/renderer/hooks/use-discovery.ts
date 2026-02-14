import { useAtomValue } from "jotai"
import { useEffect } from "react"
import { activeServerConfigAtom } from "../atoms/connection"
import { discoveryAtom } from "../atoms/discovery"
import { isMockModeAtom } from "../atoms/mock-mode"
import { appStore } from "../atoms/store"
import { createLogger } from "../lib/logger"
import { resolveAuthHeader, resolveServerUrl } from "../services/backend"
import {
	connectToOpenCode,
	loadAllProjects,
	loadProjectSessions,
} from "../services/connection-manager"

const log = createLogger("discovery")

// Module-level guard to prevent concurrent discovery runs.
// The Jotai atom guard (loaded/loading) depends on a React re-render
// to propagate, which can race with React Strict Mode double-effects
// or fast re-mounts.
let discoveryInFlight = false

/** Reset the discovery guard so discovery can re-run (used when switching servers or exiting mock mode). */
export function resetDiscoveryGuard(): void {
	discoveryInFlight = false
}

/**
 * API-first discovery hook.
 *
 * On mount:
 * 1. Resolves the active server URL (spawns local or uses remote URL)
 * 2. Resolves auth credentials if the server requires them
 * 3. Connects to the OpenCode server (SSE events for all projects)
 * 4. Lists all projects from the API via `client.project.list()`
 * 5. Loads live sessions for each discovered project directory
 */
export function useDiscovery() {
	const discovery = useAtomValue(discoveryAtom)
	const isMockMode = useAtomValue(isMockModeAtom)
	const activeServer = useAtomValue(activeServerConfigAtom)
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
				// --- Step 1: Resolve the server URL ---
				log.info("Resolving server URL...", {
					server: activeServer.name,
					type: activeServer.type,
				})
				const url = await resolveServerUrl(activeServer)

				// --- Step 2: Resolve auth if needed ---
				const authHeader = await resolveAuthHeader(activeServer)

				// --- Step 3: Connect to the server (starts SSE event loop) ---
				log.info("Connecting to OpenCode server", {
					url,
					server: activeServer.name,
					authenticated: !!authHeader,
				})
				await connectToOpenCode(url, authHeader)

				// --- Step 4: Discover projects from the API ---
				log.info("Loading projects from API...")
				const projects = await loadAllProjects()
				log.info("Discovered projects via API", { count: projects.length })

				// Store projects in discovery atom
				appStore.set(discoveryAtom, {
					loaded: true,
					loading: false,
					error: null,
					projects,
				})

				// --- Step 5: Load live sessions for each project directory ---
				// Collect sandbox directories per project so we can:
				// 1. Pass them to setSessionsAtom to restore worktreePath on reload
				// 2. Also load sessions FROM sandbox dirs (worktree instances may
				//    resolve to a different project ID, so their sessions won't
				//    appear when querying from the parent directory alone)
				const allSandboxDirs = new Set<string>()
				const projectSandboxMap = new Map<string, Set<string>>()
				for (const project of projects) {
					if (!project.worktree || !project.sandboxes?.length) continue
					const sandboxSet = projectSandboxMap.get(project.worktree) ?? new Set<string>()
					for (const s of project.sandboxes) {
						sandboxSet.add(s)
						allSandboxDirs.add(s)
					}
					projectSandboxMap.set(project.worktree, sandboxSet)
				}

				// Load sessions from main project directories
				const mainDirs = new Set<string>()
				for (const project of projects) {
					if (project.worktree) mainDirs.add(project.worktree)
				}

				const mainResults = await Promise.allSettled(
					[...mainDirs].map((dir) => {
						const sandboxDirs = projectSandboxMap.get(dir)
						return loadProjectSessions(dir, sandboxDirs?.size ? sandboxDirs : undefined)
					}),
				)

				// Also load sessions from sandbox directories (they may belong to a
				// different server instance with a separate project ID).
				// Pass a single-element sandboxDirs set so sessions get worktreePath.
				const sandboxResults = await Promise.allSettled(
					[...allSandboxDirs].map((dir) => loadProjectSessions(dir, new Set([dir]))),
				)

				const allResults = [...mainResults, ...sandboxResults]
				const failed = allResults.filter((r) => r.status === "rejected")
				if (failed.length > 0) {
					log.warn("Some project session loads failed", {
						total: mainDirs.size + allSandboxDirs.size,
						failed: failed.length,
					})
				}

				log.info("Discovery complete", {
					server: activeServer.name,
					url,
					projects: projects.length,
					directories: mainDirs.size,
					sandboxes: allSandboxDirs.size,
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
	}, [loaded, loading, isMockMode, activeServer])
}
