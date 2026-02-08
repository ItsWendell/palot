import type {
	Agent as SdkAgent,
	Config as SdkConfig,
	Model as SdkModel,
	Provider as SdkProvider,
} from "@opencode-ai/sdk/v2/client"
import { useCallback, useEffect, useRef, useState } from "react"
import { fetchModelState } from "../services/backend"
import { getProjectClient } from "../services/connection-manager"
import { useAppStore } from "../stores/app-store"

// ============================================================
// Re-exports — use SDK types directly
// ============================================================

export type { SdkAgent, SdkConfig, SdkModel, SdkProvider }

// ============================================================
// Derived types for our UI layer
// ============================================================

export interface ProvidersData {
	providers: SdkProvider[]
	/** Default model per provider, e.g. { anthropic: "claude-sonnet-4-20250514" } */
	defaults: Record<string, string>
}

export interface VcsData {
	branch: string
}

export interface ConfigData {
	/** Default model in "providerID/modelID" format */
	model?: string
	/** Small model for title generation etc. */
	smallModel?: string
	/** Default agent name */
	defaultAgent?: string
}

/** Parsed model reference */
export interface ModelRef {
	providerID: string
	modelID: string
}

// ============================================================
// Helpers
// ============================================================

/**
 * Parses a "providerID/modelID" string into its parts.
 */
export function parseModelRef(ref: string): ModelRef | null {
	const slashIndex = ref.indexOf("/")
	if (slashIndex === -1) return null
	return {
		providerID: ref.slice(0, slashIndex),
		modelID: ref.slice(slashIndex + 1),
	}
}

/**
 * Gets a human-readable short name for a model.
 * e.g. "claude-sonnet-4-20250514" -> "Claude Sonnet 4"
 */
