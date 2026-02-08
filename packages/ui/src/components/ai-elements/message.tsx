"use client"

import { Button } from "@codedeck/ui/components/button"
import { ButtonGroup, ButtonGroupText } from "@codedeck/ui/components/button-group"
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@codedeck/ui/components/tooltip"
import { cn } from "@codedeck/ui/lib/utils"
import { cjk } from "@streamdown/cjk"
import { code } from "@streamdown/code"
import { math } from "@streamdown/math"
import { mermaid } from "@streamdown/mermaid"
import type { UIMessage } from "ai"
import {
	CheckIcon,
	ChevronLeftIcon,
	ChevronRightIcon,
	CopyIcon,
	ExternalLinkIcon,
	XIcon,
} from "lucide-react"
import type { ComponentProps, HTMLAttributes, ReactElement } from "react"
import { createContext, memo, useCallback, useContext, useEffect, useMemo, useState } from "react"
import type { LinkSafetyConfig, LinkSafetyModalProps } from "streamdown"
import { Streamdown } from "streamdown"

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
	from: UIMessage["role"]
}

export const Message = ({ className, from, ...props }: MessageProps) => (
	<div
		className={cn(
			"group flex w-full max-w-[95%] flex-col gap-2",
			from === "user" ? "is-user ml-auto justify-end" : "is-assistant",
			className,
		)}
		{...props}
	/>
)

export type MessageContentProps = HTMLAttributes<HTMLDivElement>

export const MessageContent = ({ children, className, ...props }: MessageContentProps) => (
	<div
		className={cn(
			"is-user:dark flex w-fit min-w-0 max-w-full flex-col gap-2 overflow-hidden text-sm",
			"group-[.is-user]:ml-auto group-[.is-user]:rounded-lg group-[.is-user]:bg-secondary group-[.is-user]:px-4 group-[.is-user]:py-3 group-[.is-user]:text-foreground",
			"group-[.is-assistant]:text-foreground",
			className,
		)}
		{...props}
	>
		{children}
	</div>
)

export type MessageActionsProps = ComponentProps<"div">

export const MessageActions = ({ className, children, ...props }: MessageActionsProps) => (
	<div className={cn("flex items-center gap-1", className)} {...props}>
		{children}
	</div>
)

export type MessageActionProps = ComponentProps<typeof Button> & {
	tooltip?: string
	label?: string
}

export const MessageAction = ({
	tooltip,
	children,
	label,
	variant = "ghost",
	size = "icon-sm",
	...props
}: MessageActionProps) => {
	const button = (
		<Button size={size} type="button" variant={variant} {...props}>
			{children}
			<span className="sr-only">{label || tooltip}</span>
		</Button>
	)

	if (tooltip) {
		return (
			<TooltipProvider>
				<Tooltip>
					<TooltipTrigger asChild>{button}</TooltipTrigger>
					<TooltipContent>
						<p>{tooltip}</p>
					</TooltipContent>
				</Tooltip>
			</TooltipProvider>
		)
	}

	return button
}

interface MessageBranchContextType {
	currentBranch: number
	totalBranches: number
	goToPrevious: () => void
	goToNext: () => void
	branches: ReactElement[]
	setBranches: (branches: ReactElement[]) => void
}

const MessageBranchContext = createContext<MessageBranchContextType | null>(null)

const useMessageBranch = () => {
	const context = useContext(MessageBranchContext)

	if (!context) {
		throw new Error("MessageBranch components must be used within MessageBranch")
	}

	return context
}

export type MessageBranchProps = HTMLAttributes<HTMLDivElement> & {
	defaultBranch?: number
	onBranchChange?: (branchIndex: number) => void
}

export const MessageBranch = ({
	defaultBranch = 0,
	onBranchChange,
	className,
	...props
}: MessageBranchProps) => {
	const [currentBranch, setCurrentBranch] = useState(defaultBranch)
	const [branches, setBranches] = useState<ReactElement[]>([])

	const handleBranchChange = useCallback(
		(newBranch: number) => {
			setCurrentBranch(newBranch)
			onBranchChange?.(newBranch)
		},
		[onBranchChange],
	)

	const goToPrevious = useCallback(() => {
		const newBranch = currentBranch > 0 ? currentBranch - 1 : branches.length - 1
		handleBranchChange(newBranch)
	}, [currentBranch, branches.length, handleBranchChange])

	const goToNext = useCallback(() => {
		const newBranch = currentBranch < branches.length - 1 ? currentBranch + 1 : 0
		handleBranchChange(newBranch)
	}, [currentBranch, branches.length, handleBranchChange])

	const contextValue = useMemo<MessageBranchContextType>(
		() => ({
			branches,
			currentBranch,
			goToNext,
			goToPrevious,
			setBranches,
			totalBranches: branches.length,
		}),
		[branches, currentBranch, goToNext, goToPrevious],
	)

	return (
		<MessageBranchContext.Provider value={contextValue}>
			<div className={cn("grid w-full gap-2 [&>div]:pb-0", className)} {...props} />
		</MessageBranchContext.Provider>
	)
}

export type MessageBranchContentProps = HTMLAttributes<HTMLDivElement>

export const MessageBranchContent = ({ children, ...props }: MessageBranchContentProps) => {
	const { currentBranch, setBranches, branches } = useMessageBranch()
	const childrenArray = useMemo(() => (Array.isArray(children) ? children : [children]), [children])

	// Use useEffect to update branches when they change
	useEffect(() => {
		if (branches.length !== childrenArray.length) {
			setBranches(childrenArray)
		}
	}, [childrenArray, branches, setBranches])

	return childrenArray.map((branch, index) => (
		<div
			className={cn(
				"grid gap-2 overflow-hidden [&>div]:pb-0",
				index === currentBranch ? "block" : "hidden",
			)}
			key={branch.key}
			{...props}
		>
			{branch}
		</div>
	))
}

