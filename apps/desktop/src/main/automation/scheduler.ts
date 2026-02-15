/**
 * Automation scheduler service.
 *
 * Uses the rrule library for date math and setTimeout for precise
 * per-automation timers. No polling -- each automation gets a single
 * timer set to fire at its exact next run time.
 */

import { createLogger } from "../logger"

const log = createLogger("automation-scheduler")

interface ScheduledTask {
	timer: ReturnType<typeof setTimeout> | null
	rruleStr: string
	timezone: string
	paused: boolean
	running: boolean
	callback: () => Promise<void>
	/** The computed next run time, updated after each scheduling cycle. */
	nextRunAt: Date | null
}

const tasks = new Map<string, ScheduledTask>()

// ============================================================
// Internal helpers
// ============================================================

async function computeNextRun(rruleStr: string, _timezone: string): Promise<Date | null> {
	const { RRule } = await import("rrule")
	try {
		const rule = RRule.fromString(rruleStr)
		const next = rule.after(new Date(), false)
		return next
	} catch (err) {
		log.error("Failed to parse RRULE", { rruleStr }, err)
		return null
	}
}

function scheduleNext(id: string, task: ScheduledTask) {
	if (task.timer) {
		clearTimeout(task.timer)
		task.timer = null
	}

	if (task.paused) {
		task.nextRunAt = null
		return
	}

	computeNextRun(task.rruleStr, task.timezone).then((next) => {
		if (!next) {
			log.warn("No next occurrence for automation", { id })
			task.nextRunAt = null
			return
		}

		task.nextRunAt = next
		const delay = Math.max(0, next.getTime() - Date.now())
		log.debug("Scheduling automation", { id, nextRun: next.toISOString(), delayMs: delay })

		task.timer = setTimeout(async () => {
			if (task.paused || task.running) return

			task.running = true
			try {
				await task.callback()
			} catch (err) {
				log.error("Automation run failed", { id }, err)
			} finally {
				task.running = false
				// Schedule the next run
				if (tasks.has(id) && !task.paused) {
					scheduleNext(id, task)
				}
			}
		}, delay)

		// Don't prevent app exit
		if (task.timer && typeof task.timer === "object" && "unref" in task.timer) {
			task.timer.unref()
		}
	})
}

// ============================================================
// Public API
// ============================================================

export function addTask(
	id: string,
	rruleStr: string,
	timezone: string,
	callback: () => Promise<void>,
): void {
	removeTask(id)
	const task: ScheduledTask = {
		timer: null,
		rruleStr,
		timezone,
		paused: false,
		running: false,
		callback,
		nextRunAt: null,
	}
	tasks.set(id, task)
	scheduleNext(id, task)
}

export function removeTask(id: string): void {
	const task = tasks.get(id)
	if (task) {
		if (task.timer) clearTimeout(task.timer)
		tasks.delete(id)
	}
}

export function pauseTask(id: string): void {
	const task = tasks.get(id)
	if (task) {
		task.paused = true
		if (task.timer) {
			clearTimeout(task.timer)
			task.timer = null
		}
	}
}

export function resumeTask(id: string): void {
	const task = tasks.get(id)
	if (task?.paused) {
		task.paused = false
		scheduleNext(id, task)
	}
}

export function isRunning(id: string): boolean {
	return tasks.get(id)?.running ?? false
}

/**
 * Returns the computed next run time for a scheduled task, or null if
 * the task doesn't exist, is paused, or has no future occurrences.
 */
export function getNextRunTime(id: string): Date | null {
	return tasks.get(id)?.nextRunAt ?? null
}

export function stopAll(): void {
	for (const [_id, task] of tasks) {
		if (task.timer) clearTimeout(task.timer)
	}
	tasks.clear()
	log.info("Stopped all scheduled automations")
}

/**
 * Compute the next N occurrences for an RRULE (for UI preview).
 */
export async function previewSchedule(
	rruleStr: string,
	_timezone: string,
	count: number = 5,
): Promise<Date[]> {
	const { RRule } = await import("rrule")
	try {
		const rule = RRule.fromString(rruleStr)
		const dates: Date[] = []
		let current = new Date()
		for (let i = 0; i < count; i++) {
			const next = rule.after(current, false)
			if (!next) break
			dates.push(next)
			current = next
		}
		return dates
	} catch {
		return []
	}
}
