import {
	Conversation,
	ConversationContent,
	ConversationScrollButton,
} from "@codedeck/ui/components/ai-elements/conversation"
import {
	PromptInput,
	PromptInputButton,
	PromptInputFooter,
	PromptInputSubmit,
	PromptInputTextarea,
	PromptInputTools,
	usePromptInputAttachments,
} from "@codedeck/ui/components/ai-elements/prompt-input"
import { ChevronUpIcon, Loader2Icon, PlusIcon } from "lucide-react"
import { useCallback, useMemo, useState } from "react"
import type {
	ConfigData,
	ModelRef,
	ProvidersData,
	SdkAgent,
	VcsData,
} from "../../hooks/use-opencode-data"
import {
	getModelInputCapabilities,
	resolveEffectiveModel,
	useModelState,
} from "../../hooks/use-opencode-data"
import type { ChatTurn } from "../../hooks/use-session-chat"
import type { Agent, FileAttachment } from "../../lib/types"
import { ChatTurnComponent } from "./chat-turn"
import { PromptAttachmentPreview } from "./prompt-attachments"
import { PromptToolbar, StatusBar } from "./prompt-toolbar"
import { SessionTaskList } from "./session-task-list"

/**
 * Small "+" button that opens the file picker for attachments.
 * Must be rendered inside a <PromptInput> so the attachments context is available.
 */
function AttachButton({ disabled }: { disabled?: boolean }) {
	const attachments = usePromptInputAttachments()
	return (
		<PromptInputButton
			tooltip="Attach files"
			onClick={() => attachments.openFileDialog()}
			disabled={disabled}
		>
			<PlusIcon className="size-4" />
		</PromptInputButton>
	)
}

interface ChatViewProps {
	turns: ChatTurn[]
	loading: boolean
	/** Whether earlier messages are currently being loaded */
	loadingEarlier: boolean
	/** Whether there are earlier messages that can be loaded */
	hasEarlierMessages: boolean
	/** Callback to load earlier messages */
	onLoadEarlier?: () => void
	agent: Agent
	isConnected: boolean
	onSendMessage?: (
		agent: Agent,
		message: string,
		options?: { model?: ModelRef; agentName?: string; variant?: string; files?: FileAttachment[] },
	) => Promise<void>
	/** Provider data for model selector */
	providers?: ProvidersData | null
	/** Config data (default model, default agent) */
	config?: ConfigData | null
	/** VCS data for status bar */
	vcs?: VcsData | null
	/** Available OpenCode agents */
	openCodeAgents?: SdkAgent[]
}

/**
 * Main chat view component.
 * Renders the full conversation as turns with auto-scroll,
 * plus a card-style input with agent/model/variant toolbar and status bar.
 */
