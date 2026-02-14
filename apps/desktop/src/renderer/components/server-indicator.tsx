/**
 * Compact server indicator for the sidebar footer.
 *
 * Shows the active server name with a connection status dot.
 * Clicking opens a popover with a server switcher (including mDNS-discovered
 * servers) and link to settings.
 */

import { Popover, PopoverContent, PopoverTrigger } from "@palot/ui/components/popover"
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@palot/ui/components/sidebar"
import { useNavigate } from "@tanstack/react-router"
import { useAtomValue } from "jotai"
import { CheckIcon, GlobeIcon, MonitorIcon, RadarIcon, SettingsIcon } from "lucide-react"
import { useCallback, useMemo, useState } from "react"
import { serverConnectedAtom } from "../atoms/connection"
import { useServerActions, useServers } from "../hooks/use-servers"

export function ServerIndicator() {
	const { servers, activeServer, discoveredMdns } = useServers()
	const connected = useAtomValue(serverConnectedAtom)
	const { switchServer, saveDiscoveredServer } = useServerActions()
	const navigate = useNavigate()
	const [open, setOpen] = useState(false)

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
								tooltip={`Server: ${activeServer.name}`}
								className="text-muted-foreground hover:bg-transparent active:bg-transparent"
							/>
						}
					>
						<div className="relative">
							<ServerIcon aria-hidden="true" className="size-4" />
							{/* Status dot */}
							<span
								className={`absolute -right-0.5 -bottom-0.5 size-2 rounded-full border border-sidebar-background ${
									connected ? "bg-green-500" : "bg-yellow-500"
								}`}
							/>
						</div>
						<span className="truncate">{activeServer.name}</span>
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
