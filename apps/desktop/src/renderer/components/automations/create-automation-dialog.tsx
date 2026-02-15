/**
 * Create/edit automation dialog -- modal overlay for creating or editing an automation.
 *
 * In edit mode, shows metadata header (started date, run count, status),
 * pre-fills fields from the automation, and shows Delete/Test/Pause actions.
 */

import { Badge } from "@palot/ui/components/badge"
import { Button } from "@palot/ui/components/button"
import {
	Combobox,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxInput,
	ComboboxItem,
	ComboboxList,
} from "@palot/ui/components/combobox"
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@palot/ui/components/dialog"
import { Input } from "@palot/ui/components/input"
import { Label } from "@palot/ui/components/label"
import { Textarea } from "@palot/ui/components/textarea"
import { useAtomValue } from "jotai"
import {
	FolderIcon,
	FolderOpenIcon,
	PauseIcon,
	PlayIcon,
	Trash2Icon,
	TriangleIcon,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import type { Automation } from "../../../preload/api"
import { activeServerConfigAtom } from "../../atoms/connection"
import { discoveryProjectsAtom } from "../../atoms/discovery"
import {
	createAutomation,
	deleteAutomation,
	pickDirectory,
	runAutomationNow,
	updateAutomation,
} from "../../services/backend"
import { SchedulePicker } from "./schedule-picker"

interface CreateAutomationDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	/** When set, the dialog is in "edit" mode and pre-fills from this automation. */
	editAutomation?: Automation | null
}

const DEFAULT_RRULE = "FREQ=DAILY;BYHOUR=9;BYMINUTE=0"

// ============================================================
// Helpers
// ============================================================

function formatDate(ts: number): string {
	return new Date(ts).toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
	})
}

function ProjectChip({ path, onRemove }: { path: string; onRemove: () => void }) {
	const name = path.split("/").pop() ?? path
	return (
		<span className="inline-flex items-center gap-1 rounded-md bg-accent px-2 py-0.5 text-xs">
			{name}
			<button
				type="button"
				onClick={onRemove}
				className="ml-0.5 text-muted-foreground hover:text-foreground"
				aria-label={`Remove ${name}`}
			>
				&times;
			</button>
		</span>
	)
}

// ============================================================
// Main component
// ============================================================