export function ChatView({
	turns,
	loading,
	loadingEarlier,
	hasEarlierMessages,
	onLoadEarlier,
	agent,
	isConnected,
	onSendMessage,
	providers,
	config,
	vcs,
	openCodeAgents,
}: ChatViewProps) {
	const isWorking = agent.status === "running"
	const [sending, setSending] = useState(false)

	// Toolbar state
	const [selectedModel, setSelectedModel] = useState<ModelRef | null>(null)
	const [selectedAgent, setSelectedAgent] = useState<string | null>(null)
	const [selectedVariant, setSelectedVariant] = useState<string | undefined>(undefined)

	// Recent models from model.json (for matching TUI's default model resolution)
	const { recentModels } = useModelState()

	// Resolve which OpenCode agent is active (for model resolution)
	const activeOpenCodeAgent = useMemo(() => {
		const agentName = selectedAgent ?? config?.defaultAgent
		return openCodeAgents?.find((a) => a.name === agentName) ?? null
	}, [selectedAgent, config?.defaultAgent, openCodeAgents])

	// Resolve effective model (user override > agent model > config > recent > provider default)
	const effectiveModel = useMemo(
		() =>
			resolveEffectiveModel(
				selectedModel,
				activeOpenCodeAgent,
				config?.model,
				providers?.defaults ?? {},
				providers?.providers ?? [],
				recentModels,
			),
		[selectedModel, activeOpenCodeAgent, config?.model, providers, recentModels],
	)

	// Model input capabilities (for attachment warnings)
	const modelCapabilities = useMemo(
		() => getModelInputCapabilities(effectiveModel, providers?.providers ?? []),
		[effectiveModel, providers],
	)

	const handleSend = useCallback(
		async (text: string, files?: FileAttachment[]) => {
			if (!text.trim() || !onSendMessage || sending) return
			setSending(true)
			try {
				await onSendMessage(agent, text.trim(), {
					model: effectiveModel ?? undefined,
					agentName: selectedAgent ?? undefined,
					variant: selectedVariant,
					files,
				})
			} finally {
				setSending(false)
			}
		},
		[onSendMessage, sending, agent, effectiveModel, selectedAgent, selectedVariant],
	)

	const canSend = isConnected && !isWorking && !sending

	return (
		<div className="flex h-full flex-col">
			{/* Chat messages — constrained width for readability */}
			<div className="relative min-h-0 flex-1">
				<Conversation className="h-full [&>div]:scrollbar-thin">
					<ConversationContent className="gap-10 px-4 py-6">
						<div className="mx-auto w-full max-w-4xl">
							{/* Load earlier messages button */}
							{hasEarlierMessages && (
								<div className="flex justify-center pb-4">
									<button
										type="button"
										onClick={onLoadEarlier}
										disabled={loadingEarlier}
										className="flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
									>
										{loadingEarlier ? (
											<Loader2Icon className="size-3 animate-spin" />
										) : (
											<ChevronUpIcon className="size-3" />
										)}
										{loadingEarlier ? "Loading..." : "Load earlier messages"}
									</button>
								</div>
							)}

							{loading ? (
								<div className="flex items-center justify-center py-8">
									<Loader2Icon className="size-5 animate-spin text-muted-foreground" />
									<span className="ml-2 text-sm text-muted-foreground">Loading chat...</span>
								</div>
							) : turns.length > 0 ? (
								turns.map((turn, index) => (
									<ChatTurnComponent
										key={turn.id}
										turn={turn}
										isLast={index === turns.length - 1}
										isWorking={isWorking}
									/>
								))
							) : (
								<div className="flex items-center justify-center py-8">
									<p className="text-sm text-muted-foreground">No messages yet</p>
								</div>
							)}
						</div>
					</ConversationContent>
					<ConversationScrollButton />
				</Conversation>

				{/* Top fade */}
				<div
					aria-hidden="true"
					className="pointer-events-none absolute inset-x-0 top-0 z-10 h-6 bg-gradient-to-b from-background to-transparent"
				/>
				{/* Bottom fade */}
				<div
					aria-hidden="true"
					className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-6 bg-gradient-to-t from-background to-transparent"
				/>
			</div>

			{/* Bottom input section — task list + card + status bar */}
			<div className="px-4 pb-4 pt-2">
				<div className="mx-auto w-full max-w-4xl">
					{/* Session task list — collapsible todo progress */}
					<SessionTaskList sessionId={agent.sessionId} />

					{/* Input card — rounded container with textarea + toolbar inside */}
					<PromptInput
						className="rounded-xl"
						accept="image/png,image/jpeg,image/gif,image/webp,application/pdf"
						multiple
						maxFileSize={10 * 1024 * 1024}
						onSubmit={(message) => {
							if (message.text.trim() && canSend)
								handleSend(message.text, message.files.length > 0 ? message.files : undefined)
						}}
					>
						<PromptAttachmentPreview
							supportsImages={modelCapabilities?.image}
							supportsPdf={modelCapabilities?.pdf}
						/>
						<PromptInputTextarea
							placeholder={
								!isConnected
									? "Connect to server to send messages..."
									: isWorking
										? "Waiting for response..."
										: "Ask for follow-up changes"
							}
							disabled={!isConnected}
							className="min-h-[80px]"
						/>

						{/* Toolbar inside the card — agent + model + variant selectors + submit */}
						<PromptInputFooter>
							<PromptInputTools>
								<AttachButton disabled={!isConnected} />
								<PromptToolbar
									agents={openCodeAgents ?? []}
									selectedAgent={selectedAgent}
									defaultAgent={config?.defaultAgent}
									onSelectAgent={setSelectedAgent}
									providers={providers ?? null}
									effectiveModel={effectiveModel}
									hasModelOverride={!!selectedModel}
									onSelectModel={setSelectedModel}
									selectedVariant={selectedVariant}
									onSelectVariant={setSelectedVariant}
									disabled={!isConnected}
								/>
							</PromptInputTools>
							<PromptInputSubmit disabled={!canSend} status={isWorking ? "streaming" : undefined} />
						</PromptInputFooter>
					</PromptInput>

					{/* Status bar — outside the card */}
					<StatusBar vcs={vcs ?? null} isConnected={isConnected} />
				</div>
			</div>
		</div>
	)
}
