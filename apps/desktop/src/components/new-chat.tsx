import {
	PromptInput,
	PromptInputSubmit,
	PromptInputTextarea,
} from "@codedeck/ui/components/ai-elements/prompt-input"
import { Suggestion, Suggestions } from "@codedeck/ui/components/ai-elements/suggestion"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@codedeck/ui/components/select"
import { useNavigate, useParams } from "@tanstack/react-router"
import { useCallback, useEffect, useState } from "react"
import { useProjectList } from "../hooks/use-agents"
import { useAgentActions } from "../hooks/use-server"
import { ensureServerForProject } from "../services/connection-manager"

export function NewChat() {
	const { projectSlug } = useParams({ strict: false })
	const projects = useProjectList()
	const { createSession, sendPrompt } = useAgentActions()
	const navigate = useNavigate()

	const [selectedDirectory, setSelectedDirectory] = useState<string>("")
	const [launching, setLaunching] = useState(false)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		if (projects.length === 0) return

		if (projectSlug) {
			const match = projects.find((p) => p.slug === projectSlug)
			if (match) {
				setSelectedDirectory(match.directory)
				return
			}
		}

		setSelectedDirectory(projects[0].directory)
	}, [projectSlug, projects])

	const handleLaunch = useCallback(
		async (promptText: string) => {
			if (!selectedDirectory || !promptText) return
			setLaunching(true)
			setError(null)
			try {
				const serverId = await ensureServerForProject(selectedDirectory)
				const session = await createSession(serverId, promptText.slice(0, 80))
				if (session) {
					await sendPrompt(serverId, session.id, promptText)
					const project = projects.find((p) => p.directory === selectedDirectory)
					navigate({
						to: "/project/$projectSlug/session/$sessionId",
						params: {
							projectSlug: project?.slug ?? "unknown",
							sessionId: session.id,
						},
					})
				}
			} catch (err) {
				setError(err instanceof Error ? err.message : "Failed to create session")
			} finally {
				setLaunching(false)
			}
		},
		[selectedDirectory, createSession, sendPrompt, projects, navigate],
	)

	return (
		<div className="flex h-full items-center justify-center">
			<div className="w-full max-w-lg space-y-6 px-4">
				{/* Icon */}
				<div className="text-center">
					<div className="mx-auto flex size-16 items-center justify-center rounded-full bg-muted">
						<svg
							aria-hidden="true"
							className="size-8 text-muted-foreground"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={1.5}
								d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
							/>
						</svg>
					</div>
					<h2 className="mt-4 text-lg font-semibold">New Session</h2>
					<p className="mt-1 text-sm text-muted-foreground">
						Describe what this session should work on
					</p>
				</div>

				{/* Project selector — only when multiple projects */}
				{projects.length > 1 && (
					<div className="space-y-2">
						<label htmlFor="project-select" className="text-sm font-medium">
							Project
						</label>
						<Select value={selectedDirectory} onValueChange={setSelectedDirectory}>
							<SelectTrigger>
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

				{/* Prompt input */}
				<PromptInput
					onSubmit={(message) => {
						if (message.text.trim()) handleLaunch(message.text.trim())
					}}
				>
					<PromptInputTextarea placeholder="What should this session work on?" autoFocus />
					<PromptInputSubmit disabled={!selectedDirectory || projects.length === 0 || launching} />
				</PromptInput>

				{/* Error */}
				{error && (
					<div className="rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-500">
						{error}
					</div>
				)}

				{/* No projects warning */}
				{projects.length === 0 && (
					<p className="text-center text-xs text-muted-foreground">
						No projects found. Check that projects exist in ~/.local/share/opencode/storage/.
					</p>
				)}

				{/* Suggestions */}
				<Suggestions className="justify-center">
					<Suggestion suggestion="Fix the failing tests" onClick={handleLaunch} />
					<Suggestion suggestion="Refactor this module" onClick={handleLaunch} />
					<Suggestion suggestion="Add error handling" onClick={handleLaunch} />
					<Suggestion suggestion="Write documentation" onClick={handleLaunch} />
				</Suggestions>

				{/* Keyboard hints */}
				<div className="text-center text-xs text-muted-foreground/40">
					<kbd className="rounded border border-border bg-muted px-1 py-0.5 text-[10px]">
						&#8984;Enter
					</kbd>{" "}
					to launch{" · "}
					<kbd className="rounded border border-border bg-muted px-1 py-0.5 text-[10px]">
						&#8984;K
					</kbd>{" "}
					search
				</div>
			</div>
		</div>
	)
}
