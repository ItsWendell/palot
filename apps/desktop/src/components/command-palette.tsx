import {
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandSeparator,
	CommandShortcut,
} from "@codedeck/ui/components/command"
import { CloudIcon, ContainerIcon, GitBranchIcon, MonitorIcon, PlusIcon } from "lucide-react"
import { useEffect } from "react"
import type { Agent } from "../lib/types"

interface CommandPaletteProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	agents: Agent[]
	onNewSession: () => void
	onSelectAgent: (id: string) => void
}

export function CommandPalette({
	open,
	onOpenChange,
	agents,
	onNewSession,
	onSelectAgent,
}: CommandPaletteProps) {
	useEffect(() => {
		function handleKeyDown(e: KeyboardEvent) {
			if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
				e.preventDefault()
				onOpenChange(!open)
			}
		}
		document.addEventListener("keydown", handleKeyDown)
		return () => document.removeEventListener("keydown", handleKeyDown)
	}, [open, onOpenChange])

	const activeSessions = agents.filter((a) => a.status === "running" || a.status === "waiting")

	return (
		<CommandDialog open={open} onOpenChange={onOpenChange}>
			<CommandInput placeholder="Type a command or search..." />
			<CommandList>
				<CommandEmpty>No results found.</CommandEmpty>

				<CommandGroup heading="Actions">
					<CommandItem
						onSelect={() => {
							onNewSession()
							onOpenChange(false)
						}}
					>
						<PlusIcon />
						<span>New Session</span>
						<CommandShortcut>&#8984;N</CommandShortcut>
					</CommandItem>
				</CommandGroup>

				{activeSessions.length > 0 && (
					<>
						<CommandSeparator />
						<CommandGroup heading="Active Sessions">
							{activeSessions.map((agent) => (
								<CommandItem
									key={agent.id}
									onSelect={() => {
										onSelectAgent(agent.id)
										onOpenChange(false)
									}}
								>
									{agent.environment === "cloud" ? (
										<CloudIcon />
									) : agent.environment === "vm" ? (
										<ContainerIcon />
									) : (
										<MonitorIcon />
									)}
									<span>{agent.name}</span>
									<span className="text-xs text-muted-foreground">{agent.project}</span>
								</CommandItem>
							))}
						</CommandGroup>
					</>
				)}

				{agents.length > 0 && (
					<>
						<CommandSeparator />
						<CommandGroup heading="All Sessions">
							{agents.map((agent) => (
								<CommandItem
									key={agent.id}
									onSelect={() => {
										onSelectAgent(agent.id)
										onOpenChange(false)
									}}
								>
									<GitBranchIcon />
									<span>{agent.name}</span>
									<span className="text-xs text-muted-foreground">
										{agent.project} &middot; {agent.duration}
									</span>
								</CommandItem>
							))}
						</CommandGroup>
					</>
				)}
			</CommandList>
		</CommandDialog>
	)
}
