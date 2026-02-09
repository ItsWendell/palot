import type {
	Agent as SdkAgent,
	Config as SdkConfig,
	Model as SdkModel,
	Provider as SdkProvider,
} from "@opencode-ai/sdk/v2/client"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useCallback } from "react"
import { fetchModelState, updateModelRecent } from "../services/backend"
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
// Query Key Factories
// ============================================================

/** Centralized query keys — avoids typo-based cache misses and makes invalidation easy. */
export const queryKeys = {
	providers: (directory: string) => ["providers", directory] as const,
	config: (directory: string) => ["config", directory] as const,
	vcs: (directory: string) => ["vcs", directory] as const,
	agents: (directory: string) => ["agents", directory] as const,
	commands: (directory: string) => ["commands", directory] as const,
	modelState: ["modelState"] as const,
}

// ============================================================
// Hooks (TanStack Query)
// ============================================================

/**
 * Fetches connected providers and their models from an OpenCode server.
 * Uses `GET /config/providers` which returns resolved Provider objects.
 *
 * Cached per directory — switching between sessions in the same project is free.
 */
export function useProviders(directory: string | null): {
	data: ProvidersData | null
	loading: boolean
	error: string | null
	reload: () => void
} {
	const connected = useAppStore((s) => s.opencode?.connected ?? false)
	const queryClient = useQueryClient()

	const { data, isLoading, error } = useQuery({
		queryKey: queryKeys.providers(directory ?? ""),
		queryFn: async (): Promise<ProvidersData> => {
			const client = getProjectClient(directory!)
			if (!client) throw new Error("No client for directory")
			const result = await client.config.providers()
			const raw = result.data as {
				providers: SdkProvider[]
				default: Record<string, string>
			}
			return {
				providers: raw.providers ?? [],
				defaults: raw.default ?? {},
			}
		},
		enabled: !!directory && connected,
	})

	const reload = useCallback(() => {
		if (directory) {
			queryClient.invalidateQueries({ queryKey: queryKeys.providers(directory) })
		}
	}, [directory, queryClient])

	return {
		data: data ?? null,
		loading: isLoading,
		error: error ? (error instanceof Error ? error.message : "Failed to load providers") : null,
		reload,
	}
}

/**
 * Fetches the current config from an OpenCode server.
 * Uses `GET /config`.
 *
 * Cached per directory — rarely changes during a session.
 */
export function useConfig(directory: string | null): {
	data: ConfigData | null
	loading: boolean
	error: string | null
	reload: () => void
} {
	const connected = useAppStore((s) => s.opencode?.connected ?? false)
	const queryClient = useQueryClient()

	const { data, isLoading, error } = useQuery({
		queryKey: queryKeys.config(directory ?? ""),
		queryFn: async (): Promise<ConfigData> => {
			const client = getProjectClient(directory!)
			if (!client) throw new Error("No client for directory")
			const result = await client.config.get()
			const raw = result.data as SdkConfig
			return {
				model: raw.model,
				smallModel: raw.small_model,
				defaultAgent: raw.default_agent,
			}
		},
		enabled: !!directory && connected,
	})

	const reload = useCallback(() => {
		if (directory) {
			queryClient.invalidateQueries({ queryKey: queryKeys.config(directory) })
		}
	}, [directory, queryClient])

	return {
		data: data ?? null,
		loading: isLoading,
		error: error ? (error instanceof Error ? error.message : "Failed to load config") : null,
		reload,
	}
}

/**
 * Fetches VCS (git) info from an OpenCode server.
 * Uses `GET /vcs` with a 60s polling interval (doubled from 30s — sufficient
 * since manual reload and SSE events provide near-instant updates when needed).
 *
 * Cached per directory — switching between sessions in the same project is free.
 */
export function useVcs(directory: string | null): {
	data: VcsData | null
	loading: boolean
	error: string | null
	reload: () => void
} {
	const connected = useAppStore((s) => s.opencode?.connected ?? false)
	const queryClient = useQueryClient()

	const { data, isLoading, error } = useQuery({
		queryKey: queryKeys.vcs(directory ?? ""),
		queryFn: async (): Promise<VcsData> => {
			const client = getProjectClient(directory!)
			if (!client) throw new Error("No client for directory")
			const result = await client.vcs.get()
			const raw = result.data as { branch: string }
			return { branch: raw.branch ?? "" }
		},
		enabled: !!directory && connected,
		// VCS data changes more often (branch switches) — shorter stale time + polling.
		staleTime: 30_000,
		refetchInterval: 60_000,
	})

	const reload = useCallback(() => {
		if (directory) {
			queryClient.invalidateQueries({ queryKey: queryKeys.vcs(directory) })
		}
	}, [directory, queryClient])

	return {
		data: data ?? null,
		loading: isLoading,
		error: error ? (error instanceof Error ? error.message : "Failed to load VCS info") : null,
		reload,
	}
}

