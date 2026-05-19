import { useCallback, useState } from "react"
import type { PromptTextController } from "./prompt-input-bridges"

export function useChatSkills({
	textControllerRef,
	onForkFromTurn,
}: {
	textControllerRef: React.RefObject<PromptTextController | null>
	onForkFromTurn?: (messageId?: string) => Promise<void>
}) {
	const [skillsDialogOpen, setSkillsDialogOpen] = useState(false)

	const handleForkViaSlash = useCallback(async () => {
		const ctrl = textControllerRef.current
		if (ctrl) ctrl.setText("")
		await onForkFromTurn?.()
	}, [onForkFromTurn, textControllerRef])

	const handleSkillsOpen = useCallback(() => {
		const ctrl = textControllerRef.current
		if (ctrl) ctrl.setText("")
		setSkillsDialogOpen(true)
	}, [textControllerRef])

	const handleSkillSelect = useCallback(
		(skillName: string) => {
			const ctrl = textControllerRef.current
			if (ctrl) {
				ctrl.setText(`/${skillName} `)
			}
			requestAnimationFrame(() => {
				const ta = document.querySelector<HTMLTextAreaElement>("textarea[data-prompt-input]")
				if (ta) {
					ta.focus()
					const len = `/${skillName} `.length
					ta.setSelectionRange(len, len)
				}
			})
		},
		[textControllerRef],
	)

	return {
		skillsDialogOpen,
		setSkillsDialogOpen,
		handleForkViaSlash,
		handleSkillsOpen,
		handleSkillSelect,
	}
}