export function CreateAutomationDialog({
	open,
	onOpenChange,
	editAutomation,
}: CreateAutomationDialogProps) {
	const isEditing = !!editAutomation

	const [name, setName] = useState("")
	const [prompt, setPrompt] = useState("")
	const [workspaces, setWorkspaces] = useState<string[]>([])
	const [rrule, setRrule] = useState(DEFAULT_RRULE)
	const [isSubmitting, setIsSubmitting] = useState(false)
	const [isTesting, setIsTesting] = useState(false)

	// Pre-fill form when editing
	useEffect(() => {
		if (open && editAutomation) {
			setName(editAutomation.name)
			setPrompt(editAutomation.prompt)
			setWorkspaces([...editAutomation.workspaces])
			setRrule(editAutomation.schedule.rrule)
		} else if (open && !editAutomation) {
			setName("")
			setPrompt("")
			setWorkspaces([])
			setRrule(DEFAULT_RRULE)
		}
	}, [open, editAutomation])

	const canSave = name.trim().length > 0 && prompt.trim().length > 0

	const handleSubmit = useCallback(async () => {
		if (!canSave || isSubmitting) return
		setIsSubmitting(true)
		try {
			if (isEditing && editAutomation) {
				await updateAutomation({
					id: editAutomation.id,
					name: name.trim(),
					prompt: prompt.trim(),
					schedule: {
						rrule,
						timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
					},
					workspaces,
				})
			} else {
				await createAutomation({
					name: name.trim(),
					prompt: prompt.trim(),
					schedule: {
						rrule,
						timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
					},
					workspaces,
					execution: { effort: "medium" },
				})
			}
			onOpenChange(false)
		} catch (err) {
			toast.error(isEditing ? "Failed to save automation" : "Failed to create automation", {
				description: err instanceof Error ? err.message : undefined,
			})
		} finally {
			setIsSubmitting(false)
		}
	}, [
		canSave,
		isSubmitting,
		isEditing,
		editAutomation,
		name,
		prompt,
		rrule,
		workspaces,
		onOpenChange,
	])

	const activeServer = useAtomValue(activeServerConfigAtom)
	const isRemote = activeServer.type !== "local"
	const [remotePathInput, setRemotePathInput] = useState("")
	const [showRemoteInput, setShowRemoteInput] = useState(false)

	// Discovered projects from OpenCode SDK
	const discoveredProjects = useAtomValue(discoveryProjectsAtom)
	const availableProjects = useMemo(
		() =>
			discoveredProjects
				.filter((p) => !workspaces.includes(p.worktree))
				.map((p) => ({
					value: p.worktree,
					label: p.name ?? p.worktree.split("/").pop() ?? p.worktree,
					path: p.worktree,
				})),
		[discoveredProjects, workspaces],
	)

	const handleCancel = useCallback(() => {
		onOpenChange(false)
	}, [onOpenChange])

	const handleAddProject = useCallback(async () => {
		if (isRemote) {
			// Remote server: show inline text input for typing the path
			setShowRemoteInput(true)
			return
		}
		// Local server: use native folder picker
		const dir = await pickDirectory()
		if (dir && !workspaces.includes(dir)) {
			setWorkspaces((prev) => [...prev, dir])
		}
	}, [isRemote, workspaces])

	const handleAddRemotePath = useCallback(() => {
		const trimmed = remotePathInput.trim()
		if (trimmed && !workspaces.includes(trimmed)) {
			setWorkspaces((prev) => [...prev, trimmed])
		}
		setRemotePathInput("")
		setShowRemoteInput(false)
	}, [remotePathInput, workspaces])

	const handleRemoveProject = useCallback((path: string) => {
		setWorkspaces((prev) => prev.filter((w) => w !== path))
	}, [])

	const handleDelete = useCallback(async () => {
		if (!editAutomation) return
		try {
			await deleteAutomation(editAutomation.id)
			onOpenChange(false)
		} catch (err) {
			toast.error("Failed to delete automation", {
				description: err instanceof Error ? err.message : undefined,
			})
		}
	}, [editAutomation, onOpenChange])

	const handleTest = useCallback(async () => {
		if (!editAutomation || isTesting) return
		setIsTesting(true)
		try {
			await runAutomationNow(editAutomation.id)
			toast.success("Automation run started", {
				description: "Check the inbox for results.",
			})
			onOpenChange(false)
		} catch (err) {
			toast.error("Failed to run automation", {
				description: err instanceof Error ? err.message : undefined,
			})
		} finally {
			setIsTesting(false)
		}
	}, [editAutomation, isTesting, onOpenChange])

	const handleTogglePause = useCallback(async () => {
		if (!editAutomation) return
		try {
			await updateAutomation({
				id: editAutomation.id,
				status: editAutomation.status === "paused" ? "active" : "paused",
			})
			onOpenChange(false)
		} catch (err) {
			toast.error("Failed to update automation", {
				description: err instanceof Error ? err.message : undefined,
			})
		}
	}, [editAutomation, onOpenChange])

	const isPaused = editAutomation?.status === "paused"

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
				<DialogHeader>
					<div className="flex items-start justify-between gap-4">
						<DialogTitle>{isEditing ? "Edit automation" : "Create automation"}</DialogTitle>
						{isEditing && editAutomation && (
							<div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
								<span>Started {formatDate(editAutomation.createdAt)}</span>
								<span>{editAutomation.runCount} runs</span>
								<Badge
									variant={isPaused ? "secondary" : "default"}
									className="gap-1 px-1.5 py-0 text-[10px]"
								>
									<span
										className={`inline-block size-1.5 rounded-full ${isPaused ? "bg-yellow-500" : "bg-green-500"}`}
									/>
									{isPaused ? "Paused" : "Active"}
								</Badge>
							</div>
						)}
					</div>
				</DialogHeader>

				<div className="space-y-5">
					{/* Name */}
					<div className="space-y-2">
						<Label htmlFor="automation-name">Name</Label>
						<Input
							id="automation-name"
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="Check for sentry issues"
							autoFocus
						/>
					</div>

					{/* Projects */}
					<div className="space-y-2">
						<Label>Projects</Label>
						<p className="text-xs text-muted-foreground">
							If you want an automation to run on a specific branch, you can specify it in your
							prompt.
						</p>

						{/* Selected projects as chips */}
						{workspaces.length > 0 && (
							<div className="flex flex-wrap items-center gap-1.5">
								{workspaces.map((w) => (
									<ProjectChip key={w} path={w} onRemove={() => handleRemoveProject(w)} />
								))}
							</div>
						)}

						{/* Project combobox -- select from discovered projects */}
						{availableProjects.length > 0 && (
							<Combobox
								value={null}
								onValueChange={(value) => {
									if (value && !workspaces.includes(value)) {
										setWorkspaces((prev) => [...prev, value])
									}
								}}
							>
								<ComboboxInput placeholder="Search projects..." showClear={false} />
								<ComboboxContent>
									<ComboboxList>
										{availableProjects.map((project) => (
											<ComboboxItem key={project.value} value={project.value}>
												<FolderIcon
													aria-hidden="true"
													className="size-3.5 shrink-0 text-muted-foreground"
												/>
												<div className="flex flex-col gap-0.5 overflow-hidden">
													<span className="truncate text-sm">{project.label}</span>
													{project.label !== project.path && (
														<span className="truncate text-xs text-muted-foreground">
															{project.path}
														</span>
													)}
												</div>
											</ComboboxItem>
										))}
										<ComboboxEmpty>No projects found</ComboboxEmpty>
									</ComboboxList>
								</ComboboxContent>
							</Combobox>
						)}

						{/* Fallback: folder picker or manual path entry */}
						{showRemoteInput ? (
							<div className="flex items-center gap-1.5">
								<FolderOpenIcon
									aria-hidden="true"
									className="size-3.5 shrink-0 text-muted-foreground"
								/>
								<Input
									placeholder="/home/user/projects/my-app"
									value={remotePathInput}
									onChange={(e) => setRemotePathInput(e.target.value)}
									onKeyDown={(e) => {
										if (e.key === "Enter" && remotePathInput.trim()) handleAddRemotePath()
										if (e.key === "Escape") {
											setShowRemoteInput(false)
											setRemotePathInput("")
										}
									}}
									className="h-7 min-w-0 flex-1 text-xs"
									autoFocus
								/>
								<Button
									variant="ghost"
									size="sm"
									className="h-7 px-2 text-xs"
									disabled={!remotePathInput.trim()}
									onClick={handleAddRemotePath}
								>
									Add
								</Button>
							</div>
						) : (
							<button
								type="button"
								onClick={handleAddProject}
								className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
							>
								<FolderOpenIcon aria-hidden="true" className="size-3.5" />
								{isRemote ? "Add custom path" : "Browse for folder"}
							</button>
						)}

						{isEditing && (
							<p className="text-xs text-muted-foreground">
								Automations run in the background on dedicated worktrees. Automations in
								non-version-controlled projects run directly in the project directory.
							</p>
						)}
					</div>

					{/* Prompt */}
					<div className="space-y-2">
						<Label htmlFor="automation-prompt">Prompt</Label>
						<Textarea
							id="automation-prompt"
							value={prompt}
							onChange={(e) => setPrompt(e.target.value)}
							placeholder="look for crashes in $Sentry"
							className="min-h-[100px]"
						/>
					</div>

					{/* Schedule */}
					<SchedulePicker value={rrule} onChange={setRrule} />
				</div>

				<DialogFooter className="flex-row justify-between sm:justify-between">
					{/* Left side: destructive / action buttons (only in edit mode) */}
					<div className="flex items-center gap-2">
						{isEditing && (
							<>
								<Button
									variant="ghost"
									size="sm"
									className="gap-1.5 text-destructive hover:text-destructive"
									onClick={handleDelete}
								>
									<Trash2Icon className="size-3.5" />
									Delete
								</Button>
								<Button
									variant="ghost"
									size="sm"
									className="gap-1.5"
									onClick={handleTest}
									disabled={isTesting}
								>
									<TriangleIcon className="size-3 rotate-90 fill-current" />
									{isTesting ? "Running..." : "Test"}
								</Button>
								<Button variant="ghost" size="sm" className="gap-1.5" onClick={handleTogglePause}>
									{isPaused ? (
										<PlayIcon className="size-3.5" />
									) : (
										<PauseIcon className="size-3.5" />
									)}
									{isPaused ? "Resume" : "Pause"}
								</Button>
							</>
						)}
					</div>

					{/* Right side: cancel / save */}
					<div className="flex items-center gap-2">
						<Button variant="ghost" onClick={handleCancel}>
							Cancel
						</Button>
						<Button onClick={handleSubmit} disabled={!canSave || isSubmitting}>
							{isSubmitting
								? isEditing
									? "Saving..."
									: "Creating..."
								: isEditing
									? "Save"
									: "Create"}
						</Button>
					</div>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
