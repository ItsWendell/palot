import { Badge } from "@codedeck/ui/components/badge"
import { Button } from "@codedeck/ui/components/button"
import { ScrollArea } from "@codedeck/ui/components/scroll-area"
import { Separator } from "@codedeck/ui/components/separator"
import { CloudIcon, ContainerIcon, MonitorIcon, PlusIcon } from "lucide-react"
import type { Agent, AgentStatus, EnvironmentType, Project } from "../lib/types"

const STATUS_CONFIG: Record<AgentStatus, { label: string; color: string; dotClass: string }> = {
	running: {
		label: "Running",
		color: "bg-green-500",
		dotClass: "bg-green-500 animate-pulse",
	},
	waiting: {
		label: "Waiting",
		color: "bg-yellow-500",
		dotClass: "bg-yellow-500",
	},
	paused: { label: "Paused", color: "bg-gray-500", dotClass: "bg-gray-500" },
	completed: {
		label: "Completed",
		color: "bg-blue-500",
		dotClass: "bg-blue-500",
	},
	failed: { label: "Failed", color: "bg-red-500", dotClass: "bg-red-500" },
	idle: {
		label: "Idle",
		color: "bg-gray-400",
		dotClass: "bg-gray-400",
	},
}

const ENV_CONFIG: Record<EnvironmentType, { label: string; icon: typeof CloudIcon }> = {
	cloud: { label: "Cloud", icon: CloudIcon },
	local: { label: "Local", icon: MonitorIcon },
	vm: { label: "VM", icon: ContainerIcon },
}

interface AppSidebarProps {
	projects: Project[]
	agents: Agent[]
	selectedProject: string | null
	selectedStatus: AgentStatus | null
	selectedEnvironment: EnvironmentType | null
	onSelectProject: (project: string | null) => void
	onSelectStatus: (status: AgentStatus | null) => void
	onSelectEnvironment: (env: EnvironmentType | null) => void
	onNewAgent: () => void
}

export function AppSidebar({
	projects,
	agents,
	selectedProject,
	selectedStatus,
	selectedEnvironment,
	onSelectProject,
	onSelectStatus,
	onSelectEnvironment,
	onNewAgent,
}: AppSidebarProps) {
	const statusCounts = agents.reduce(
		(acc, agent) => {
			acc[agent.status] = (acc[agent.status] || 0) + 1
			return acc
		},
		{} as Record<AgentStatus, number>,
	)

	const envCounts = agents.reduce(
		(acc, agent) => {
			acc[agent.environment] = (acc[agent.environment] || 0) + 1
			return acc
		},
		{} as Record<EnvironmentType, number>,
	)

	const totalCost = agents.reduce((sum, a) => sum + a.cost, 0)
	const totalTokens = agents.reduce((sum, a) => sum + a.tokens, 0)

	return (
		<aside className="flex h-full flex-col bg-sidebar">
			<div className="border-b border-sidebar-border p-4">
				<h1 className="text-sm font-semibold tracking-tight">Codedeck</h1>
			</div>

			<div className="p-3">
				<Button className="w-full" size="sm" onClick={onNewAgent}>
					<PlusIcon className="mr-1.5 size-3.5" />
					New Agent
				</Button>
			</div>

			<ScrollArea className="flex-1">
				<nav className="space-y-4 p-3">
					{/* Projects */}
					<div>
						<h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
							Projects
						</h2>
						<ul className="space-y-0.5">
							<li>
								<button
									type="button"
									onClick={() => onSelectProject(null)}
									className={`flex w-full cursor-pointer items-center justify-between rounded-md px-3 py-1.5 text-sm transition-colors ${
										selectedProject === null
											? "bg-sidebar-accent text-sidebar-accent-foreground"
											: "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
									}`}
								>
									All projects
									<Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
										{agents.length}
									</Badge>
								</button>
							</li>
							{projects.map((project) => (
								<li key={project.name}>
									<button
										type="button"
										onClick={() => onSelectProject(project.name)}
										className={`flex w-full cursor-pointer items-center justify-between rounded-md px-3 py-1.5 text-sm transition-colors ${
											selectedProject === project.name
												? "bg-sidebar-accent text-sidebar-accent-foreground"
												: "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
										}`}
									>
										{project.name}
										<Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
											{project.agentCount}
										</Badge>
									</button>
								</li>
							))}
						</ul>
					</div>

					<Separator />

					{/* Status */}
					<div>
						<h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
							Status
						</h2>
						<ul className="space-y-0.5">
							{(
								Object.entries(STATUS_CONFIG) as [
									AgentStatus,
									(typeof STATUS_CONFIG)[AgentStatus],
								][]
							).map(([status, config]) => {
								const count = statusCounts[status] || 0
								if (count === 0) return null
								return (
									<li key={status}>
										<button
											type="button"
											onClick={() => onSelectStatus(selectedStatus === status ? null : status)}
											className={`flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-1 text-sm transition-colors ${
												selectedStatus === status
													? "bg-sidebar-accent text-sidebar-accent-foreground"
													: "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
											}`}
										>
											<span className={`inline-block size-2 rounded-full ${config.dotClass}`} />
											{config.label}
											<span className="ml-auto text-xs">{count}</span>
										</button>
									</li>
								)
							})}
						</ul>
					</div>

					<Separator />

					{/* Environments */}
					<div>
						<h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
							Environments
						</h2>
						<ul className="space-y-0.5">
							{(
								Object.entries(ENV_CONFIG) as [
									EnvironmentType,
									(typeof ENV_CONFIG)[EnvironmentType],
								][]
							).map(([env, config]) => {
								const count = envCounts[env] || 0
								if (count === 0) return null
								const Icon = config.icon
								return (
									<li key={env}>
										<button
											type="button"
											onClick={() => onSelectEnvironment(selectedEnvironment === env ? null : env)}
											className={`flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-1 text-sm transition-colors ${
												selectedEnvironment === env
													? "bg-sidebar-accent text-sidebar-accent-foreground"
													: "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
											}`}
										>
											<Icon className="size-3.5" />
											{config.label}
											<span className="ml-auto text-xs">{count}</span>
										</button>
									</li>
								)
							})}
						</ul>
					</div>
				</nav>
			</ScrollArea>

			<div className="border-t border-sidebar-border p-3">
				<p className="text-xs text-muted-foreground">
					Today: ${totalCost.toFixed(2)} &middot;{" "}
					{totalTokens >= 1000 ? `${(totalTokens / 1000).toFixed(1)}k` : totalTokens} tokens
				</p>
			</div>
		</aside>
	)
}
