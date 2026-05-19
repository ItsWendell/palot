import { useAtomValue } from "jotai"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { messagesFamily } from "../../atoms/messages"
import { projectModelsAtom } from "../../atoms/preferences"
import type {
	ConfigData,
	ModelRef,
	ProvidersData,
	SdkAgent,
} from "../../hooks/use-opencode-data"
import {
	getModelInputCapabilities,
	getModelVariants,
	resolveEffectiveModel,
	useModelState,
} from "../../hooks/use-opencode-data"
import type { Agent } from "../../lib/types"

export function useChatModelSelection({
	agent,
	config,
	providers,
	openCodeAgents,
}: {
	agent: Agent
	config?: ConfigData | null
	providers?: ProvidersData | null
	openCodeAgents?: SdkAgent[]
}) {
	const [selectedModel, setSelectedModel] = useState<ModelRef | null>(null)
	const [selectedAgent, setSelectedAgent] = useState<string | null>(null)
	const [selectedVariant, setSelectedVariant] = useState<string | undefined>(undefined)

	const sessionMessages = useAtomValue(messagesFamily(agent.sessionId))
	const projectModels = useAtomValue(projectModelsAtom)
	const initializedForSessionRef = useRef<string | null>(null)
	const resetForSessionRef = useRef<string | null>(null)

	useEffect(() => {
		if (resetForSessionRef.current !== agent.sessionId) {
			resetForSessionRef.current = agent.sessionId
			initializedForSessionRef.current = null
			const stored = agent.directory ? projectModels[agent.directory] : undefined
			if (stored?.providerID && stored?.modelID) {
				setSelectedModel(stored)
				setSelectedVariant(stored.variant)
			} else {
				setSelectedModel(null)
				setSelectedVariant(undefined)
			}
			setSelectedAgent(stored?.agent || null)
		}

		if (initializedForSessionRef.current === agent.sessionId) return
		if (!sessionMessages || sessionMessages.length === 0) return
		initializedForSessionRef.current = agent.sessionId

		let foundModel = false
		let foundAgent = false
		for (let i = sessionMessages.length - 1; i >= 0; i--) {
			const msg = sessionMessages[i]
			if (msg.role !== "user") continue
			const dynamic = msg as Record<string, unknown>

			if (!foundModel && "model" in msg && msg.model) {
				const model = msg.model as { providerID: string; modelID: string }
				if (model.providerID && model.modelID) {
					setSelectedModel(model)
					foundModel = true
					const variant = dynamic.variant as string | undefined
					setSelectedVariant(variant || undefined)
				}
			}

			if (
				!foundAgent &&
				dynamic.agent &&
				typeof dynamic.agent === "string" &&
				dynamic.agent.length > 0
			) {
				setSelectedAgent(dynamic.agent)
				foundAgent = true
			}

			if (foundModel && foundAgent) break
		}
	}, [sessionMessages, agent.sessionId, agent.directory, projectModels])

	const { recentModels, addRecent: addRecentModel } = useModelState()

	const activeOpenCodeAgent = useMemo(() => {
		const agentName = selectedAgent ?? config?.defaultAgent
		return openCodeAgents?.find((a) => a.name === agentName) ?? null
	}, [selectedAgent, config?.defaultAgent, openCodeAgents])

	const effectiveModel = useMemo(
		() =>
			resolveEffectiveModel(
				selectedModel,
				activeOpenCodeAgent,
				config?.model,
				providers?.defaults ?? {},
				providers?.providers ?? [],
			),
		[selectedModel, activeOpenCodeAgent, config?.model, providers],
	)

	useEffect(() => {
		if (!selectedVariant || !effectiveModel || !providers) return
		const available = getModelVariants(
			effectiveModel.providerID,
			effectiveModel.modelID,
			providers.providers,
		)
		if (!available.includes(selectedVariant)) {
			setSelectedVariant(undefined)
		}
	}, [selectedVariant, effectiveModel, providers])

	const modelCapabilities = useMemo(
		() => getModelInputCapabilities(effectiveModel, providers?.providers ?? []),
		[effectiveModel, providers],
	)

	const handleModelSelect = useCallback(
		(model: ModelRef | null) => {
			setSelectedModel(model)
			setSelectedVariant(undefined)
			if (model) addRecentModel(model)
		},
		[addRecentModel],
	)

	return {
		selectedModel,
		selectedAgent,
		setSelectedAgent,
		selectedVariant,
		setSelectedVariant,
		effectiveModel,
		modelCapabilities,
		recentModels,
		handleModelSelect,
	}
}
