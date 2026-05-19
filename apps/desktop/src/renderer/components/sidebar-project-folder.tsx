import { Collapsible, CollapsibleContent } from "@palot/ui/components/collapsible"
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "@palot/ui/components/context-menu"
import { Input } from "@palot/ui/components/input"
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@palot/ui/components/sidebar"
import { useNavigate } from "@tanstack/react-router"
import { useAtom, useAtomValue } from "jotai"
import {
	ChevronDownIcon,
	ChevronRightIcon,
	CopyIcon,
	EyeOffIcon,
	FolderIcon,
	FolderOpenIcon,
	Loader2Icon,
	PencilIcon,
	PinIcon,
	PinOffIcon,
} from "lucide-react"
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { agentFamily, projectSessionIdsFamily, sandboxMappingsAtom } from "../atoms/derived/agents"
import { hiddenProjectsAtom, pinnedProjectsAtom, projectDisplayNamesAtom } from "../atoms/projects"
import { projectPaginationFamily } from "../atoms/sessions"
import { appStore } from "../atoms/store"
import type { Agent, SidebarProject } from "../lib/types"
import { showInFinder } from "../services/backend"
import { loadMoreProjectSessions, loadProjectSessions } from "../services/connection-manager"
import { SessionItem } from "./sidebar-session-item"

const ProjectSessionItem = memo(function ProjectSessionItem({
	sessionId,
	selectedSessionId,
	onRename,
	onDelete,
	onFork,
}: {
	sessionId: string
	selectedSessionId: string | null
	onRename?: (agent: Agent, title: string) => Promise<void>
	onDelete?: (agent: Agent) => Promise<void>
	onFork?: (agent: Agent) => Promise<void>
}) {
	const agent = useAtomValue(agentFamily(sessionId))
	if (!agent) return null
	return (
		<SessionItem
			agent={agent}
			isSelected={agent.id === selectedSessionId}
			onRename={onRename}
			onDelete={onDelete}
			onFork={onFork}
			compact
		/>
	)
})

