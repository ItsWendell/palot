/**
 * Compact server indicator for the sidebar footer.
 *
 * Shows the active server name with a connection status dot.
 * Clicking opens a popover with a server switcher (including mDNS-discovered
 * servers) and link to settings.
 *
 * When the popover opens, non-active remote servers are health-checked
 * on demand via a quick fetch to /global/health.
 */

import { Popover, PopoverContent, PopoverTrigger } from "@palot/ui/components/popover"
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@palot/ui/components/sidebar"
import { useNavigate } from "@tanstack/react-router"
import { useAtomValue } from "jotai"
import { CheckIcon, GlobeIcon, MonitorIcon, RadarIcon, SettingsIcon } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { ServerConfig } from "../../preload/api"
import { serverConnectedAtom } from "../atoms/connection"
import { useServerActions, useServers } from "../hooks/use-servers"
import { isElectron, resolveAuthHeader, resolveServerUrl } from "../services/backend"

// ============================================================
// Health probe helper
// ============================================================

/**
 * Probes a single server's /global/health endpoint.
 * Returns true if healthy, false otherwise. Times out after 3s.
 */
async function probeServerHealth(server: ServerConfig): Promise<boolean> {
	try {
		const url = await resolveServerUrl(server)
		const headers: Record<string, string> = {}
		const auth = await resolveAuthHeader(server)
		if (auth) headers.Authorization = auth

		const controller = new AbortController()
		const timeout = setTimeout(() => controller.abort(), 3000)

		if (isElectron && "palot" in window) {
			// Use IPC fetch to bypass connection limits
			const result = await window.palot.fetch({
				url: `${url}/global/health`,
				method: "GET",
				headers,
				body: null,
			})
			clearTimeout(timeout)
			return result.status === 200
		}

		const response = await fetch(`${url}/global/health`, {
			headers,
			signal: controller.signal,
		})
		clearTimeout(timeout)
		return response.ok
	} catch {
		return false
	}
}

// ============================================================
// Status dot component
// ============================================================

type HealthState = boolean | null

function StatusDot({ health, className }: { health: HealthState; className?: string }) {
	if (health === null) {
		// Still checking: pulsing neutral dot
		return (
			<span
				className={`size-1.5 shrink-0 rounded-full bg-muted-foreground/40 animate-pulse ${className ?? ""}`}
			/>
		)
	}
	return (
		<span
			className={`size-1.5 shrink-0 rounded-full ${health ? "bg-green-500" : "bg-red-500"} ${className ?? ""}`}
		/>
	)
}

// ============================================================
// Main component
// ============================================================