export type MessageBranchSelectorProps = ComponentProps<typeof ButtonGroup>

export const MessageBranchSelector = ({ className, ...props }: MessageBranchSelectorProps) => {
	const { totalBranches } = useMessageBranch()

	// Don't render if there's only one branch
	if (totalBranches <= 1) {
		return null
	}

	return (
		<ButtonGroup
			className={cn(
				"[&>*:not(:first-child)]:rounded-l-md [&>*:not(:last-child)]:rounded-r-md",
				className,
			)}
			orientation="horizontal"
			{...props}
		/>
	)
}

export type MessageBranchPreviousProps = ComponentProps<typeof Button>

export const MessageBranchPrevious = ({ children, ...props }: MessageBranchPreviousProps) => {
	const { goToPrevious, totalBranches } = useMessageBranch()

	return (
		<Button
			aria-label="Previous branch"
			disabled={totalBranches <= 1}
			onClick={goToPrevious}
			size="icon-sm"
			type="button"
			variant="ghost"
			{...props}
		>
			{children ?? <ChevronLeftIcon size={14} />}
		</Button>
	)
}

export type MessageBranchNextProps = ComponentProps<typeof Button>

export const MessageBranchNext = ({ children, ...props }: MessageBranchNextProps) => {
	const { goToNext, totalBranches } = useMessageBranch()

	return (
		<Button
			aria-label="Next branch"
			disabled={totalBranches <= 1}
			onClick={goToNext}
			size="icon-sm"
			type="button"
			variant="ghost"
			{...props}
		>
			{children ?? <ChevronRightIcon size={14} />}
		</Button>
	)
}

export type MessageBranchPageProps = HTMLAttributes<HTMLSpanElement>

export const MessageBranchPage = ({ className, ...props }: MessageBranchPageProps) => {
	const { currentBranch, totalBranches } = useMessageBranch()

	return (
		<ButtonGroupText
			className={cn("border-none bg-transparent text-muted-foreground shadow-none", className)}
			{...props}
		>
			{currentBranch + 1} of {totalBranches}
		</ButtonGroupText>
	)
}

export type MessageResponseProps = ComponentProps<typeof Streamdown>

const streamdownPlugins = { cjk, code, math, mermaid }

/**
 * Compact link safety modal that replaces streamdown's full-viewport default.
 */
function CompactLinkSafetyModal({ url, isOpen, onClose, onConfirm }: LinkSafetyModalProps) {
	const [copied, setCopied] = useState(false)

	const handleCopy = useCallback(async () => {
		try {
			await navigator.clipboard.writeText(url)
			setCopied(true)
			setTimeout(() => setCopied(false), 2000)
		} catch {}
	}, [url])

	const handleConfirm = useCallback(() => {
		onConfirm()
		onClose()
	}, [onConfirm, onClose])

	useEffect(() => {
		if (!isOpen) return
		const handleKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose()
		}
		document.addEventListener("keydown", handleKey)
		return () => document.removeEventListener("keydown", handleKey)
	}, [isOpen, onClose])

	if (!isOpen) return null

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: backdrop overlay dismiss
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
			onClick={onClose}
			onKeyDown={(e) => {
				if (e.key === "Escape") onClose()
			}}
		>
			{/* biome-ignore lint/a11y/noStaticElementInteractions: stop-propagation wrapper */}
			<div
				className="relative mx-4 flex w-full max-w-sm flex-col gap-3 rounded-lg border bg-background p-4 shadow-lg"
				onClick={(e) => e.stopPropagation()}
				onKeyDown={(e) => e.stopPropagation()}
			>
				<button
					className="absolute top-3 right-3 rounded-md p-0.5 text-muted-foreground transition-colors hover:text-foreground"
					onClick={onClose}
					title="Close"
					type="button"
				>
					<XIcon className="size-4" />
				</button>

				<div className="flex items-center gap-2 pr-6">
					<ExternalLinkIcon className="size-4 shrink-0 text-muted-foreground" />
					<span className="text-sm font-medium">Open external link?</span>
				</div>

				<div
					className={cn(
						"break-all rounded-md bg-muted px-3 py-2 font-mono text-xs text-muted-foreground",
						url.length > 100 && "max-h-24 overflow-y-auto",
					)}
				>
					{url}
				</div>

				<div className="flex gap-2">
					<Button variant="outline" size="sm" className="flex-1 gap-1.5" onClick={handleCopy}>
						{copied ? (
							<>
								<CheckIcon className="size-3" />
								Copied
							</>
						) : (
							<>
								<CopyIcon className="size-3" />
								Copy link
							</>
						)}
					</Button>
					<Button size="sm" className="flex-1 gap-1.5" onClick={handleConfirm}>
						<ExternalLinkIcon className="size-3" />
						Open link
					</Button>
				</div>
			</div>
		</div>
	)
}

const linkSafetyConfig: LinkSafetyConfig = {
	enabled: true,
	renderModal: (props) => <CompactLinkSafetyModal {...props} />,
}

export const MessageResponse = memo(
	({ className, ...props }: MessageResponseProps) => (
		<Streamdown
			className={cn("size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0", className)}
			plugins={streamdownPlugins}
			linkSafety={linkSafetyConfig}
			{...props}
		/>
	),
	(prevProps, nextProps) => prevProps.children === nextProps.children,
)

MessageResponse.displayName = "MessageResponse"

export type MessageToolbarProps = ComponentProps<"div">

export const MessageToolbar = ({ className, children, ...props }: MessageToolbarProps) => (
	<div className={cn("mt-4 flex w-full items-center justify-between gap-4", className)} {...props}>
		{children}
	</div>
)
