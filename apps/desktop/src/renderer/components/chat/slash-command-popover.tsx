import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandItem,
	CommandList,
} from "@codedeck/ui/components/command"
import { Popover, PopoverContent, PopoverTrigger } from "@codedeck/ui/components/popover"
import {
	FileTextIcon,
	type LucideIcon,
	Redo2Icon,
	SparklesIcon,
	TerminalIcon,
	Undo2Icon,
} from "lucide-react"
import { memo, useCallback, useEffect, useMemo, useState } from "react"
import { useServerCommands } from "../../hooks/use-opencode-data"

// ============================================================
// Types
// ============================================================

interface SlashCommandItem {
	name: string
	description: string
	icon: LucideIcon
	source: "client" | "server"
}

interface SlashCommandPopoverProps {
	/** The current text in the textarea */
	inputText: string
	/** Whether the popover should be active (connected, has session, etc.) */
	enabled: boolean
	/** Directory for fetching server commands */
	directory: string | null
	/** Callback when a command is selected */
	onSelect: (command: string) => void
	/** Anchor element (the textarea) */
	children: React.ReactNode
}

// ============================================================
// Built-in client commands
// ============================================================

const CLIENT_COMMANDS: SlashCommandItem[] = [
	{ name: "undo", description: "Undo the last turn", icon: Undo2Icon, source: "client" },
	{ name: "redo", description: "Redo previously undone turn", icon: Redo2Icon, source: "client" },
	{
		name: "compact",
		description: "Summarize conversation to save context",
		icon: SparklesIcon,
		source: "client",
	},
]

function getCommandIcon(name: string): LucideIcon {
	switch (name) {
		case "init":
			return FileTextIcon
		case "review":
			return SparklesIcon
		default:
			return TerminalIcon
	}
}

// ============================================================
// SlashCommandPopover
// ============================================================

/**
 * A popover that appears when the user types "/" at the start of input.
 * Shows available slash commands filtered by query text.
 */
export const SlashCommandPopover = memo(function SlashCommandPopover({
	inputText,
	enabled,
	directory,
	onSelect,
	children,
}: SlashCommandPopoverProps) {
	// Use the shared TanStack Query hook — same cache as useCommands in use-commands.ts,
	// so this never triggers a duplicate request.
	const rawServerCommands = useServerCommands(directory)
	const serverCommands = useMemo<SlashCommandItem[]>(
		() =>
			rawServerCommands.map((c) => ({
				name: c.name,
				description: c.description ?? `Run /${c.name}`,
				icon: getCommandIcon(c.name),
				source: "server" as const,
			})),
		[rawServerCommands],
	)
	const [open, setOpen] = useState(false)

	// Detect "/" at start of input
	const isSlashTrigger = enabled && inputText.startsWith("/")
	const query = isSlashTrigger ? inputText.slice(1).split(" ")[0].toLowerCase() : ""

	// All commands merged
	const allCommands = useMemo(() => [...CLIENT_COMMANDS, ...serverCommands], [serverCommands])

	// Filter commands by query
	const filtered = useMemo(() => {
		if (!query) return allCommands
		return allCommands.filter(
			(c) => c.name.includes(query) || c.description.toLowerCase().includes(query),
		)
	}, [allCommands, query])

	// Open/close popover based on slash trigger
	useEffect(() => {
		if (isSlashTrigger && !inputText.includes(" ")) {
			setOpen(true)
		} else {
			setOpen(false)
		}
	}, [isSlashTrigger, inputText])

	const handleSelect = useCallback(
		(commandName: string) => {
			setOpen(false)
			onSelect(`/${commandName}`)
		},
		[onSelect],
	)

	if (!isSlashTrigger) return <>{children}</>

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>{children}</PopoverTrigger>
			<PopoverContent
				className="w-[280px] p-0"
				side="top"
				align="start"
				sideOffset={8}
				onOpenAutoFocus={(e) => e.preventDefault()}
			>
				<Command>
					<CommandList>
						<CommandEmpty>No commands found</CommandEmpty>
						{filtered.length > 0 && (
							<CommandGroup heading="Commands">
								{filtered.map((cmd) => {
									const Icon = cmd.icon
									return (
										<CommandItem
											key={cmd.name}
											value={cmd.name}
											onSelect={() => handleSelect(cmd.name)}
										>
											<Icon className="size-4 shrink-0 text-muted-foreground" />
											<div className="flex flex-col gap-0.5">
												<span className="text-sm font-medium">/{cmd.name}</span>
												<span className="text-xs text-muted-foreground">{cmd.description}</span>
											</div>
										</CommandItem>
									)
								})}
							</CommandGroup>
						)}
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	)
})
