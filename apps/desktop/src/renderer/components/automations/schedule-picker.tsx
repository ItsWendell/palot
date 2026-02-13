/**
 * Schedule picker compound component with Daily/Interval toggle.
 *
 * Externally controlled via RRULE string: value + onChange.
 * Internally converts between RRULE and a friendly UI state.
 */

import { Button } from "@palot/ui/components/button"
import { Input } from "@palot/ui/components/input"
import { Label } from "@palot/ui/components/label"
import { Tooltip, TooltipContent, TooltipTrigger } from "@palot/ui/components/tooltip"
import { useCallback, useMemo } from "react"
import {
	ALL_WEEKDAYS,
	rruleToScheduleConfig,
	type ScheduleConfig,
	type ScheduleMode,
	scheduleConfigToRrule,
	WEEKDAY_LABELS,
	type Weekday,
} from "../../lib/rrule-ui"

interface SchedulePickerProps {
	value: string
	onChange: (rrule: string) => void
}

export function SchedulePicker({ value, onChange }: SchedulePickerProps) {
	const config = useMemo(() => rruleToScheduleConfig(value), [value])

	const updateConfig = useCallback(
		(patch: Partial<ScheduleConfig>) => {
			const updated = { ...config, ...patch }
			onChange(scheduleConfigToRrule(updated))
		},
		[config, onChange],
	)

	const setMode = useCallback((mode: ScheduleMode) => updateConfig({ mode }), [updateConfig])

	const setTime = useCallback((time: string) => updateConfig({ time }), [updateConfig])

	const setIntervalHours = useCallback(
		(hours: number) => updateConfig({ intervalHours: Math.max(1, hours) }),
		[updateConfig],
	)

	const toggleWeekday = useCallback(
		(day: Weekday) => {
			const current = new Set(config.weekdays)
			if (current.has(day)) {
				// Don't allow deselecting the last day
				if (current.size <= 1) return
				current.delete(day)
			} else {
				current.add(day)
			}
			updateConfig({ weekdays: ALL_WEEKDAYS.filter((d) => current.has(d)) })
		},
		[config.weekdays, updateConfig],
	)

	return (
		<div className="space-y-3">
			<div className="flex items-center justify-between">
				<Label>Schedule</Label>

				{/* Mode toggle */}
				<div className="flex rounded-md border border-border/50">
					<button
						type="button"
						onClick={() => setMode("daily")}
						className={`rounded-l-md px-3 py-1 text-xs font-medium transition-colors ${
							config.mode === "daily"
								? "bg-accent text-accent-foreground"
								: "text-muted-foreground hover:text-foreground"
						}`}
					>
						Daily
					</button>
					<button
						type="button"
						onClick={() => setMode("interval")}
						className={`rounded-r-md border-l border-border/50 px-3 py-1 text-xs font-medium transition-colors ${
							config.mode === "interval"
								? "bg-accent text-accent-foreground"
								: "text-muted-foreground hover:text-foreground"
						}`}
					>
						Interval
					</button>
				</div>
			</div>

			{/* Mode-specific fields */}
			<div className="flex items-center gap-3">
				{config.mode === "daily" ? (
					<Input
						type="time"
						value={config.time}
						onChange={(e) => setTime(e.target.value)}
						className="w-28"
					/>
				) : (
					<div className="flex items-center gap-2">
						<span className="text-sm text-muted-foreground">Run every</span>
						<Input
							type="number"
							min={1}
							step={1}
							value={config.intervalHours}
							onChange={(e) => setIntervalHours(Number.parseInt(e.target.value, 10) || 1)}
							className="w-16"
						/>
						<span className="text-sm text-muted-foreground">hours</span>
					</div>
				)}

				{/* Weekday toggles */}
				<div className="flex gap-1">
					{ALL_WEEKDAYS.map((day) => {
						const isSelected = config.weekdays.includes(day)
						return (
							<Tooltip key={day}>
								<TooltipTrigger
									render={
										<Button
											type="button"
											variant={isSelected ? "default" : "outline"}
											size="icon"
											className="size-7 text-[10px] font-medium"
											onClick={() => toggleWeekday(day)}
										/>
									}
								>
									{WEEKDAY_LABELS[day]}
								</TooltipTrigger>
								<TooltipContent>{isSelected ? "Included" : "Excluded"}</TooltipContent>
							</Tooltip>
						)
					})}
				</div>
			</div>
		</div>
	)
}
