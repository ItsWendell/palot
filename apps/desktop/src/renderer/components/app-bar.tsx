import { Button } from "@codedeck/ui/components/button"
import { Popover, PopoverContent, PopoverTrigger } from "@codedeck/ui/components/popover"
import { Separator } from "@codedeck/ui/components/separator"
import { useSidebar } from "@codedeck/ui/components/sidebar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@codedeck/ui/components/tooltip"
import { useNavigate } from "@tanstack/react-router"
import {
	CheckIcon,
	CopyIcon,
	NetworkIcon,
	PanelLeftIcon,
	PlusIcon,
	SearchIcon,
	TerminalIcon,
} from "lucide-react"
import { useCallback, useState } from "react"
import { useServerConnection } from "../hooks/use-server"
import { useAppBarContent } from "./app-bar-context"

// Height of the app bar in pixels — used as CSS variable
export const APP_BAR_HEIGHT = 46

/**
 * Detect whether we're running inside Electron (preload injects `window.codedeck`).
 */
function isElectron(): boolean {
	return typeof window !== "undefined" && "codedeck" in window
}

/**
 * Get the platform for traffic light padding.
 */
function getPlatform(): NodeJS.Platform | "browser" {
	if (isElectron()) return window.codedeck.platform
	return "browser"
}

interface AppBarProps {
	onOpenCommandPalette: () => void
	showSubAgents: boolean
	subAgentCount: number
	onToggleSubAgents: () => void
}

