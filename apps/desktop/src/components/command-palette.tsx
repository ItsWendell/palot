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
	onNewAgent: () => void
	onSelectAgent: (id: string) => void
}

export function CommandPalette({
	open,
	onOpenChange,
	agents,
	onNewAgent,
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

	const runningAgents = agents.filter((a) => a.status === "running")

	return (
		<CommandDialog open={open} onOpenChange={onOpenChange}>
			<CommandInput placeholder="Type a command or search..." />
			<CommandList>
				<CommandEmpty>No results found.</CommandEmpty>

				<CommandGroup heading="Actions">
					<CommandItem
						onSelect={() => {
							onNewAgent()
							onOpenChange(false)
						}}
					>
						<PlusIcon />
						<span>New Agent</span>
						<CommandShortcut>&#8984;N</CommandShortcut>
					</CommandItem>
				</CommandGroup>

				{runningAgents.length > 0 && (
					<>
						<CommandSeparator />
						<CommandGroup heading="Running Agents">
							{runningAgents.map((agent) => (
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
									<span className="text-muted-foreground text-xs">{agent.project}</span>
								</CommandItem>
							))}
						</CommandGroup>
					</>
				)}

				{agents.length > 0 && (
					<>
						<CommandSeparator />
						<CommandGroup heading="All Agents">
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
									<span className="text-muted-foreground text-xs">
										{agent.project} &middot; {agent.branch}
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