export const ProjectFolder = memo(function ProjectFolder({
	project,
	selectedSessionId,
	selectedProjectSlug,
	onRename,
	onDelete,
	onFork,
}: {
	project: SidebarProject
	selectedSessionId: string | null
	selectedProjectSlug?: string | null
	onRename?: (agent: Agent, title: string) => Promise<void>
	onDelete?: (agent: Agent) => Promise<void>
	onFork?: (agent: Agent) => Promise<void>
}) {
	const navigate = useNavigate()
	const [expanded, setExpanded] = useState(false)

	const [pinnedDirs, setPinnedDirs] = useAtom(pinnedProjectsAtom)
	const [, setHiddenDirs] = useAtom(hiddenProjectsAtom)
	const [displayNames, setDisplayNames] = useAtom(projectDisplayNamesAtom)

	const isPinned = pinnedDirs.includes(project.directory)
	const displayName = displayNames[project.directory] ?? project.name

	const parentDirHint = useMemo(() => {
		const parts = project.directory.split("/").filter(Boolean)
		return parts.length >= 2 ? parts[parts.length - 2] : ""
	}, [project.directory])

	const [isRenaming, setIsRenaming] = useState(false)
	const [renameValue, setRenameValue] = useState("")
	const renameInputRef = useRef<HTMLInputElement>(null)

	useEffect(() => {
		if (isRenaming && renameInputRef.current) {
			renameInputRef.current.focus()
			renameInputRef.current.select()
		}
	}, [isRenaming])

	const startRenaming = useCallback(() => {
		setRenameValue(displayName)
		setIsRenaming(true)
	}, [displayName])

	const confirmRename = useCallback(() => {
		const trimmed = renameValue.trim()
		setIsRenaming(false)
		if (!trimmed || trimmed === project.name) {
			setDisplayNames((prev) => {
				const next = { ...prev }
				delete next[project.directory]
				return next
			})
		} else {
			setDisplayNames((prev) => ({ ...prev, [project.directory]: trimmed }))
		}
	}, [renameValue, project.name, project.directory, setDisplayNames])

	const togglePin = useCallback(() => {
		if (isPinned) {
			setPinnedDirs((prev) => prev.filter((d) => d !== project.directory))
		} else {
			setPinnedDirs((prev) => [...prev, project.directory])
		}
	}, [isPinned, project.directory, setPinnedDirs])

	const removeFromList = useCallback(() => {
		setHiddenDirs((prev) => [...prev, project.directory])
	}, [project.directory, setHiddenDirs])

	const handleOpenInFinder = useCallback(() => {
		showInFinder(project.directory)
	}, [project.directory])

	const handleCopyPath = useCallback(() => {
		navigator.clipboard.writeText(project.directory)
	}, [project.directory])

	const sessionIds = useAtomValue(projectSessionIdsFamily(project.directory))
	const pagination = useAtomValue(projectPaginationFamily(project.directory))

	useEffect(() => {
		if (!expanded || pagination.loaded || pagination.loading) return

		const { parentToSandboxes } = appStore.get(sandboxMappingsAtom)
		const sandboxDirs = parentToSandboxes.get(project.directory)

		loadProjectSessions(project.directory, sandboxDirs?.size ? sandboxDirs : undefined, {
			limit: 5,
			roots: true,
		})
	}, [expanded, pagination.loaded, pagination.loading, project.directory])

	const projectSessions = useMemo(() => {
		const agents: Agent[] = []
		for (const id of sessionIds) {
			const agent = appStore.get(agentFamily(id))
			if (agent) agents.push(agent)
		}
		return agents.sort((a, b) => {
			const aActive = a.status === "running" || a.status === "waiting" || a.status === "failed"
			const bActive = b.status === "running" || b.status === "waiting" || b.status === "failed"
			if (aActive !== bActive) return aActive ? -1 : 1
			return b.lastActiveAt - a.lastActiveAt
		})
	}, [sessionIds])

	const handleLoadMore = useCallback(() => {
		loadMoreProjectSessions(project.directory, pagination.currentLimit)
	}, [project.directory, pagination.currentLimit])

	const isInitialLoading = expanded && !pagination.loaded && !pagination.loading
	const isLoading = pagination.loading || isInitialLoading
	const isSelected = project.slug === selectedProjectSlug

	const projectButton = (
		<SidebarMenuButton
			isActive={isSelected}
			tooltip={project.directory}
			onClick={() => {
				if (isRenaming) return
				setExpanded(!expanded)
				navigate({
					to: "/project/$projectSlug",
					params: { projectSlug: project.slug },
				})
			}}
		>
			<ChevronRightIcon
				className="size-3 shrink-0 text-muted-foreground transition-transform duration-150 ease-out"
				style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}
			/>
			<FolderIcon className="size-3.5 shrink-0 text-muted-foreground/70" />
			<div className="min-w-0 flex-1">
				{isRenaming ? (
					<Input
						ref={renameInputRef}
						value={renameValue}
						onChange={(e) => setRenameValue(e.target.value)}
						onKeyDown={(e) => {
							e.stopPropagation()
							if (e.key === "Enter") confirmRename()
							if (e.key === "Escape") setIsRenaming(false)
						}}
						onBlur={confirmRename}
						onClick={(e) => e.stopPropagation()}
						className="h-auto min-w-0 flex-1 border-none bg-transparent p-0 text-[13px] shadow-none focus-visible:ring-0"
					/>
				) : (
					<>
						<span className="block truncate text-[13px] font-medium leading-tight">
							{displayName}
						</span>
						{parentDirHint && (
							<span className="block truncate text-[10px] leading-tight text-muted-foreground/50">
								{parentDirHint}
							</span>
						)}
					</>
				)}
			</div>
			{isPinned && <PinIcon className="size-3 shrink-0 text-muted-foreground/40" />}
		</SidebarMenuButton>
	)

	return (
		<SidebarMenuItem>
			<Collapsible open={expanded} onOpenChange={setExpanded}>
				<ContextMenu>
					<ContextMenuTrigger render={projectButton} />
					<ContextMenuContent>
						<ContextMenuItem onSelect={startRenaming}>
							<PencilIcon className="size-4" />
							Rename
						</ContextMenuItem>
						<ContextMenuItem onSelect={togglePin}>
							{isPinned ? (
								<PinOffIcon className="size-4" />
							) : (
								<PinIcon className="size-4" />
							)}
							{isPinned ? "Unpin" : "Pin to top"}
						</ContextMenuItem>
						<ContextMenuSeparator />
						<ContextMenuItem onSelect={handleOpenInFinder}>
							<FolderOpenIcon className="size-4" />
							Open in Finder
						</ContextMenuItem>
						<ContextMenuItem onSelect={handleCopyPath}>
							<CopyIcon className="size-4" />
							Copy path
						</ContextMenuItem>
						<ContextMenuSeparator />
						<ContextMenuItem variant="destructive" onSelect={removeFromList}>
							<EyeOffIcon className="size-4" />
							Remove from list
						</ContextMenuItem>
					</ContextMenuContent>
				</ContextMenu>

				<CollapsibleContent
					keepMounted
					className="flex h-[var(--collapsible-panel-height)] flex-col overflow-hidden transition-[height] duration-200 ease-out data-[ending-style]:h-0 data-[starting-style]:h-0 [&[hidden]:not([hidden='until-found'])]:hidden"
				>
					<div className="ml-3 border-l border-sidebar-border/5 pl-1">
						{isLoading && projectSessions.length === 0 ? (
							<p className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-muted-foreground/60">
								<Loader2Icon className="size-3 animate-spin" />
								Loading sessions...
							</p>
						) : pagination.loaded && projectSessions.length === 0 ? (
							<p className="px-2 py-1.5 text-xs text-muted-foreground/60">No sessions yet</p>
						) : (
							<SidebarMenu>
								{projectSessions.map((agent) => (
									<ProjectSessionItem
										key={agent.id}
										sessionId={agent.id}
										selectedSessionId={selectedSessionId}
										onRename={onRename}
										onDelete={onDelete}
										onFork={onFork}
									/>
								))}
								{pagination.loaded && pagination.hasMore && (
									<button
										type="button"
										onClick={handleLoadMore}
										disabled={pagination.loading}
										className="w-full cursor-pointer px-2 py-1 text-left text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:cursor-default disabled:opacity-50"
									>
										{pagination.loading ? (
											<span className="flex items-center gap-1">
												<Loader2Icon className="size-3 animate-spin" />
												Loading...
											</span>
										) : (
											<span className="flex items-center gap-1">
												<ChevronDownIcon className="size-3" />
												Load more sessions
											</span>
										)}
									</button>
								)}
							</SidebarMenu>
						)}
					</div>
				</CollapsibleContent>
			</Collapsible>
		</SidebarMenuItem>
	)
})
