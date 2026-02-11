import {
	Sidebar,
	SidebarContent,
	SidebarGroup,
	SidebarGroupContent,
	SidebarHeader,
	SidebarInset,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarProvider,
} from "@codedeck/ui/components/sidebar"
import { useNavigate } from "@tanstack/react-router"
import { ArrowLeftIcon, BellIcon, InfoIcon, SettingsIcon } from "lucide-react"
import { useId, useState } from "react"
import { APP_BAR_HEIGHT } from "../app-bar"
import { AboutSettings } from "./about-settings"
import { GeneralSettings } from "./general-settings"
import { NotificationSettings } from "./notification-settings"

type SettingsTab = "general" | "notifications" | "about"

const tabs: { id: SettingsTab; label: string; icon: typeof SettingsIcon }[] = [
	{ id: "general", label: "General", icon: SettingsIcon },
	{ id: "notifications", label: "Notifications", icon: BellIcon },
	{ id: "about", label: "About", icon: InfoIcon },
]

export function SettingsPage() {
	const [activeTab, setActiveTab] = useState<SettingsTab>("general")
	const navigate = useNavigate()
	const panelId = useId()

	return (
		<div className="fixed inset-0 z-50 flex flex-col bg-background text-foreground">
			{/* Reserve space for traffic lights / app bar area */}
			<div
				className="shrink-0"
				style={{
					height: APP_BAR_HEIGHT,
					// @ts-expect-error -- vendor-prefixed CSS property
					WebkitAppRegion: "drag",
				}}
			/>
			<SidebarProvider
				embedded
				defaultOpen={true}
				style={{ "--sidebar-width": "14rem" } as React.CSSProperties}
				className="min-h-0 flex-1"
			>
				<Sidebar collapsible="none" variant="sidebar">
					<SidebarHeader className="px-2 py-1">
						<button
							type="button"
							onClick={() => navigate({ to: "/" })}
							className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
						>
							<ArrowLeftIcon aria-hidden="true" className="size-4" />
							Back to app
						</button>
					</SidebarHeader>
					<SidebarContent>
						<SidebarGroup>
							<SidebarGroupContent>
								<SidebarMenu role="tablist" aria-label="Settings sections">
									{tabs.map((tab) => {
										const Icon = tab.icon
										const isActive = activeTab === tab.id
										return (
											<SidebarMenuItem key={tab.id} role="presentation">
												<SidebarMenuButton
													isActive={isActive}
													onClick={() => setActiveTab(tab.id)}
													tooltip={tab.label}
													role="tab"
													aria-selected={isActive}
													aria-controls={`${panelId}-${tab.id}`}
													id={`${panelId}-tab-${tab.id}`}
												>
													<Icon aria-hidden="true" className="size-4" />
													<span>{tab.label}</span>
												</SidebarMenuButton>
											</SidebarMenuItem>
										)
									})}
								</SidebarMenu>
							</SidebarGroupContent>
						</SidebarGroup>
					</SidebarContent>
				</Sidebar>
				<SidebarInset className="overflow-y-auto">
					<div
						className="mx-auto max-w-2xl px-8 py-6"
						role="tabpanel"
						id={`${panelId}-${activeTab}`}
						aria-labelledby={`${panelId}-tab-${activeTab}`}
					>
						{activeTab === "general" && <GeneralSettings />}
						{activeTab === "notifications" && <NotificationSettings />}
						{activeTab === "about" && <AboutSettings />}
					</div>
				</SidebarInset>
			</SidebarProvider>
		</div>
	)
}
