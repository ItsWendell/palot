/**
 * Sidebar cost tracker widget.
 *
 * Shows total live spend across all agent sessions in the sidebar footer.
 * Clicking opens a popover with a per-agent breakdown (tokens + cost).
 * Hidden when no sessions have consumed any tokens.
 */
import { Popover, PopoverContent, PopoverTrigger } from "@palot/ui/components/popover"
import {
	SidebarMenuButton,
	SidebarMenuItem,
} from "@palot/ui/components/sidebar"
import { cn } from "@palot/ui/lib/utils"
import { useAtomValue } from "jotai"
import { CoinsIcon } from "lucide-react"
import { memo } from "react"
import { agentCostsAtom } from "../atoms/cost-tracking"
import { getBudgetDisplay } from "../lib/agent-progress-display"

// ============================================================
// CostTracker
// ============================================================

/**
 * Compact sidebar button that shows total session spend.
 * Opens a popover with a per-agent cost breakdown on click.
 */
export const CostTracker = memo(function CostTracker() {
	const { entries, totalCostFormatted, totalCost, totalTokensFormatted } =
		useAtomValue(agentCostsAtom)

	if (totalCost === 0 && entries.length === 0) return null

	const budget = getBudgetDisplay(totalCost)

	return (
		<SidebarMenuItem>
			<Popover>
				<PopoverTrigger
					render={
						<SidebarMenuButton
							tooltip="Live agent spend"
							className={cn("tabular-nums", budget.textClassName)}
						/>
					}
				>
					<CoinsIcon className="size-4 shrink-0" aria-hidden="true" />
					<span>
						{totalCostFormatted}
						<span className="ml-1 text-muted-foreground/50">spent</span>
					</span>
				</PopoverTrigger>

				<PopoverContent side="right" align="end" sideOffset={8} className="w-72 gap-0 p-0">
					<div className="p-3 space-y-3 text-xs">
						{/* Header */}
						<div className="flex items-center justify-between">
							<p className="font-medium text-foreground/80">Live Spend</p>
							<span className={cn("rounded-full border px-1.5 py-0.5 text-[10px] font-medium", budget.badgeClassName)}>
								{budget.label}
							</span>
						</div>
						<div className="flex items-center justify-between text-[11px] tabular-nums text-muted-foreground/60">
							<span>{totalTokensFormatted} tok total</span>
							<span>{totalCostFormatted}</span>
						</div>

						{/* Per-agent rows */}
						{entries.length > 0 ? (
							<div className="space-y-1">
								{entries.map((entry) => (
									<AgentCostRow key={entry.sessionId} entry={entry} />
								))}
							</div>
						) : (
							<p className="text-muted-foreground">No spend yet.</p>
						)}

						{/* Total footer */}
						{entries.length > 1 && (
							<div className="border-t border-border/50 pt-2 flex items-center justify-between font-medium">
								<span>Total</span>
								<div className="flex items-center gap-3 tabular-nums">
									<span className="text-muted-foreground">{totalTokensFormatted} tok</span>
									<span>{totalCostFormatted}</span>
								</div>
							</div>
						)}
					</div>
				</PopoverContent>
			</Popover>
		</SidebarMenuItem>
	)
})

// ============================================================
// Per-agent cost row
// ============================================================

interface AgentCostRowProps {
	entry: import("../atoms/cost-tracking").AgentCostEntry
}

function AgentCostRow({ entry }: AgentCostRowProps) {
	return (
		<div className="flex items-center gap-2 py-0.5">
			<span className="min-w-0 flex-1 truncate text-muted-foreground">{entry.name}</span>
			<div className="flex items-center gap-3 shrink-0 tabular-nums">
				<span className="text-muted-foreground/60">{entry.tokens}</span>
				<span className="w-12 text-right font-medium text-foreground">{entry.cost}</span>
			</div>
		</div>
	)
}
