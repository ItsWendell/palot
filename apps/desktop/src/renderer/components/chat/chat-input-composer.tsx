import {
	PromptInput,
	PromptInputFooter,
	PromptInputProvider,
	PromptInputSubmit,
	PromptInputTextarea,
	PromptInputTools,
} from "@palot/ui/components/ai-elements/prompt-input"
import { GitForkIcon, MonitorIcon } from "lucide-react"
import type React from "react"
import type { ConfigData, ModelRef, ProvidersData, SdkAgent, VcsData } from "../../hooks/use-opencode-data"
import type { FileAttachment } from "../../lib/types"
import type { DiffComment } from "../review/diff-comment-model"
import { DiffCommentChips, LiveTurnTimer } from "./chat-input-extras"
import { ContextItems } from "./context-items"
import { type MentionOption, type MentionPopoverHandle, MentionPopover } from "./mention-popover"
import { PromptAttachmentPreview } from "./prompt-attachments"
import type { PromptMention } from "./prompt-mentions"
import {
	AttachButton,
	DraftSync,
	MentionReconciler,
	type PromptTextController,
	SlashCommandBridge,
	TriggerDetector,
} from "./prompt-input-bridges"
import { PromptToolbar, StatusBar } from "./prompt-toolbar"
import { SlashCommandPopover, type SlashCommandPopoverHandle } from "./slash-command-popover"

const NO_ATTACHMENT_TYPES = "application/x-palot-no-attachments"
const IMAGE_ATTACHMENT_TYPES = "image/png,image/jpeg,image/gif,image/webp"

interface ChatInputCardProps {
	sessionId: string
	directory: string
	draft: string
	setDraft: (text: string) => void
	textControllerRef: React.RefObject<PromptTextController | null>
	slashPopoverRef: React.RefObject<SlashCommandPopoverHandle | null>
	mentionPopoverRef: React.RefObject<MentionPopoverHandle | null>
	slashOpen: boolean
	slashQuery: string
	mentionOpen: boolean
	mentionQuery: string
	mentions: PromptMention[]
	diffComments: DiffComment[]
	openCodeAgents: SdkAgent[]
	isConnected: boolean
	isWorking: boolean
	canSend: boolean
	modelSupportsImages?: boolean
	modelSupportsPdf?: boolean
	selectedAgent: string | null
	defaultAgent?: string
	providers: ProvidersData | null
	effectiveModel: ModelRef | null
	hasModelOverride: boolean
	recentModels: ModelRef[]
	selectedVariant?: string
	currentTurnWorkSplit: { completedMs: number; activeStartMs: number | null } | null
	onSlashTriggerChange: (open: boolean, query: string) => void
	onMentionTriggerChange: (open: boolean, query: string) => void
	onSlashSelect: (command: string) => void
	onSkillsOpen: () => void
	onForkViaSlash: () => Promise<void>
	onSlashClose: () => void
	onMentionSelect: (option: MentionOption) => void
	onMentionClose: () => void
	onMentionRemove: (mention: PromptMention) => void
	onMentionsReconcile: (mentions: PromptMention[]) => void
	onDiffCommentRemove: (id: string) => void
	onTextareaKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void
	onSubmit: (message: { text: string; files: FileAttachment[] }) => void
	onStop: () => void
	onSelectAgent: (agent: string | null) => void
	onSelectModel: (model: ModelRef | null) => void
	onSelectVariant: (variant?: string) => void
}

