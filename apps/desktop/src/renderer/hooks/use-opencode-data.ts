import type {
	Agent as SdkAgent,
	Config as SdkConfig,
	Model as SdkModel,
	Provider as SdkProvider,
} from "@opencode-ai/sdk/v2/client"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useAtomValue } from "jotai"
import { useCallback } from "react"
import { serverConnectedAtom } from "../atoms/connection"
import { isMockModeAtom } from "../atoms/mock-mode"
import { MOCK_AGENTS, MOCK_CONFIG, MOCK_PROVIDERS } from "../lib/mock-data"
import { fetchModelState, updateModelRecent } from "../services/backend"
import { getProjectClient } from "../services/connection-manager"

// ============================================================
// Re-exports — use SDK types directly
// ============================================================

export type { SdkAgent, SdkConfig, SdkModel, SdkProvider }

// ============================================================
// Derived types for our UI layer
// ============================================================

export interface ProvidersData {
	providers: SdkProvider[]
	defaults: Record<string, string>
}

export interface VcsData {
	branch: string
}

export interface ConfigData {
	model?: string
	smallModel?: string
	defaultAgent?: string
}

export interface ModelRef {
	providerID: string
	modelID: string
}

// ============================================================
// Helpers
// ============================================================

export function parseModelRef(ref: string): ModelRef | null {
	const slashIndex = ref.indexOf("/")
	if (slashIndex === -1) return null
	return {
		providerID: ref.slice(0, slashIndex),
		modelID: ref.slice(slashIndex + 1),
	}
}

export function getModelDisplayName(modelID: string, providers: SdkProvider[]): string {
	for (const provider of providers) {
		const model = provider.models[modelID]
		if (model) return model.name
	}
	return modelID
		.replace(/-\d{8}$/, "")
		.replace(/-/g, " ")
		.replace(/\b\w/g, (c) => c.toUpperCase())
}

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

export function resolveEffectiveModel(
	selectedModel: ModelRef | null,
	agent: SdkAgent | null,
	configModel: string | undefined,
	providerDefaults: Record<string, string>,
	providers: SdkProvider[],
	recentModels?: ModelRef[],
): ModelRef | null {
	if (selectedModel) return selectedModel
	if (agent?.model) {
		return { providerID: agent.model.providerID, modelID: agent.model.modelID }
	}
	if (configModel) {
		const ref = parseModelRef(configModel)
		if (ref) return ref
	}
	if (recentModels) {
		for (const recent of recentModels) {
			const provider = providers.find((p) => p.id === recent.providerID)
			if (provider?.models[recent.modelID]) {
				return recent
			}
		}
	}
	for (const provider of providers) {
		const defaultModelId = providerDefaults[provider.id]
		if (defaultModelId) {
			return { providerID: provider.id, modelID: defaultModelId }
		}
	}
	return null
}

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

export function useProviders(directory: string | null): {
	data: ProvidersData | null
	loading: boolean
	error: string | null
	reload: () => void
} {
	const connected = useAtomValue(serverConnectedAtom)
	const isMockMode = useAtomValue(isMockModeAtom)
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
		enabled: !!directory && connected && !isMockMode,
	})

	const reload = useCallback(() => {
		if (directory) {
			queryClient.invalidateQueries({ queryKey: queryKeys.providers(directory) })
		}
	}, [directory, queryClient])

	// Return mock data if in mock mode
	if (isMockMode && directory) {
		return {
			data: MOCK_PROVIDERS as unknown as ProvidersData,
			loading: false,
			error: null,
			reload,
		}
	}

	return {
		data: data ?? null,
		loading: isLoading,
		error: error ? (error instanceof Error ? error.message : "Failed to load providers") : null,
		reload,
	}
}

