import { Button } from "@palot/ui/components/button"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@palot/ui/components/dropdown-menu"
import { ChevronDownIcon, Loader2Icon, ShieldCheckIcon } from "lucide-react"
import { memo, useState } from "react"
import type { Agent } from "../../lib/types"

interface PermissionItemProps {
	agent: Agent
	permission: { id: string; title: string; metadata?: Record<string, unknown> }
	onApprove?: (agent: Agent, permissionId: string, response?: "once" | "always") => Promise<void>
	onDeny?: (agent: Agent, permissionId: string) => Promise<void>
	isConnected?: boolean
}

/**
 * Single permission request card — compact style matching the task list.
 */
export const PermissionItem = memo(function PermissionItem({
	agent,
	permission,
	onApprove,
	onDeny,
	isConnected,
}: PermissionItemProps) {
	const [responding, setResponding] = useState(false)

	async function handleApprove(response: "once" | "always" = "once") {
		if (!onApprove || responding) return
		setResponding(true)
		try {
			await onApprove(agent, permission.id, response)
		} finally {
			setResponding(false)
		}
	}

	async function handleDeny() {
		if (!onDeny || responding) return
		setResponding(true)
		try {
			await onDeny(agent, permission.id)
		} finally {
			setResponding(false)
		}
	}

	const tool = permission.metadata?.tool as string | undefined
	const command = permission.metadata?.command as string | undefined

	return (
		<div className="mb-2 rounded-xl border border-border bg-card">
			<div className="px-3 py-2">
				<div className="flex items-center gap-1.5">
					<ShieldCheckIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
					<span className="text-sm text-foreground">{permission.title}</span>
				</div>
				{(tool || command) && (
					<code className="mt-1 block truncate text-xs text-muted-foreground">
						{tool && <span>{tool}</span>}
						{tool && command && <span> </span>}
						{command && <span>{command.length > 80 ? `${command.slice(0, 80)}...` : command}</span>}
					</code>
				)}
			</div>
			<div className="flex items-center justify-end gap-2 border-t border-border px-3 py-2">
				<button
					type="button"
					onClick={handleDeny}
					disabled={!isConnected || responding}
					className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
				>
					Deny
				</button>
				<div className="flex items-center">
					<Button
						size="sm"
						onClick={() => handleApprove("once")}
						disabled={!isConnected || responding}
						className="h-7 rounded-r-none px-2.5 text-xs"
					>
						{responding && <Loader2Icon className="size-3 animate-spin" aria-hidden="true" />}
						Allow
					</Button>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								size="sm"
								disabled={!isConnected || responding}
								className="h-7 rounded-l-none border-l border-primary-foreground/20 px-1"
								aria-label="More approval options"
							>
								<ChevronDownIcon className="size-3" aria-hidden="true" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							<DropdownMenuItem onClick={() => handleApprove("once")}>Allow once</DropdownMenuItem>
							<DropdownMenuItem onClick={() => handleApprove("always")}>
								Always allow
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			</div>
		</div>
	)
})
