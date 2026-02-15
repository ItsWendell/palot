/**
 * Automations inbox page -- two-panel layout with run list (left) and detail (right).
 *
 * This is the main view rendered at /automations. It uses a ResizablePanelGroup
 * for the split layout and drives the data pipeline via useAutomationData().
 */

import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from "@palot/ui/components/resizable"
import { Outlet } from "@tanstack/react-router"
import { useCallback, useState } from "react"
import { toast } from "sonner"
import type { Automation } from "../../../preload/api"
import { useAutomationData } from "../../hooks/use-automation-data"
import { deleteAutomation, runAutomationNow, updateAutomation } from "../../services/backend"
import { CreateAutomationDialog } from "./create-automation-dialog"
import { InboxRunList } from "./inbox-run-list"
import { InboxToolbar } from "./inbox-toolbar"

// ============================================================
// Main page component
// ============================================================

export function AutomationsPage() {
	// Single data gateway -- fetches automations + runs, subscribes to updates
	useAutomationData()

	const [dialogOpen, setDialogOpen] = useState(false)
	const [editingAutomation, setEditingAutomation] = useState<Automation | null>(null)

	const handleNewClick = useCallback(() => {
		setEditingAutomation(null)
		setDialogOpen(true)
	}, [])

	const handleEditAutomation = useCallback((automation: Automation) => {
		setEditingAutomation(automation)
		setDialogOpen(true)
	}, [])

	const handleRunNow = useCallback(async (automationId: string) => {
		try {
			await runAutomationNow(automationId)
			toast.success("Automation run started", {
				description: "Check the inbox for results.",
			})
		} catch (err) {
			toast.error("Failed to run automation", {
				description: err instanceof Error ? err.message : undefined,
			})
		}
	}, [])

	const handleTogglePause = useCallback(async (automation: Automation) => {
		try {
			await updateAutomation({
				id: automation.id,
				status: automation.status === "paused" ? "active" : "paused",
			})
		} catch (err) {
			toast.error("Failed to update automation", {
				description: err instanceof Error ? err.message : undefined,
			})
		}
	}, [])

	const handleDeleteAutomation = useCallback(async (automationId: string) => {
		try {
			await deleteAutomation(automationId)
		} catch (err) {
			toast.error("Failed to delete automation", {
				description: err instanceof Error ? err.message : undefined,
			})
		}
	}, [])

	const handleDialogChange = useCallback((open: boolean) => {
		setDialogOpen(open)
		if (!open) setEditingAutomation(null)
	}, [])

	return (
		<div className="flex h-full flex-col">
			<ResizablePanelGroup orientation="horizontal" className="flex-1" id="automations-inbox">
				{/* Left panel: list */}
				<ResizablePanel id="automations-list" defaultSize="35%" minSize="25%" maxSize="50%">
					<div className="flex h-full flex-col">
						<InboxToolbar onNewClick={handleNewClick} />
						<InboxRunList
							onEditAutomation={handleEditAutomation}
							onRunNow={handleRunNow}
							onTogglePause={handleTogglePause}
							onDeleteAutomation={handleDeleteAutomation}
						/>
					</div>
				</ResizablePanel>

				<ResizableHandle />

				{/* Right panel: detail or empty state */}
				<ResizablePanel id="automations-detail" defaultSize="65%" minSize="40%">
					<div className="flex h-full flex-col">
						<Outlet />
					</div>
				</ResizablePanel>
			</ResizablePanelGroup>

			<CreateAutomationDialog
				open={dialogOpen}
				onOpenChange={handleDialogChange}
				editAutomation={editingAutomation}
			/>
		</div>
	)
}