export function useConfig(directory: string | null): {
	data: ConfigData | null
	loading: boolean
	error: string | null
	reload: () => void
} {
	const connected = useAtomValue(serverConnectedAtom)
	const isMockMode = useAtomValue(isMockModeAtom)
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
		enabled: !!directory && connected && !isMockMode,
	})

	const reload = useCallback(() => {
		if (directory) {
			queryClient.invalidateQueries({ queryKey: queryKeys.config(directory) })
		}
	}, [directory, queryClient])

	// Return mock data if in mock mode
	if (isMockMode && directory) {
		return {
			data: MOCK_CONFIG,
			loading: false,
			error: null,
			reload,
		}
	}

	return {
		data: data ?? null,
		loading: isLoading,
		error: error ? (error instanceof Error ? error.message : "Failed to load config") : null,
		reload,
	}
}

export function useVcs(directory: string | null): {
	data: VcsData | null
	loading: boolean
	error: string | null
	reload: () => void
} {
	const connected = useAtomValue(serverConnectedAtom)
	const isMockMode = useAtomValue(isMockModeAtom)
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
		enabled: !!directory && connected && !isMockMode,
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

export function useOpenCodeAgents(directory: string | null): {
	agents: SdkAgent[]
	loading: boolean
	error: string | null
	reload: () => void
} {
	const connected = useAtomValue(serverConnectedAtom)
	const isMockMode = useAtomValue(isMockModeAtom)
	const queryClient = useQueryClient()

	const { data, isLoading, error } = useQuery({
		queryKey: queryKeys.agents(directory ?? ""),
		queryFn: async (): Promise<SdkAgent[]> => {
			const client = getProjectClient(directory!)
			if (!client) throw new Error("No client for directory")
			const result = await client.app.agents()
			const raw = (result.data ?? []) as SdkAgent[]
			return raw.filter((a) => (a.mode === "primary" || a.mode === "all") && !a.hidden)
		},
		enabled: !!directory && connected && !isMockMode,
	})

	const reload = useCallback(() => {
		if (directory) {
			queryClient.invalidateQueries({ queryKey: queryKeys.agents(directory) })
		}
	}, [directory, queryClient])

	// Return mock data if in mock mode
	if (isMockMode && directory) {
		return {
			agents: MOCK_AGENTS as unknown as SdkAgent[],
			loading: false,
			error: null,
			reload,
		}
	}

	return {
		agents: data ?? [],
		loading: isLoading,
		error: error ? (error instanceof Error ? error.message : "Failed to load agents") : null,
		reload,
	}
}

export function useModelState(): {
	recentModels: ModelRef[]
	loading: boolean
	error: string | null
	addRecent: (model: ModelRef) => void
} {
	const connected = useAtomValue(serverConnectedAtom)
	const isMockMode = useAtomValue(isMockModeAtom)
	const queryClient = useQueryClient()

	const { data, isLoading, error } = useQuery({
		queryKey: queryKeys.modelState,
		queryFn: async (): Promise<ModelRef[]> => {
			const result = await fetchModelState()
			return result.recent ?? []
		},
		enabled: connected && !isMockMode,
		staleTime: 60_000,
	})

	const addRecent = useCallback(
		(model: ModelRef) => {
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

			updateModelRecent(model).catch((err) => {
				console.error("Failed to persist model to recent:", err)
			})
		},
		[queryClient],
	)

	// Return mock data if in mock mode
	if (isMockMode) {
		return {
			recentModels: [{ providerID: "bedrock", modelID: "anthropic.claude-opus-4-6" }],
			loading: false,
			error: null,
			addRecent: () => {
				// No-op in mock mode
			},
		}
	}

	return {
		recentModels: data ?? [],
		loading: isLoading,
		error: error ? (error instanceof Error ? error.message : "Failed to load model state") : null,
		addRecent,
	}
}

export interface ServerCommand {
	name: string
	description?: string
	agent?: string
	source?: "command" | "mcp" | "skill"
}

export function useServerCommands(directory: string | null): ServerCommand[] {
	const connected = useAtomValue(serverConnectedAtom)
	const isMockMode = useAtomValue(isMockModeAtom)

	const { data } = useQuery({
		queryKey: queryKeys.commands(directory ?? ""),
		queryFn: async () => {
			const client = getProjectClient(directory!)
			if (!client) throw new Error("No client for directory")
			const result = await client.command.list()
			return (result.data ?? []) as ServerCommand[]
		},
		enabled: !!directory && connected && !isMockMode,
	})

	return data ?? []
}
