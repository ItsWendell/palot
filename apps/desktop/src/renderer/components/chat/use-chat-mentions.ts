import { useCallback, useEffect, useRef, useState } from "react"
import type { MentionOption, MentionPopoverHandle } from "./mention-popover"
import {
	createAgentMention,
	createFileMention,
	getMentionMarker,
	insertMentionIntoText,
	type PromptMention,
} from "./prompt-mentions"
import type { PromptTextController } from "./prompt-input-bridges"

function mentionKey(mention: PromptMention): string {
	return mention.type === "file" ? `file:${mention.path}` : `agent:${mention.name}`
}

export function useChatMentions({
	sessionId,
	textControllerRef,
}: {
	sessionId: string
	textControllerRef: React.RefObject<PromptTextController | null>
}) {
	const [mentions, setMentions] = useState<PromptMention[]>([])
	const [mentionOpen, setMentionOpen] = useState(false)
	const [mentionQuery, setMentionQuery] = useState("")
	const mentionPopoverRef = useRef<MentionPopoverHandle>(null)

	useEffect(() => {
		setMentions([])
	}, [sessionId])

	const handleMentionTriggerChange = useCallback((open: boolean, query: string) => {
		setMentionOpen(open)
		setMentionQuery(query)
	}, [])

	const handleMentionClose = useCallback(() => {
		setMentionOpen(false)
		setMentionQuery("")
	}, [])

	const handleMentionSelect = useCallback(
		(option: MentionOption) => {
			handleMentionClose()
			const ctrl = textControllerRef.current
			if (!ctrl) return

			const currentText = ctrl.getText()
			const textarea = document.querySelector<HTMLTextAreaElement>("textarea[data-prompt-input]")
			const cursorPos = textarea?.selectionStart ?? currentText.length

			const mention =
				option.type === "file" ? createFileMention(option.path) : createAgentMention(option.name)

			const { text: newText, cursorPosition: newCursor } = insertMentionIntoText(
				currentText,
				cursorPos,
				mention,
			)

			ctrl.setText(newText)

			setMentions((prev) => {
				const key = mentionKey(mention)
				if (prev.some((m) => mentionKey(m) === key)) return prev
				return [...prev, mention]
			})

			requestAnimationFrame(() => {
				const ta = document.querySelector<HTMLTextAreaElement>("textarea[data-prompt-input]")
				if (ta) {
					ta.focus()
					ta.setSelectionRange(newCursor, newCursor)
				}
			})
		},
		[handleMentionClose, textControllerRef],
	)

	const handleMentionRemove = useCallback(
		(mention: PromptMention) => {
			const ctrl = textControllerRef.current
			if (ctrl) {
				const marker = getMentionMarker(mention)
				const currentText = ctrl.getText()
				ctrl.setText(currentText.replace(`${marker} `, "").replace(marker, ""))
			}
			setMentions((prev) => prev.filter((m) => mentionKey(m) !== mentionKey(mention)))
		},
		[textControllerRef],
	)

	return {
		mentions,
		setMentions,
		mentionOpen,
		mentionQuery,
		mentionPopoverRef,
		handleMentionTriggerChange,
		handleMentionClose,
		handleMentionSelect,
		handleMentionRemove,
	}
}