export function ServerIndicator() {
	const { servers, activeServer, discoveredMdns } = useServers()
	const connected = useAtomValue(serverConnectedAtom)
	const { switchServer, saveDiscoveredServer } = useServerActions()
	const navigate = useNavigate()
	const [open, setOpen] = useState(false)

	// Health state for non-active servers, probed when popover opens.
	// Map<serverId, boolean | null>  (null = still checking)
	const [healthMap, setHealthMap] = useState<Map<string, HealthState>>(new Map())
	const probeGeneration = useRef(0)

	// Probe non-active servers when popover opens
	useEffect(() => {
		if (!open) return

		const gen = ++probeGeneration.current
		const nonActive = servers.filter((s) => s.id !== activeServer.id)
		if (nonActive.length === 0) return

		// Initialize all to null (checking)
		setHealthMap((prev) => {
			const next = new Map(prev)
			for (const s of nonActive) next.set(s.id, null)
			return next
		})

		// Fire probes in parallel
		for (const server of nonActive) {
			probeServerHealth(server).then((healthy) => {
				if (gen !== probeGeneration.current) return // stale
				setHealthMap((prev) => new Map(prev).set(server.id, healthy))
			})
		}
	}, [open, servers, activeServer.id])

	const handleSwitch = useCallback(
		(serverId: string) => {
			switchServer(serverId)
			setOpen(false)
		},
		[switchServer],
	)

	const handleSettings = useCallback(() => {
		setOpen(false)
		navigate({ to: "/settings/servers" })
	}, [navigate])

	const handleSaveDiscovered = useCallback(
		async (mdnsId: string) => {
			const mdnsServer = discoveredMdns.find((s) => s.id === mdnsId)
			if (!mdnsServer) return
			await saveDiscoveredServer(mdnsServer)
			setOpen(false)
		},
		[discoveredMdns, saveDiscoveredServer],
	)

	// Filter out discovered servers that are already saved as configured servers
	// by matching on host:port
	const unsavedDiscovered = useMemo(() => {
		const savedUrls = new Set(
			servers
				.filter((s) => s.type === "remote")
				.map((s) => {
					try {
						const u = new URL(s.url)
						return `${u.hostname}:${u.port || (u.protocol === "https:" ? "443" : "80")}`
					} catch {
						return null
					}
				})
				.filter(Boolean),
		)

		return discoveredMdns.filter((d) => {
			// Check if any address matches a saved server
			const hostPort = `${d.host}:${d.port}`
			if (savedUrls.has(hostPort)) return false
			for (const addr of d.addresses) {
				if (savedUrls.has(`${addr}:${d.port}`)) return false
			}
			return true
		})
	}, [servers, discoveredMdns])

	const isLocal = activeServer.type === "local"
	const ServerIcon = isLocal ? MonitorIcon : GlobeIcon

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<SidebarMenu>
				<SidebarMenuItem>
					<PopoverTrigger
						render={
							<SidebarMenuButton
								tooltip={
									connected
										? `Server: ${activeServer.name}`
										: `Server offline: ${activeServer.name}`
								}
								className={
									connected
										? "text-muted-foreground hover:bg-transparent active:bg-transparent"
										: "text-red-500 hover:bg-transparent active:bg-transparent"
								}
							/>
						}
					>
						<div className="relative">
							<ServerIcon aria-hidden="true" className="size-4" />
							{/* Status dot */}
							<span
								className={`absolute -right-0.5 -bottom-0.5 size-2 rounded-full border border-sidebar-background ${
									connected ? "bg-green-500" : "bg-red-500"
								}`}
							/>
						</div>
						<span className="truncate">{activeServer.name}</span>
						{!connected && <span className="text-[10px] text-red-500/70">(offline)</span>}
					</PopoverTrigger>
				</SidebarMenuItem>
			</SidebarMenu>

			<PopoverContent side="top" align="start" className="w-64 p-1">
				<div className="px-2 py-1.5">
					<p className="text-xs font-medium text-muted-foreground">Servers</p>
				</div>
				{servers.map((server) => {
					const isActive = server.id === activeServer.id
					const Icon = server.type === "local" ? MonitorIcon : GlobeIcon
					const health: HealthState = isActive ? connected : (healthMap.get(server.id) ?? null)

					return (
						<button
							key={server.id}
							type="button"
							onClick={() => !isActive && handleSwitch(server.id)}
							className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors ${
								isActive ? "bg-accent text-accent-foreground" : "text-foreground hover:bg-accent/50"
							}`}
						>
							<Icon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
							<span className="min-w-0 flex-1 truncate">{server.name}</span>
							<StatusDot health={health} />
							{isActive && (
								<CheckIcon aria-hidden="true" className="size-3.5 shrink-0 text-primary" />
							)}
						</button>
					)
				})}

				{/* mDNS discovered servers */}
				{unsavedDiscovered.length > 0 && (
					<>
						<div className="my-1 border-t border-border" />
						<div className="px-2 py-1.5">
							<p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
								<RadarIcon aria-hidden="true" className="size-3" />
								Discovered on Network
							</p>
						</div>
						{unsavedDiscovered.map((mdns) => (
							<button
								key={mdns.id}
								type="button"
								onClick={() => handleSaveDiscovered(mdns.id)}
								className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-accent/50"
							>
								<RadarIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
								<span className="min-w-0 flex-1 truncate">{mdns.name}</span>
								<span className="shrink-0 text-[10px] text-muted-foreground">
									{mdns.addresses[0] || mdns.host}:{mdns.port}
								</span>
							</button>
						))}
					</>
				)}

				<div className="my-1 border-t border-border" />
				<button
					type="button"
					onClick={handleSettings}
					className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
				>
					<SettingsIcon aria-hidden="true" className="size-3.5" />
					Manage Servers...
				</button>
			</PopoverContent>
		</Popover>
	)
}
