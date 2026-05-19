/**
 * Modal for adding a project — local servers only.
 *
 * Presents two options:
 *   1. Open Existing Folder — native directory picker
 *   2. Create New Project   — type a name, pick a parent location, folder is created
 */

import { Button } from "@palot/ui/components/button"
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@palot/ui/components/dialog"
import { Input } from "@palot/ui/components/input"
import { Label } from "@palot/ui/components/label"
import { useNavigate } from "@tanstack/react-router"
import { useSetAtom } from "jotai"
import { ArrowLeftIcon, FolderOpenIcon, FolderPlusIcon, Loader2Icon } from "lucide-react"
import { useCallback, useState } from "react"
import { hiddenProjectsAtom } from "../atoms/projects"
import { useProjectList } from "../hooks/use-agents"
import { useAgentActions } from "../hooks/use-server"
import { createProjectDirectory, pickDirectory } from "../services/backend"
import { loadProjectSessions } from "../services/connection-manager"

interface AddProjectModalProps {
	open: boolean
	onOpenChange: (open: boolean) => void
}

type Screen = "choose" | "create-new"

export function AddProjectModal({ open, onOpenChange }: AddProjectModalProps) {
	const navigate = useNavigate()
	const setHiddenDirs = useSetAtom(hiddenProjectsAtom)
	const projects = useProjectList()
	const { createSession } = useAgentActions()

	const [screen, setScreen] = useState<Screen>("choose")
	const [projectName, setProjectName] = useState("")
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const reset = useCallback(() => {
		setScreen("choose")
		setProjectName("")
		setError(null)
		setLoading(false)
	}, [])

	const handleOpenChange = useCallback(
		(next: boolean) => {
			if (!next) reset()
			onOpenChange(next)
		},
		[reset, onOpenChange],
	)

	const finishAdd = useCallback(
		async (directory: string) => {
			setHiddenDirs((prev) => prev.filter((d) => d !== directory))
			await loadProjectSessions(directory)
			const session = await createSession(directory)
			onOpenChange(false)
			if (session) {
				const project = projects.find((p) => p.directory === directory)
				navigate({
					to: "/project/$projectSlug/session/$sessionId",
					params: { projectSlug: project?.slug ?? "unknown", sessionId: session.id },
				})
			} else {
				navigate({ to: "/" })
			}
		},
		[navigate, onOpenChange, setHiddenDirs, createSession, projects],
	)

	const handleOpenExisting = useCallback(async () => {
		setLoading(true)
		setError(null)
		try {
			const dir = await pickDirectory()
			if (!dir) return
			await finishAdd(dir)
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to open project.")
		} finally {
			setLoading(false)
		}
	}, [finishAdd])

	const handleCreateNew = useCallback(async () => {
		const name = projectName.trim()
		if (!name) return
		setLoading(true)
		setError(null)
		try {
			const dir = await createProjectDirectory(name)
			if (!dir) return // user cancelled the location picker
			await finishAdd(dir)
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to create project.")
		} finally {
			setLoading(false)
		}
	}, [projectName, finishAdd])

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent className="sm:max-w-md">
				{screen === "choose" ? (
					<>
						<DialogHeader>
							<DialogTitle>Add Project</DialogTitle>
							<DialogDescription>
								Open an existing folder or create a brand-new project.
							</DialogDescription>
						</DialogHeader>

						<div className="grid grid-cols-2 gap-3 py-2">
							<button
								type="button"
								onClick={handleOpenExisting}
								disabled={loading}
								className="flex flex-col items-center gap-3 rounded-lg border border-border bg-muted/30 p-5 text-center transition-colors hover:bg-muted/60 disabled:pointer-events-none disabled:opacity-50"
							>
								{loading ? (
									<Loader2Icon className="size-7 text-muted-foreground animate-spin" />
								) : (
									<FolderOpenIcon className="size-7 text-muted-foreground" />
								)}
								<div>
									<p className="text-sm font-medium">Open Existing Folder</p>
									<p className="mt-0.5 text-xs text-muted-foreground">
										Browse to a project you've already created
									</p>
								</div>
							</button>

							<button
								type="button"
								onClick={() => setScreen("create-new")}
								disabled={loading}
								className="flex flex-col items-center gap-3 rounded-lg border border-border bg-muted/30 p-5 text-center transition-colors hover:bg-muted/60 disabled:pointer-events-none disabled:opacity-50"
							>
								<FolderPlusIcon className="size-7 text-muted-foreground" />
								<div>
									<p className="text-sm font-medium">Create New Project</p>
									<p className="mt-0.5 text-xs text-muted-foreground">
										Name a folder and choose where to save it
									</p>
								</div>
							</button>
						</div>

						{error && (
							<p className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
								{error}
							</p>
						)}
					</>
				) : (
					<>
						<DialogHeader>
							<DialogTitle>Create New Project</DialogTitle>
							<DialogDescription>
								Name your project — you'll choose where to save it next.
							</DialogDescription>
						</DialogHeader>

						<div className="space-y-4 py-2">
							<div className="space-y-2">
								<Label htmlFor="new-project-name">Project name</Label>
								<Input
									id="new-project-name"
									placeholder="my-project"
									value={projectName}
									autoFocus
									onChange={(e) => {
										setProjectName(e.target.value)
										setError(null)
									}}
									onKeyDown={(e) => {
										if (e.key === "Enter" && projectName.trim()) handleCreateNew()
									}}
								/>
							</div>

							{error && (
								<p className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
									{error}
								</p>
							)}
						</div>

						<DialogFooter className="flex-row items-center sm:justify-between">
							<Button
								variant="ghost"
								size="sm"
								onClick={() => {
									setScreen("choose")
									setError(null)
								}}
								disabled={loading}
							>
								<ArrowLeftIcon className="size-3.5" />
								Back
							</Button>
							<Button
								onClick={handleCreateNew}
								disabled={!projectName.trim() || loading}
							>
								{loading && <Loader2Icon className="size-3.5 animate-spin" />}
								Create Project
							</Button>
						</DialogFooter>
					</>
				)}
			</DialogContent>
		</Dialog>
	)
}