export function getModelDisplayName(modelID: string, providers: SdkProvider[]): string {
	for (const provider of providers) {
		const model = provider.models[modelID]
		if (model) return model.name
	}
	// Fallback: clean up the ID
	return modelID
		.replace(/-\d{8}$/, "") // remove date suffix
		.replace(/-/g, " ")
		.replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * Returns the list of variant names for a given model.
 * Empty array if the model has no variants (no reasoning support).
 */
export function getModelVariants(
	providerID: string,
	modelID: string,
	providers: SdkProvider[],
): string[] {
	for (const provider of providers) {
		if (provider.id !== providerID) continue
		const model = provider.models[modelID]
		if (model?.variants) {
			return Object.keys(model.variants)
		}
	}
	return []
}

/**
 * Resolves the effective model for the current agent.
 * Priority: user override > agent's configured model > config default > recent model > provider default.
 * Matches the TUI's fallbackModel resolution chain.
 */
export function resolveEffectiveModel(
	selectedModel: ModelRef | null,
	agent: SdkAgent | null,
	configModel: string | undefined,
	providerDefaults: Record<string, string>,
	providers: SdkProvider[],
	recentModels?: ModelRef[],
): ModelRef | null {
	// 1. User-selected override
	if (selectedModel) return selectedModel

	// 2. Agent's configured model
	if (agent?.model) {
		return { providerID: agent.model.providerID, modelID: agent.model.modelID }
	}

	// 3. Config model field
	if (configModel) {
		const ref = parseModelRef(configModel)
		if (ref) return ref
	}

	// 4. First valid recent model (from model.json, matches TUI behavior)
	if (recentModels) {
		for (const recent of recentModels) {
			// Validate the model exists in a connected provider
			const provider = providers.find((p) => p.id === recent.providerID)
			if (provider && provider.models[recent.modelID]) {
				return recent
			}
		}
	}

	// 5. First provider's default model (matches server's internal resolution)
	for (const provider of providers) {
		const defaultModelId = providerDefaults[provider.id]
		if (defaultModelId) {
			return { providerID: provider.id, modelID: defaultModelId }
		}
	}

	return null
}

/**
 * Looks up model capabilities for a given model reference.
 * Returns the input capabilities (image, pdf, audio, video) or null if model not found.
 */
export function getModelInputCapabilities(
	model: ModelRef | null,
	providers: SdkProvider[],
): { image: boolean; pdf: boolean; attachment: boolean } | null {
	if (!model) return null
	for (const provider of providers) {
		if (provider.id !== model.providerID) continue
		const m = provider.models[model.modelID]
		if (m?.capabilities) {
			return {
				image: m.capabilities.input.image,
				pdf: m.capabilities.input.pdf,
				attachment: m.capabilities.attachment,
			}
		}
	}
	return null
}

// ============================================================
// Hooks
// ============================================================

/**
 * Fetches connected providers and their models from an OpenCode server.
 * Uses `GET /config/providers` which returns resolved Provider objects.
 */
export function useProviders(directory: string | null): {
	data: ProvidersData | null
	loading: boolean
	error: string | null
	reload: () => void
} {
	const connected = useAppStore((s) => s.opencode?.connected ?? false)
	const [data, setData] = useState<ProvidersData | null>(null)
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const load = useCallback(async () => {
		if (!directory) {
			setData(null)
			return
		}
		const client = getProjectClient(directory)
		if (!client) {
			setData(null)
			return
		}

		setLoading(true)
		setError(null)
		try {
			const result = await client.config.providers()
			const raw = result.data as {
				providers: SdkProvider[]
				default: Record<string, string>
			}
			setData({
				providers: raw.providers ?? [],
				defaults: raw.default ?? {},
			})
		} catch (err) {
			console.error("Failed to load providers:", err)
			setError(err instanceof Error ? err.message : "Failed to load providers")
		} finally {
			setLoading(false)
		}
	}, [directory, connected])

	useEffect(() => {
		load()
	}, [load])

	return { data, loading, error, reload: load }
}

/**
 * Fetches the current config from an OpenCode server.
 * Uses `GET /config`.
 */
export function useConfig(directory: string | null): {
	data: ConfigData | null
	loading: boolean
	error: string | null
	reload: () => void
} {
	const connected = useAppStore((s) => s.opencode?.connected ?? false)
	const [data, setData] = useState<ConfigData | null>(null)
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const load = useCallback(async () => {
		if (!directory) {
			setData(null)
			return
		}
		const client = getProjectClient(directory)
		if (!client) {
			setData(null)
			return
		}

		setLoading(true)
		setError(null)
		try {
			const result = await client.config.get()
			const raw = result.data as SdkConfig
			setData({
				model: raw.model,
				smallModel: raw.small_model,
				defaultAgent: raw.default_agent,
			})
		} catch (err) {
			console.error("Failed to load config:", err)
			setError(err instanceof Error ? err.message : "Failed to load config")
		} finally {
			setLoading(false)
		}
	}, [directory, connected])

	useEffect(() => {
		load()
	}, [load])

	return { data, loading, error, reload: load }
}

/**
 * Fetches VCS (git) info from an OpenCode server.
 * Uses `GET /vcs`. Also listens for `vcs.branch.updated` events
 * via the SSE stream (handled in the store event processor).
 */
export function useVcs(directory: string | null): {
	data: VcsData | null
	loading: boolean
	error: string | null
	reload: () => void
} {
	const connected = useAppStore((s) => s.opencode?.connected ?? false)
	const [data, setData] = useState<VcsData | null>(null)
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const pollRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

	const load = useCallback(async () => {
		if (!directory) {
			setData(null)
			return
		}
		const client = getProjectClient(directory)
		if (!client) {
			setData(null)
			return
		}

		setLoading(true)
		setError(null)
		try {
			const result = await client.vcs.get()
			const raw = result.data as { branch: string }
			setData({ branch: raw.branch ?? "" })
		} catch (err) {
			console.error("Failed to load VCS info:", err)
			setError(err instanceof Error ? err.message : "Failed to load VCS info")
		} finally {
			setLoading(false)
		}
	}, [directory, connected])

	useEffect(() => {
		load()

		// Poll VCS every 30s to catch branch changes
		// (supplements SSE events which may not always arrive)
		const poll = () => {
			pollRef.current = setTimeout(() => {
				load()
				poll()
			}, 30_000)
		}
		poll()

		return () => {
			if (pollRef.current) clearTimeout(pollRef.current)
		}
	}, [load])

	return { data, loading, error, reload: load }
}

/**
 * Fetches available agents from an OpenCode server.
 * Uses `GET /agent` via `client.app.agents()`.
 * Filters to only primary, non-hidden agents (the ones cycleable in the TUI).
 */
export function useOpenCodeAgents(directory: string | null): {
	agents: SdkAgent[]
	loading: boolean
	error: string | null
	reload: () => void
} {
	const connected = useAppStore((s) => s.opencode?.connected ?? false)
	const [agents, setAgents] = useState<SdkAgent[]>([])
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const load = useCallback(async () => {
		if (!directory) {
			setAgents([])
			return
		}
		const client = getProjectClient(directory)
		if (!client) {
			setAgents([])
			return
		}

		setLoading(true)
		setError(null)
		try {
			const result = await client.app.agents()
			const raw = (result.data ?? []) as SdkAgent[]
			// Only keep primary/all agents that aren't hidden
			const visible = raw.filter((a) => (a.mode === "primary" || a.mode === "all") && !a.hidden)
			setAgents(visible)
		} catch (err) {
			console.error("Failed to load agents:", err)
			setError(err instanceof Error ? err.message : "Failed to load agents")
		} finally {
			setLoading(false)
		}
	}, [directory, connected])

	useEffect(() => {
		load()
	}, [load])

	return { agents, loading, error, reload: load }
}

/**
 * Fetches the model state (recent models, favorites, variants) from the
 * Codedeck backend, which reads ~/.local/state/opencode/model.json.
 *
 * This is the same file the TUI uses for its "recent models" resolution.
 * The first recent model that exists in a connected provider becomes the
 * default when no explicit model is configured.
 */
export function useModelState(): {
	recentModels: ModelRef[]
	loading: boolean
	error: string | null
} {
	const connected = useAppStore((s) => s.opencode?.connected ?? false)
	const [recentModels, setRecentModels] = useState<ModelRef[]>([])
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const load = useCallback(async () => {
		setLoading(true)
		setError(null)
		try {
			const data = await fetchModelState()
			setRecentModels(data.recent ?? [])
		} catch (err) {
			console.error("Failed to load model state:", err)
			setError(err instanceof Error ? err.message : "Failed to load model state")
		} finally {
			setLoading(false)
		}
	}, [connected])

	useEffect(() => {
		load()
	}, [load])

	return { recentModels, loading, error }
}
