import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@palot/ui/components/collapsible"
import { Tooltip, TooltipContent, TooltipTrigger } from "@palot/ui/components/tooltip"
import { cn } from "@palot/ui/lib/utils"
import { ChevronRightIcon } from "lucide-react"
import type { ReactNode } from "react"
import { memo, useState } from "react"

// ============================================================
// Tool category colors — left-border accent for visual landmarks
// ============================================================

export type ToolCategory =
	| "explore"
	| "edit"
	| "run"
	| "delegate"
	| "plan"
	| "ask"
	| "fetch"
	| "other"

export const TOOL_CATEGORY_COLORS: Record<ToolCategory, string> = {
	explore: "border-l-muted-foreground/30",
	edit: "border-l-amber-500/60",
	run: "border-l-blue-500/60",
	delegate: "border-l-violet-500/60",
	plan: "border-l-emerald-500/60",
	ask: "border-l-cyan-500/60",
	fetch: "border-l-sky-500/60",
	other: "border-l-muted-foreground/20",
}

export function getToolCategory(tool: string): ToolCategory {
	switch (tool) {
		case "read":
		case "glob":
		case "grep":
		case "list":
			return "explore"
		case "edit":
		case "write":
		case "apply_patch":
			return "edit"
		case "bash":
			return "run"
		case "task":
			return "delegate"
		case "todowrite":
		case "todoread":
			return "plan"
		case "question":
			return "ask"
		case "webfetch":
			return "fetch"
		default:
			return "other"
	}
}

// ============================================================
// ToolCard — collapsible wrapper with icon, title, subtitle
// ============================================================

interface ToolCardProps {
	icon: ReactNode
	title: string
	subtitle?: string
	/** Right-aligned element in the header (duration, status, etc.) */
	trailing?: ReactNode
	/** Category for left-border color */
	category?: ToolCategory
	/** Whether the card should be open by default */
	defaultOpen?: boolean
	/** Force the card open (for errors, permissions) */
	forceOpen?: boolean
	/** Whether the card has expandable content */
	hasContent?: boolean
	/** Status indicator */
	status?: "running" | "error" | "completed" | "pending"
	/** Expandable content */
	children?: ReactNode
}

export const ToolCard = memo(function ToolCard({
	icon,
	title,
	subtitle,
	trailing,
	category = "other",
	defaultOpen = false,
	forceOpen = false,
	hasContent = false,
	status,
	children,
}: ToolCardProps) {
	const [isOpen, setIsOpen] = useState(defaultOpen || forceOpen)
	const showContent = hasContent && children != null
	const borderColor = TOOL_CATEGORY_COLORS[category]

	const isError = status === "error"
	const isRunning = status === "running" || status === "pending"

	if (!showContent) {
		// Non-expandable: simple row
		return (
			<div
				className={cn(
					"flex items-center gap-2.5 rounded-md border-l-2 px-3 py-2 text-sm",
					borderColor,
					isError && "bg-red-500/5",
				)}
			>
				<span
					className={cn(
						"shrink-0",
						isError
							? "text-red-400"
							: isRunning
								? "text-muted-foreground animate-pulse"
								: "text-muted-foreground",
					)}
				>
					{icon}
				</span>
				<span
					className={cn(
						"min-w-0 truncate font-medium",
						isError ? "text-red-400" : "text-foreground/80",
					)}
				>
					{title}
				</span>
				{subtitle && (
					<Tooltip>
						<TooltipTrigger asChild>
							<span className="min-w-0 truncate text-muted-foreground/60">{subtitle}</span>
						</TooltipTrigger>
						<TooltipContent side="top" className="max-w-sm">
							<p className="break-all text-xs">{subtitle}</p>
						</TooltipContent>
					</Tooltip>
				)}
				{trailing && <span className="ml-auto shrink-0 text-muted-foreground/40">{trailing}</span>}
			</div>
		)
	}

	// Expandable: collapsible card
	return (
		<Collapsible open={forceOpen || isOpen} onOpenChange={forceOpen ? undefined : setIsOpen}>
			<div
				className={cn(
					"overflow-hidden rounded-md border-l-2",
					borderColor,
					isError && "bg-red-500/5",
				)}
			>
				<CollapsibleTrigger asChild>
					<button
						type="button"
						className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors hover:bg-muted/50"
					>
						<ChevronRightIcon
							className={cn(
								"size-3 shrink-0 text-muted-foreground/50 transition-transform",
								(forceOpen || isOpen) && "rotate-90",
							)}
						/>
						<span
							className={cn(
								"shrink-0",
								isError
									? "text-red-400"
									: isRunning
										? "text-muted-foreground animate-pulse"
										: "text-muted-foreground",
							)}
						>
							{icon}
						</span>
						<span
							className={cn(
								"min-w-0 truncate font-medium",
								isError ? "text-red-400" : "text-foreground/80",
							)}
						>
							{title}
						</span>
						{subtitle && (
							<span className="min-w-0 truncate text-muted-foreground/60">{subtitle}</span>
						)}
						{trailing && (
							<span className="ml-auto shrink-0 text-muted-foreground/40">{trailing}</span>
						)}
					</button>
				</CollapsibleTrigger>
				<CollapsibleContent>
					<div className="border-t border-border/50">{children}</div>
				</CollapsibleContent>
			</div>
		</Collapsible>
	)
})
