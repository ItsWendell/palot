import { Button } from "@codedeck/ui/components/button"
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@codedeck/ui/components/dialog"
import { Label } from "@codedeck/ui/components/label"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@codedeck/ui/components/select"
import { Textarea } from "@codedeck/ui/components/textarea"
import { CloudIcon, ContainerIcon, Loader2Icon, MonitorIcon } from "lucide-react"
import { useState } from "react"
import type { EnvironmentType, Project } from "../lib/types"

interface ServerOption {
	id: string
	name: string
	directory: string
}

interface NewAgentDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	projects: Project[]
	connectedServers?: ServerOption[]
	onLaunch?: (serverId: string, prompt: string) => Promise<void>
}

export function NewAgentDialog({
	open,
	onOpenChange,
	projects,
	connectedServers = [],
	onLaunch,
}: NewAgentDialogProps) {
	const [selectedProject, setSelectedProject] = useState<string>(projects[0]?.name || "")
	const [selectedServer, setSelectedServer] = useState<string>(connectedServers[0]?.id || "")
	const [selectedEnv, setSelectedEnv] = useState<EnvironmentType>("local")
	const [prompt, setPrompt] = useState("")
	const [launching, setLaunching] = useState(false)
	const [error, setError] = useState<string | null>(null)

	// Update selected server when connectedServers changes
	if (connectedServers.length > 0 && !connectedServers.find((s) => s.id === selectedServer)) {
		setSelectedServer(connectedServers[0].id)
	}

	async function handleLaunch() {
		if (!onLaunch || !selectedServer || !prompt.trim()) return

		setLaunching(true)
		setError(null)
		try {
			await onLaunch(selectedServer, prompt.trim())
			onOpenChange(false)
			setPrompt("")
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to launch agent")
		} finally {
			setLaunching(false)
		}
	}

	const canLaunch = prompt.trim() && (connectedServers.length > 0 ? selectedServer : true)

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[520px]">
				<DialogHeader>
					<DialogTitle>New Agent</DialogTitle>
					<DialogDescription>Describe what this agent should work on.</DialogDescription>
				</DialogHeader>

				<div className="space-y-4 py-2">
					{/* Server selector — only shown when connected to real servers */}
					{connectedServers.length > 0 && (
						<div className="space-y-2">
							<Label htmlFor="server">Server</Label>
							<Select value={selectedServer} onValueChange={setSelectedServer}>
								<SelectTrigger id="server">
									<SelectValue placeholder="Select a server" />
								</SelectTrigger>
								<SelectContent>
									{connectedServers.map((s) => (
										<SelectItem key={s.id} value={s.id}>
											{s.name} <span className="text-muted-foreground">({s.directory})</span>
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					)}

					{/* Project selector — shown when using mock data */}
					{connectedServers.length === 0 && (
						<div className="space-y-2">
							<Label htmlFor="project">Project</Label>
							<Select value={selectedProject} onValueChange={setSelectedProject}>
								<SelectTrigger id="project">
									<SelectValue placeholder="Select a project" />
								</SelectTrigger>
								<SelectContent>
									{projects.map((p) => (
										<SelectItem key={p.name} value={p.name}>
											{p.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					)}

					{/* Environment selector */}
					<div className="space-y-2">
						<Label>Environment</Label>
						<div className="flex gap-2">
							<EnvironmentButton
								type="local"
								icon={MonitorIcon}
								label="Local"
								selected={selectedEnv === "local"}
								onSelect={() => setSelectedEnv("local")}
							/>
							<EnvironmentButton
								type="cloud"
								icon={CloudIcon}
								label="Cloud"
								selected={selectedEnv === "cloud"}
								onSelect={() => setSelectedEnv("cloud")}
								disabled
							/>
							<EnvironmentButton
								type="vm"
								icon={ContainerIcon}
								label="VM"
								selected={selectedEnv === "vm"}
								onSelect={() => setSelectedEnv("vm")}
								disabled
							/>
						</div>
					</div>

					{/* Prompt */}
					<div className="space-y-2">
						<Label htmlFor="prompt">Task</Label>
						<Textarea
							id="prompt"
							placeholder="What should this agent work on?"
							value={prompt}
							onChange={(e) => setPrompt(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canLaunch) {
									handleLaunch()
								}
							}}
							rows={4}
							className="resize-none"
						/>
					</div>

					{error && (
						<div className="rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-500">
							{error}
						</div>
					)}

					{connectedServers.length === 0 && (
						<p className="text-xs text-muted-foreground">
							No servers connected. Connect to an OpenCode server to launch real agents.
						</p>
					)}
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button
						onClick={handleLaunch}
						disabled={!canLaunch || launching || connectedServers.length === 0}
					>
						{launching ? (
							<>
								<Loader2Icon className="mr-1.5 size-3.5 animate-spin" />
								Launching...
							</>
						) : (
							"Launch"
						)}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}

function EnvironmentButton({
	icon: Icon,
	label,
	selected,
	onSelect,
	disabled,
}: {
	type: EnvironmentType
	icon: typeof CloudIcon
	label: string
	selected: boolean
	onSelect: () => void
	disabled?: boolean
}) {
	return (
		<button
			type="button"
			onClick={onSelect}
			disabled={disabled}
			className={`flex flex-1 cursor-pointer flex-col items-center gap-1.5 rounded-lg border px-3 py-3 text-sm transition-colors ${
				disabled
					? "cursor-not-allowed border-border/50 text-muted-foreground/50"
					: selected
						? "border-primary bg-primary/5 text-primary"
						: "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
			}`}
		>
			<Icon className="size-5" />
			<span className="text-xs font-medium">
				{label}
				{disabled && " (soon)"}
			</span>
		</button>
	)
}