export function ChatInputCard({
	sessionId,
	directory,
	draft,
	setDraft,
	textControllerRef,
	slashPopoverRef,
	mentionPopoverRef,
	slashOpen,
	slashQuery,
	mentionOpen,
	mentionQuery,
	mentions,
	diffComments,
	openCodeAgents,
	isConnected,
	isWorking,
	canSend,
	modelSupportsImages,
	modelSupportsPdf,
	selectedAgent,
	defaultAgent,
	providers,
	effectiveModel,
	hasModelOverride,
	recentModels,
	selectedVariant,
	currentTurnWorkSplit,
	onSlashTriggerChange,
	onMentionTriggerChange,
	onSlashSelect,
	onSkillsOpen,
	onForkViaSlash,
	onSlashClose,
	onMentionSelect,
	onMentionClose,
	onMentionRemove,
	onMentionsReconcile,
	onDiffCommentRemove,
	onTextareaKeyDown,
	onSubmit,
	onStop,
	onSelectAgent,
	onSelectModel,
	onSelectVariant,
}: ChatInputCardProps) {
	const acceptedAttachmentTypes = (() => {
		const types: string[] = []
		if (modelSupportsImages !== false) types.push(IMAGE_ATTACHMENT_TYPES)
		if (modelSupportsPdf !== false) types.push("application/pdf")
		return types.length > 0 ? types.join(",") : NO_ATTACHMENT_TYPES
	})()
	const attachmentsDisabled =
		!isConnected || (modelSupportsImages === false && modelSupportsPdf === false)

	return (
		<PromptInputProvider key={sessionId} initialInput={draft}>
			<DraftSync setDraft={setDraft} />
			<SlashCommandBridge controllerRef={textControllerRef} />
			<TriggerDetector
				onSlashChange={onSlashTriggerChange}
				onMentionChange={onMentionTriggerChange}
			/>
			<MentionReconciler mentions={mentions} onReconcile={onMentionsReconcile} />
			<div className="relative">
				<SlashCommandPopover
					ref={slashPopoverRef}
					query={slashQuery}
					open={slashOpen}
					enabled={isConnected}
					directory={directory}
					onSelect={onSlashSelect}
					onSkillsOpen={onSkillsOpen}
					onFork={onForkViaSlash}
					onClose={onSlashClose}
				/>
				<MentionPopover
					ref={mentionPopoverRef}
					query={mentionQuery}
					open={mentionOpen}
					directory={directory}
					agents={openCodeAgents}
					onSelect={onMentionSelect}
					onClose={onMentionClose}
				/>
				<PromptInput
					className="rounded-xl"
					accept={acceptedAttachmentTypes}
					multiple
					maxFileSize={10 * 1024 * 1024}
					onSubmit={onSubmit}
				>
					<ContextItems mentions={mentions} onRemove={onMentionRemove} />
					{diffComments.length > 0 && (
						<DiffCommentChips comments={diffComments} onRemove={onDiffCommentRemove} />
					)}
					<PromptAttachmentPreview
						supportsImages={modelSupportsImages}
						supportsPdf={modelSupportsPdf}
					/>
					<PromptInputTextarea
						data-prompt-input
						onKeyDown={onTextareaKeyDown}
						disabled={!isConnected}
						placeholder={isWorking ? "Send a follow-up message..." : "What would you like to do?"}
					/>
					<PromptInputFooter>
						<PromptInputTools>
							<AttachButton disabled={attachmentsDisabled} />
							<PromptToolbar
								agents={openCodeAgents}
								selectedAgent={selectedAgent}
								defaultAgent={defaultAgent}
								onSelectAgent={onSelectAgent}
								providers={providers}
								effectiveModel={effectiveModel}
								hasModelOverride={hasModelOverride}
								onSelectModel={onSelectModel}
								recentModels={recentModels}
								selectedVariant={selectedVariant}
								onSelectVariant={onSelectVariant}
								disabled={!isConnected}
							/>
						</PromptInputTools>
						<PromptInputSubmit
							disabled={!canSend}
							status={isWorking ? "streaming" : undefined}
							onStop={onStop}
							size={isWorking && currentTurnWorkSplit ? "xs" : "icon-sm"}
						>
							{isWorking && currentTurnWorkSplit ? (
								<LiveTurnTimer
									completedMs={currentTurnWorkSplit.completedMs}
									activeStartMs={currentTurnWorkSplit.activeStartMs}
								/>
							) : undefined}
						</PromptInputSubmit>
					</PromptInputFooter>
				</PromptInput>
			</div>
		</PromptInputProvider>
	)
}

interface ChatInputStatusProps {
	vcs: VcsData | null
	isConnected: boolean
	isWorking: boolean
	interruptCount: number
	sessionId: string
	providers?: ProvidersData | null
	compaction?: ConfigData["compaction"]
	worktreePath?: string
}

export function ChatInputStatus({
	vcs,
	isConnected,
	isWorking,
	interruptCount,
	sessionId,
	providers,
	compaction,
	worktreePath,
}: ChatInputStatusProps) {
	return (
		<StatusBar
			vcs={vcs}
			isConnected={isConnected}
			isWorking={isWorking}
			interruptCount={interruptCount}
			sessionId={sessionId}
			providers={providers}
			compaction={compaction}
			extraSlot={
				worktreePath ? (
					<div className="flex items-center gap-1">
						<GitForkIcon className="size-3" />
						<span>Worktree</span>
					</div>
				) : (
					<div className="flex items-center gap-1">
						<MonitorIcon className="size-3" />
						<span>Local</span>
					</div>
				)
			}
		/>
	)
}