/**
 * Fetches available agents from an OpenCode server.
 * Uses `GET /agent` via `client.app.agents()`.
 * Filters to only primary, non-hidden agents (the ones cycleable in the TUI).
 *
 * Cached per directory — agent configuration almost never changes at runtime.
 */
export function useOpenCodeAgents(directory: string | null): {
	agents: SdkAgent[]
	loading: boolean
	error: string | null
	reload: () => void
} {
	const connected = useAppStore((s) => s.opencode?.connected ?? false)
	const queryClient = useQueryClient()

	const { data, isLoading, error } = useQuery({
		queryKey: queryKeys.agents(directory ?? ""),
		queryFn: async (): Promise<SdkAgent[]> => {
			const client = getProjectClient(directory!)
			if (!client) throw new Error("No client for directory")
			const result = await client.app.agents()
			const raw = (result.data ?? []) as SdkAgent[]
			// Only keep primary/all agents that aren't hidden
			return raw.filter((a) => (a.mode === "primary" || a.mode === "all") && !a.hidden)
		},
		enabled: !!directory && connected,
	})

	const reload = useCallback(() => {
		if (directory) {
			queryClient.invalidateQueries({ queryKey: queryKeys.agents(directory) })
		}
	}, [directory, queryClient])

	return {
		agents: data ?? [],
		loading: isLoading,
		error: error ? (error instanceof Error ? error.message : "Failed to load agents") : null,
		reload,
	}
}

/**
 * Fetches the model state (recent models, favorites, variants) from the
 * Codedeck backend, which reads ~/.local/state/opencode/model.json.
 *
 * This is the same file the TUI uses for its "recent models" resolution.
 * The first recent model that exists in a connected provider becomes the
 * default when no explicit model is configured.
 *
 * Also exposes `addRecent()` to persist model selections to model.json
 * (matching the TUI's `model.set(model, { recent: true })` behavior).
 */
export function useModelState(): {
	recentModels: ModelRef[]
	loading: boolean
	error: string | null
	/** Adds a model to the front of the recent list and persists to model.json. */
	addRecent: (model: ModelRef) => void
} {
	const connected = useAppStore((s) => s.opencode?.connected ?? false)
	const queryClient = useQueryClient()

	const { data, isLoading, error } = useQuery({
		queryKey: queryKeys.modelState,
		queryFn: async (): Promise<ModelRef[]> => {
			const result = await fetchModelState()
			return result.recent ?? []
		},
		enabled: connected,
		// Model state can change when user selects a model in another session —
		// keep it relatively fresh but still avoid redundant fetches on navigation.
		staleTime: 60_000,
	})

	const addRecent = useCallback(
		(model: ModelRef) => {
			// Optimistic update — mutate the query cache directly
			queryClient.setQueryData<ModelRef[]>(queryKeys.modelState, (prev) => {
				const key = (m: ModelRef) => `${m.providerID}/${m.modelID}`
				const seen = new Set<string>()
				const updated: ModelRef[] = []
				for (const entry of [model, ...(prev ?? [])]) {
					const k = key(entry)
					if (!seen.has(k) && updated.length < 10) {
						seen.add(k)
						updated.push(entry)
					}
				}
				return updated
			})

			// Persist to model.json in the background
			updateModelRecent(model).catch((err) => {
				console.error("Failed to persist model to recent:", err)
			})
		},
		[queryClient],
	)

	return {
		recentModels: data ?? [],
		loading: isLoading,
		error: error ? (error instanceof Error ? error.message : "Failed to load model state") : null,
		addRecent,
	}
}

/**
 * Fetches available server-side slash commands.
 * Uses `GET /command` via `client.command.list()`.
 *
 * Cached per directory — shared between useCommands and SlashCommandPopover,
 * eliminating the duplicate request that previously occurred.
 */
export function useServerCommands(directory: string | null): {
	name: string
	description?: string
	agent?: string
}[] {
	const connected = useAppStore((s) => s.opencode?.connected ?? false)

	const { data } = useQuery({
		queryKey: queryKeys.commands(directory ?? ""),
		queryFn: async () => {
			const client = getProjectClient(directory!)
			if (!client) throw new Error("No client for directory")
			const result = await client.command.list()
			return (result.data ?? []) as { name: string; description?: string; agent?: string }[]
		},
		enabled: !!directory && connected,
	})

	return data ?? []
}