export function AppBar({
	onOpenCommandPalette,
	showSubAgents,
	subAgentCount,
	onToggleSubAgents,
}: AppBarProps) {
	const { state, toggleSidebar } = useSidebar()
	const isSidebarOpen = state === "expanded"
	const navigate = useNavigate()
	const pageContent = useAppBarContent()
	const platform = getPlatform()
	const isMac = platform === "darwin"

	return (
		<div
			className="relative z-30 flex shrink-0 items-center border-b border-border bg-sidebar"
			style={{
				height: APP_BAR_HEIGHT,
				// macOS traffic lights: hiddenInset places them at ~15,15 — reserve space
				paddingLeft: isMac && isElectron() ? 72 : 0,
				// Make entire bar draggable on Electron (title bar replacement)
				// @ts-expect-error -- vendor-prefixed CSS property
				WebkitAppRegionValue: undefined,
			}}
		>
			{/* Drag region overlay (only in Electron) */}
			{isElectron() && (
				<div
					className="pointer-events-none absolute inset-0"
					style={{
						// @ts-expect-error -- vendor-prefixed CSS property
						WebkitAppRegion: "drag",
					}}
				/>
			)}

			{/* ===== Left section ===== */}
			<div
				className="relative z-10 flex shrink-0 items-center gap-1 overflow-hidden px-3 transition-[min-width] duration-300 ease-in-out"
				style={{
					minWidth: isSidebarOpen ? "var(--sidebar-width)" : undefined,
					// @ts-expect-error -- vendor-prefixed CSS property
					WebkitAppRegion: "no-drag",
				}}
			>
				{/* Sidebar toggle */}
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							variant="ghost"
							size="icon"
							className="size-7 shrink-0"
							onClick={toggleSidebar}
							aria-label={isSidebarOpen ? "Hide sidebar" : "Show sidebar"}
						>
							<PanelLeftIcon className="size-4" />
						</Button>
					</TooltipTrigger>
					<TooltipContent>Toggle sidebar (&#8984;B)</TooltipContent>
				</Tooltip>

				{/* New session — always visible but more prominent when sidebar hidden */}
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							variant="ghost"
							size="icon"
							className={`size-7 shrink-0 transition-opacity duration-200 ${
								isSidebarOpen ? "pointer-events-none opacity-0" : "opacity-100"
							}`}
							onClick={() => navigate({ to: "/" })}
						>
							<PlusIcon className="size-4" />
						</Button>
					</TooltipTrigger>
					<TooltipContent>New session (&#8984;N)</TooltipContent>
				</Tooltip>

				{/* Sub-agent toggle */}
				{subAgentCount > 0 && (
					<Tooltip>
						<TooltipTrigger asChild>
							<button
								type="button"
								onClick={onToggleSubAgents}
								className={`inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs transition-all duration-200 ${
									isSidebarOpen ? "pointer-events-none opacity-0" : ""
								} ${
									showSubAgents
										? "bg-accent text-accent-foreground"
										: "text-muted-foreground hover:bg-muted hover:text-foreground"
								}`}
								style={{
									// @ts-expect-error -- vendor-prefixed CSS property
									WebkitAppRegion: "no-drag",
								}}
							>
								<NetworkIcon className="size-3" />
								<span>{subAgentCount}</span>
							</button>
						</TooltipTrigger>
						<TooltipContent>
							{showSubAgents ? "Hide" : "Show"} sub-agents ({subAgentCount})
						</TooltipContent>
					</Tooltip>
				)}

				{/* Search — visible when sidebar hidden */}
				<Tooltip>
					<TooltipTrigger asChild>
						<button
							type="button"
							onClick={onOpenCommandPalette}
							className={`shrink-0 rounded-md p-1 text-muted-foreground transition-all duration-200 hover:bg-muted hover:text-foreground ${
								isSidebarOpen ? "pointer-events-none opacity-0" : ""
							}`}
							style={{
								// @ts-expect-error -- vendor-prefixed CSS property
								WebkitAppRegion: "no-drag",
							}}
						>
							<SearchIcon className="size-3.5" />
						</button>
					</TooltipTrigger>
					<TooltipContent>Search sessions (&#8984;K)</TooltipContent>
				</Tooltip>

				{/* Terminal attach — visible when sidebar hidden */}
				<span
					className={`transition-all duration-200 ${
						isSidebarOpen ? "pointer-events-none opacity-0" : ""
					}`}
				>
					<GlobalAttachCommand />
				</span>
			</div>

			{/* ===== Divider — only shown when there's page content ===== */}
			{pageContent && <Separator orientation="vertical" className="h-5" />}

			{/* ===== Right section (page-specific content via portal) ===== */}
			<div
				className="flex min-w-0 flex-1 items-center px-3"
				style={{
					// @ts-expect-error -- vendor-prefixed CSS property
					WebkitAppRegion: "no-drag",
				}}
			>
				{/* App title — visible when sidebar is collapsed and no page content */}
				{!isSidebarOpen && !pageContent && (
					<h1 className="text-sm font-semibold tracking-tight text-foreground">Codedeck</h1>
				)}
				{pageContent}
			</div>
		</div>
	)
}

// ============================================================
// Global attach command (app bar)
// ============================================================

function GlobalAttachCommand() {
	const { url } = useServerConnection()
	const [copied, setCopied] = useState(false)
	const [open, setOpen] = useState(false)

	const serverUrl = url ?? "http://127.0.0.1:4101"
	const command = `opencode attach ${serverUrl} --dir .`

	const handleOpen = useCallback(
		async (nextOpen: boolean) => {
			if (nextOpen) {
				await navigator.clipboard.writeText(command)
				setCopied(true)
				setTimeout(() => setCopied(false), 2000)
			}
			setOpen(nextOpen)
		},
		[command],
	)

	const handleCopy = useCallback(async () => {
		await navigator.clipboard.writeText(command)
		setCopied(true)
		setTimeout(() => setCopied(false), 2000)
	}, [command])

	return (
		<Popover open={open} onOpenChange={handleOpen}>
			<Tooltip>
				<TooltipTrigger asChild>
					<PopoverTrigger asChild>
						<button
							type="button"
							className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
						>
							<TerminalIcon className="size-3.5" />
						</button>
					</PopoverTrigger>
				</TooltipTrigger>
				<TooltipContent>Attach from terminal</TooltipContent>
			</Tooltip>
			<PopoverContent align="start" className="w-auto max-w-sm p-3">
				<div className="flex flex-col gap-2">
					<div className="flex items-center gap-1.5">
						<CheckIcon className="size-3 text-green-500" />
						<p className="text-xs font-medium">Copied to clipboard</p>
					</div>
					<div className="flex items-center gap-1.5">
						<code className="flex-1 rounded-md bg-muted px-2.5 py-1.5 font-mono text-[11px] leading-relaxed text-foreground select-all">
							{command}
						</code>
						<Button size="sm" variant="ghost" className="h-7 w-7 shrink-0 p-0" onClick={handleCopy}>
							{copied ? (
								<CheckIcon className="size-3.5 text-green-500" />
							) : (
								<CopyIcon className="size-3.5" />
							)}
						</Button>
					</div>
					<p className="text-[11px] leading-normal text-muted-foreground">
						Run from your project directory. Sessions will appear here automatically.
					</p>
				</div>
			</PopoverContent>
		</Popover>
	)
}
