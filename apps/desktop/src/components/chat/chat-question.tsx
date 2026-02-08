import { Button } from "@codedeck/ui/components/button"
import { Loader2Icon, MessageCircleQuestionIcon } from "lucide-react"
import { memo, useCallback, useEffect, useRef, useState } from "react"
import type { QuestionAnswer, QuestionInfo, QuestionRequest } from "../../lib/types"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChatQuestionCardProps {
	question: QuestionRequest
	onReply: (requestId: string, answers: QuestionAnswer[]) => Promise<void>
	onReject: (requestId: string) => Promise<void>
	disabled?: boolean
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build the final answers array from selections + custom text per question. */
function buildAnswers(
	questions: QuestionInfo[],
	selections: Map<number, Set<string>>,
	customTexts: Map<number, string>,
): QuestionAnswer[] {
	return questions.map((_, idx) => {
		const selected = Array.from(selections.get(idx) ?? [])
		const custom = (customTexts.get(idx) ?? "").trim()
		if (custom) selected.push(custom)
		return selected
	})
}

/** Check that every question has at least one answer selected or typed. */
function isComplete(
	questions: QuestionInfo[],
	selections: Map<number, Set<string>>,
	customTexts: Map<number, string>,
): boolean {
	return questions.every((_, idx) => {
		const selected = selections.get(idx)
		const custom = (customTexts.get(idx) ?? "").trim()
		return (selected && selected.size > 0) || custom.length > 0
	})
}

// ---------------------------------------------------------------------------
// Sub-component: single question renderer
// ---------------------------------------------------------------------------

interface QuestionSectionProps {
	info: QuestionInfo
	index: number
	selected: Set<string>
	customText: string
	onToggle: (index: number, label: string) => void
	onCustomChange: (index: number, value: string) => void
	disabled: boolean
}

function QuestionSection({
	info,
	index,
	selected,
	customText,
	onToggle,
	onCustomChange,
	disabled,
}: QuestionSectionProps) {
	const isMultiple = info.multiple === true
	const allowCustom = info.custom !== false

	return (
		<fieldset aria-label={info.header} className="border-none p-0 m-0">
			{/* Options */}
			<div className="space-y-0.5 px-3 pt-2 pb-1">
				{info.options.map((option: { label: string; description: string }) => {
					const isSelected = selected.has(option.label)

					return (
						<button
							key={option.label}
							type="button"
							aria-pressed={isSelected}
							onClick={() => onToggle(index, option.label)}
							disabled={disabled}
							className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
								isSelected ? "bg-muted" : "hover:bg-muted/50"
							} ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
						>
							{/* Radio / checkbox indicator */}
							<span
								className={`flex size-3.5 shrink-0 items-center justify-center border transition-colors ${
									isMultiple ? "rounded" : "rounded-full"
								} ${isSelected ? "border-foreground bg-foreground" : "border-muted-foreground/40"}`}
								aria-hidden="true"
							>
								{isSelected && (
									<svg
										viewBox="0 0 12 12"
										className="size-2 fill-current text-background"
										aria-hidden="true"
									>
										{isMultiple ? (
											<path
												d="M10 3L4.5 8.5L2 6"
												fill="none"
												stroke="currentColor"
												strokeWidth="2"
												strokeLinecap="round"
												strokeLinejoin="round"
											/>
										) : (
											<circle cx="6" cy="6" r="3" />
										)}
									</svg>
								)}
							</span>

							{/* Label + description inline */}
							<span className="min-w-0 flex-1 truncate">
								<span className="text-foreground">{option.label}</span>
								{option.description && (
									<span className="text-muted-foreground"> — {option.description}</span>
								)}
							</span>
						</button>
					)
				})}
			</div>

			{/* Custom text input */}
			{allowCustom && (
				<div className="px-3 pb-2 pt-1">
					<input
						id={`question-custom-${index}`}
						type="text"
						value={customText}
						onChange={(e) => onCustomChange(index, e.target.value)}
						placeholder="Type a custom answer..."
						disabled={disabled}
						className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/50 transition-colors focus:border-muted-foreground focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
					/>
				</div>
			)}
		</fieldset>
	)
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export const ChatQuestionCard = memo(function ChatQuestionCard({
	question,
	onReply,
	onReject,
	disabled = false,
}: ChatQuestionCardProps) {
	const [selections, setSelections] = useState<Map<number, Set<string>>>(() => new Map())
	const [customTexts, setCustomTexts] = useState<Map<number, string>>(() => new Map())
	const [submitting, setSubmitting] = useState(false)
	const cardRef = useRef<HTMLElement>(null)

	const questions = question.questions

	const canSubmit = !disabled && !submitting && isComplete(questions, selections, customTexts)

	// --- Selection toggle ---
	const handleToggle = useCallback(
		(questionIndex: number, label: string) => {
			setSelections((prev) => {
				const next = new Map(prev)
				const current = new Set(next.get(questionIndex) ?? [])
				const info = questions[questionIndex]
				const isMultiple = info?.multiple === true

				if (current.has(label)) {
					current.delete(label)
				} else {
					if (!isMultiple) {
						current.clear()
					}
					current.add(label)
				}

				next.set(questionIndex, current)
				return next
			})
		},
		[questions],
	)

	// --- Custom text change ---
	const handleCustomChange = useCallback((questionIndex: number, value: string) => {
		setCustomTexts((prev) => {
			const next = new Map(prev)
			next.set(questionIndex, value)
			return next
		})
	}, [])

	// --- Submit ---
	const handleSubmit = useCallback(async () => {
		if (!canSubmit) return
		setSubmitting(true)
		try {
			const answers = buildAnswers(questions, selections, customTexts)
			await onReply(question.id, answers)
		} finally {
			setSubmitting(false)
		}
	}, [canSubmit, questions, selections, customTexts, onReply, question.id])

	// --- Dismiss ---
	const handleDismiss = useCallback(async () => {
		if (disabled || submitting) return
		setSubmitting(true)
		try {
			await onReject(question.id)
		} finally {
			setSubmitting(false)
		}
	}, [disabled, submitting, onReject, question.id])

	// --- Keyboard shortcuts ---
	useEffect(() => {
		function handleKeyDown(e: KeyboardEvent) {
			if (
				!cardRef.current?.contains(document.activeElement) &&
				document.activeElement !== cardRef.current
			) {
				return
			}

			if (e.key === "Enter" && !e.shiftKey && canSubmit) {
				e.preventDefault()
				handleSubmit()
			} else if (e.key === "Escape") {
				e.preventDefault()
				handleDismiss()
			}
		}

		document.addEventListener("keydown", handleKeyDown)
		return () => document.removeEventListener("keydown", handleKeyDown)
	}, [canSubmit, handleSubmit, handleDismiss])

	// --- Auto-focus the card on mount for keyboard accessibility ---
	useEffect(() => {
		cardRef.current?.focus()
	}, [])

	return (
		<section
			ref={cardRef}
			tabIndex={-1}
			aria-label="Agent question"
			className="mb-2 animate-in fade-in slide-in-from-bottom-2 rounded-xl border border-border bg-card outline-none duration-300"
		>
			{/* Questions */}
			{questions.map((q: QuestionInfo, idx: number) => (
				<div key={`${question.id}-q-${idx}`}>
					{/* Header row */}
					<div
						className={`flex items-center gap-2 px-3 py-2 text-sm ${
							idx > 0 ? "border-t border-border" : ""
						}`}
					>
						<MessageCircleQuestionIcon
							className="size-4 shrink-0 text-muted-foreground"
							aria-hidden="true"
						/>
						<span className="flex-1 text-foreground">{q.question}</span>
					</div>

					{/* Content */}
					<div className="border-t border-border">
						<QuestionSection
							info={q}
							index={idx}
							selected={selections.get(idx) ?? new Set()}
							customText={customTexts.get(idx) ?? ""}
							onToggle={handleToggle}
							onCustomChange={handleCustomChange}
							disabled={disabled || submitting}
						/>
					</div>
				</div>
			))}

			{/* Footer */}
			<div className="flex items-center justify-end gap-2 border-t border-border px-3 py-2">
				<button
					type="button"
					onClick={handleDismiss}
					disabled={disabled || submitting}
					className="text-xs text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
					aria-label="Skip question"
				>
					Skip
				</button>
				<Button
					size="sm"
					onClick={handleSubmit}
					disabled={!canSubmit}
					className="h-7 text-xs"
					aria-label="Send answer"
				>
					{submitting && <Loader2Icon className="size-3 animate-spin" aria-hidden="true" />}
					Send
				</Button>
			</div>
		</section>
	)
})
