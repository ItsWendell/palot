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
import { CloudIcon, ContainerIcon, MonitorIcon } from "lucide-react"
import { useState } from "react"
import type { EnvironmentType, Project } from "../lib/types"

interface NewAgentDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	projects: Project[]
}

export function NewAgentDialog({ open, onOpenChange, projects }: NewAgentDialogProps) {
	const [selectedProject, setSelectedProject] = useState<string>(projects[0]?.name || "")
	const [selectedEnv, setSelectedEnv] = useState<EnvironmentType>("cloud")
	const [prompt, setPrompt] = useState("")

	function handleLaunch() {
		// Will be connected to OpenCode SDK later
		onOpenChange(false)
		setPrompt("")
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[520px]">
				<DialogHeader>
					<DialogTitle>New Agent</DialogTitle>
					<DialogDescription>Describe what this agent should work on.</DialogDescription>
				</DialogHeader>

				<div className="space-y-4 py-2">
					{/* Project selector */}
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

					{/* Environment selector */}
					<div className="space-y-2">
						<Label>Environment</Label>
						<div className="flex gap-2">
							<EnvironmentButton
								type="cloud"
								icon={CloudIcon}
								label="Cloud"
								selected={selectedEnv === "cloud"}
								onSelect={() => setSelectedEnv("cloud")}
							/>
							<EnvironmentButton
								type="local"
								icon={MonitorIcon}
								label="Local"
								selected={selectedEnv === "local"}
								onSelect={() => setSelectedEnv("local")}
							/>
							<EnvironmentButton
								type="vm"
								icon={ContainerIcon}
								label="VM"
								selected={selectedEnv === "vm"}
								onSelect={() => setSelectedEnv("vm")}
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
							rows={4}
							className="resize-none"
						/>
					</div>
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button onClick={handleLaunch} disabled={!prompt.trim()}>
						Launch
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
}: {
	type: EnvironmentType
	icon: typeof CloudIcon
	label: string
	selected: boolean
	onSelect: () => void
}) {
	return (
		<button
			type="button"
			onClick={onSelect}
			className={`flex flex-1 cursor-pointer flex-col items-center gap-1.5 rounded-lg border px-3 py-3 text-sm transition-colors ${
				selected
					? "border-primary bg-primary/5 text-primary"
					: "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
			}`}
		>
			<Icon className="size-5" />
			<span className="text-xs font-medium">{label}</span>
		</button>
	)
}
