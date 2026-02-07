import { TooltipProvider } from "@codedeck/ui/components/tooltip"
import { Outlet, useNavigate, useParams } from "@tanstack/react-router"
import { useCallback, useEffect, useMemo } from "react"
import {
	useAgents,
	useCommandPaletteOpen,
	useProjectList,
	useSetCommandPaletteOpen,
	useShowSubAgents,
	useToggleShowSubAgents,
} from "../hooks/use-agents"
import { useDiscovery } from "../hooks/use-discovery"
import { useServerConnection } from "../hooks/use-server"
import { CommandPalette } from "./command-palette"
import { Sidebar } from "./sidebar"

export function RootLayout() {
	useDiscovery()
	useServerConnection()

	const agents = useAgents()
	const projects = useProjectList()
	const showSubAgents = useShowSubAgents()
	const toggleShowSubAgents = useToggleShowSubAgents()
	const commandPaletteOpen = useCommandPaletteOpen()
	const setCommandPaletteOpen = useSetCommandPaletteOpen()
	const navigate = useNavigate()
	const params = useParams({ strict: false })
	const sessionId = (params as Record<string, string | undefined>).sessionId

	const visibleAgents = useMemo(() => {
		if (showSubAgents) return agents
		return agents.filter((agent) => !agent.parentId)
	}, [agents, showSubAgents])

	const subAgentCount = useMemo(() => agents.filter((a) => a.parentId).length, [agents])

	// ========== Keyboard navigation ==========

	const handleKeyDown = useCallback(
		(e: KeyboardEvent) => {
			const target = e.target as HTMLElement
			if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
				return
			}

			if (e.key === "Escape") {
				e.preventDefault()
				navigate({ to: "/" })
				return
			}

			if (e.key === "j" || e.key === "k") {
				e.preventDefault()
				const currentIndex = visibleAgents.findIndex((a) => a.id === sessionId)
				let nextIndex: number
				if (e.key === "j") {
					nextIndex = currentIndex < visibleAgents.length - 1 ? currentIndex + 1 : 0
				} else {
					nextIndex = currentIndex > 0 ? currentIndex - 1 : visibleAgents.length - 1
				}
				const agent = visibleAgents[nextIndex]
				if (agent) {
					navigate({
						to: "/project/$projectSlug/session/$sessionId",
						params: {
							projectSlug: agent.projectSlug,
							sessionId: agent.id,
						},
					})
				}
				return
			}

			if ((e.metaKey || e.ctrlKey) && e.key === "n") {
				e.preventDefault()
				navigate({ to: "/" })
				return
			}

			if ((e.metaKey || e.ctrlKey) && e.key === "k") {
				e.preventDefault()
				setCommandPaletteOpen(true)
				return
			}
		},
		[sessionId, visibleAgents, navigate, setCommandPaletteOpen],
	)

	useEffect(() => {
		document.addEventListener("keydown", handleKeyDown)
		return () => document.removeEventListener("keydown", handleKeyDown)
	}, [handleKeyDown])

	// ========== Layout ==========

	return (
		<TooltipProvider>
			<div className="flex h-screen bg-background text-foreground">
				<div className="w-[280px] shrink-0 border-r border-border">
					<Sidebar
						agents={visibleAgents}
						projects={projects}
						onOpenCommandPalette={() => setCommandPaletteOpen(true)}
						showSubAgents={showSubAgents}
						subAgentCount={subAgentCount}
						onToggleSubAgents={toggleShowSubAgents}
					/>
				</div>
				<div className="min-w-0 flex-1">
					<Outlet />
				</div>
			</div>
			<CommandPalette
				open={commandPaletteOpen}
				onOpenChange={setCommandPaletteOpen}
				agents={agents}
			/>
		</TooltipProvider>
	)
}
