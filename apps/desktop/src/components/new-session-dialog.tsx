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
import { Loader2Icon } from "lucide-react"
import { useEffect, useState } from "react"
import type { SidebarProject } from "../lib/types"

interface NewSessionDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	/** Available projects with their directories */
	projects: SidebarProject[]
	/** Pre-selected project name (when opened via a project's + button) */
	preSelectedProject?: string | null
	/** Called with (directory, prompt) — auto-starts server if needed */
	onLaunch?: (directory: string, prompt: string) => Promise<void>
}

export function NewSessionDialog({
	open,
	onOpenChange,
	projects,
	preSelectedProject,
	onLaunch,
}: NewSessionDialogProps) {
	const [selectedProject, setSelectedProject] = useState<string>("")
	const [prompt, setPrompt] = useState("")
	const [launching, setLaunching] = useState(false)
	const [error, setError] = useState<string | null>(null)

	// Set project from preSelectedProject or first available
	useEffect(() => {
		if (!open) return
		if (preSelectedProject) {
			const match = projects.find((p) => p.name === preSelectedProject)
			if (match) {
				setSelectedProject(match.directory)
				return
			}
		}
		if (projects.length > 0 && !selectedProject) {
			setSelectedProject(projects[0].directory)
		}
	}, [open, preSelectedProject, projects, selectedProject])

	// Reset state when dialog opens
	useEffect(() => {
		if (open) {
			setPrompt("")
			setError(null)
			setLaunching(false)
		}
	}, [open])

	async function handleLaunch() {
		if (!onLaunch || !selectedProject || !prompt.trim()) return

		setLaunching(true)
		setError(null)
		try {
			await onLaunch(selectedProject, prompt.trim())
			onOpenChange(false)
			setPrompt("")
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to create session")
		} finally {
			setLaunching(false)
		}
	}

	const canLaunch = prompt.trim() && selectedProject && projects.length > 0

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[520px]">
				<DialogHeader>
					<DialogTitle>New Session</DialogTitle>
					<DialogDescription>
						{preSelectedProject
							? `Start a new session for ${preSelectedProject}. The server will start automatically if needed.`
							: "Describe what this session should work on."}
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4 py-2">
					{/* Project selector — only shown when no pre-selected project and multiple available */}
					{!preSelectedProject && projects.length > 1 && (
						<div className="space-y-2">
							<Label htmlFor="project">Project</Label>
							<Select value={selectedProject} onValueChange={setSelectedProject}>
								<SelectTrigger id="project">
									<SelectValue placeholder="Select a project" />
								</SelectTrigger>
								<SelectContent>
									{projects.map((p) => (
										<SelectItem key={p.directory} value={p.directory}>
											{p.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					)}

					{/* Prompt */}
					<div className="space-y-2">
						<Label htmlFor="prompt">Task</Label>
						<Textarea
							id="prompt"
							placeholder="What should this session work on?"
							value={prompt}
							onChange={(e) => setPrompt(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canLaunch) {
									handleLaunch()
								}
							}}
							rows={4}
							className="resize-none"
							autoFocus
						/>
					</div>

					{error && (
						<div className="rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-500">
							{error}
						</div>
					)}

					{projects.length === 0 && (
						<p className="text-xs text-muted-foreground">
							No projects found. Start an OpenCode server or check that projects exist in
							~/.local/share/opencode/storage/.
						</p>
					)}
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button onClick={handleLaunch} disabled={!canLaunch || launching}>
						{launching ? (
							<>
								<Loader2Icon className="mr-1.5 size-3.5 animate-spin" />
								Starting...
							</>
						) : (
							"Create Session"
						)}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
