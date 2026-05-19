import {
	PromptInputButton,
	usePromptInputAttachments,
	usePromptInputController,
} from "@palot/ui/components/ai-elements/prompt-input"
import { PlusIcon } from "lucide-react"
import type React from "react"
import { useEffect, useRef } from "react"
import type { PromptMention } from "./prompt-mentions"
import { reconcileMentions } from "./prompt-mentions"

export interface PromptTextController {
	setText: (text: string) => void
	getText: () => string
}

/**
 * Small button that opens the file picker from the PromptInput attachment context.
 */
export function AttachButton({ disabled }: { disabled?: boolean }) {
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

/**
 * Syncs PromptInput text to the persisted draft store after initial hydration.
 */
export function DraftSync({ setDraft }: { setDraft: (text: string) => void }) {
	const controller = usePromptInputController()
	const value = controller.textInput.value
	const isFirstRender = useRef(true)

	useEffect(() => {
		if (isFirstRender.current) {
			isFirstRender.current = false
			return
		}
		setDraft(value)
	}, [value, setDraft])

	return null
}

/**
 * Exposes PromptInput text controls to parent code that handles slash commands.
 */
export function SlashCommandBridge({
	controllerRef,
}: {
	controllerRef: React.RefObject<PromptTextController | null>
}) {
	const controller = usePromptInputController()

	useEffect(() => {
		if (controllerRef && "current" in controllerRef) {
			;(controllerRef as React.MutableRefObject<typeof controllerRef.current>).current = {
				setText: (text: string) => controller.textInput.setInput(text),
				getText: () => controller.textInput.value,
			}
		}
		return () => {
			if (controllerRef && "current" in controllerRef) {
				;(controllerRef as React.MutableRefObject<typeof controllerRef.current>).current = null
			}
		}
	}, [controller, controllerRef])

	return null
}

/**
 * Detects slash command and mention triggers from the current PromptInput text.
 */
export function TriggerDetector({
	onSlashChange,
	onMentionChange,
}: {
	onSlashChange: (open: boolean, query: string) => void
	onMentionChange: (open: boolean, query: string) => void
}) {
	const controller = usePromptInputController()
	const inputText = controller.textInput.value

	useEffect(() => {
		const textarea = document.querySelector<HTMLTextAreaElement>("textarea[data-prompt-input]")
		const cursorPos = textarea?.selectionStart ?? inputText.length
		const textBeforeCursor = inputText.slice(0, cursorPos)

		const slashMatch = inputText.match(/^\/(\S*)$/)
		if (slashMatch) {
			onSlashChange(true, slashMatch[1])
			onMentionChange(false, "")
			return
		}

		const atMatch = textBeforeCursor.match(/@(\S*)$/)
		if (atMatch) {
			onMentionChange(true, atMatch[1])
			onSlashChange(false, "")
			return
		}

		onSlashChange(false, "")
		onMentionChange(false, "")
	}, [inputText, onSlashChange, onMentionChange])

	return null
}

/**
 * Removes mention records when their marker text has been manually deleted.
 */
export function MentionReconciler({
	mentions,
	onReconcile,
}: {
	mentions: PromptMention[]
	onReconcile: (updated: PromptMention[]) => void
}) {
	const controller = usePromptInputController()
	const inputText = controller.textInput.value

	useEffect(() => {
		if (mentions.length === 0) return
		const reconciled = reconcileMentions(mentions, inputText)
		if (reconciled.length !== mentions.length) {
			onReconcile(reconciled)
		}
	}, [inputText, mentions, onReconcile])

	return null
}
