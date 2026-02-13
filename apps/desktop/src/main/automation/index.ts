/**
 * Automation manager -- top-level module that initializes and coordinates
 * the automation subsystem (database, registry, scheduler).
 *
 * Exports the public API consumed by IPC handlers.
 */

import crypto from "node:crypto"
import { eq } from "drizzle-orm"
import { createLogger } from "../logger"
import { closeDb, ensureDb, getDb } from "./database"
import { createConfig, deleteConfig, listConfigs, readConfig, updateConfig } from "./registry"
import { addTask, previewSchedule, removeTask, stopAll } from "./scheduler"
import { automationRuns, automations } from "./schema"
import { Semaphore } from "./semaphore"
import type {
	Automation,
	AutomationRun,
	CreateAutomationInput,
	UpdateAutomationInput,
} from "./types"

const log = createLogger("automation")

const semaphore = new Semaphore(5)

// ============================================================
// Initialization
// ============================================================

/** Initialize the automation subsystem. Call once at app startup. */
export async function initAutomations(): Promise<void> {
	log.info("Initializing automation subsystem")
	const db = await ensureDb()

	// Load all active automations and schedule them
	const configs = listConfigs()
	for (const config of configs) {
		if (config.status !== "active") continue

		// Ensure timing row exists in SQLite
		const existing = await db.select().from(automations).where(eq(automations.id, config.id)).get()
		if (!existing) {
			await db
				.insert(automations)
				.values({
					id: config.id,
					createdAt: Date.now(),
					updatedAt: Date.now(),
				})
				.run()
		}

		addTask(config.id, config.schedule.rrule, config.schedule.timezone, async () => {
			await executeAutomation(config.id)
		})
	}

	log.info(`Loaded ${configs.filter((c) => c.status === "active").length} active automations`)
}

/** Shut down the automation subsystem. Call on app quit. */
export function shutdownAutomations(): void {
	stopAll()
	closeDb()
	log.info("Automation subsystem shut down")
}

// ============================================================
// CRUD operations
// ============================================================

export async function listAutomations(): Promise<Automation[]> {
	const configs = listConfigs()
	const db = getDb()
	const results: Automation[] = []
	for (const config of configs) {
		const timing = await db.select().from(automations).where(eq(automations.id, config.id)).get()
		results.push(mergeAutomation(config, timing))
	}
	return results
}

export async function getAutomation(id: string): Promise<Automation | null> {
	const config = readConfig(id)
	if (!config) return null
	const db = getDb()
	const timing = await db.select().from(automations).where(eq(automations.id, id)).get()
	return mergeAutomation(config, timing)
}

export async function createAutomation(input: CreateAutomationInput): Promise<Automation> {
	const id = createConfig(input)
	const db = getDb()
	const now = Date.now()

	await db
		.insert(automations)
		.values({
			id,
			createdAt: now,
			updatedAt: now,
		})
		.run()

	// Schedule if active
	const config = readConfig(id)!
	if (config.status === "active") {
		addTask(id, config.schedule.rrule, config.schedule.timezone, async () => {
			await executeAutomation(id)
		})
	}

	return (await getAutomation(id))!
}

export async function updateAutomation(input: UpdateAutomationInput): Promise<Automation | null> {
	const before = readConfig(input.id)
	if (!before) return null

	updateConfig(input)
	const db = getDb()
	await db
		.update(automations)
		.set({ updatedAt: Date.now() })
		.where(eq(automations.id, input.id))
		.run()

	const after = readConfig(input.id)!

	// Re-schedule if schedule or status changed
	if (input.schedule || input.status) {
		removeTask(input.id)
		if (after.status === "active") {
			addTask(input.id, after.schedule.rrule, after.schedule.timezone, async () => {
				await executeAutomation(input.id)
			})
		}
	}

	return getAutomation(input.id)
}

export async function deleteAutomation(id: string): Promise<boolean> {
	removeTask(id)
	deleteConfig(id)
	const db = getDb()
	await db.delete(automations).where(eq(automations.id, id)).run()
	return true
}

// ============================================================
// Run operations
// ============================================================

export async function listRuns(automationId?: string, limit = 50): Promise<AutomationRun[]> {
	const db = getDb()

	if (automationId) {
		return (await db
			.select()
			.from(automationRuns)
			.where(eq(automationRuns.automationId, automationId))
			.limit(limit)
			.all()) as AutomationRun[]
	}

	return (await db.select().from(automationRuns).limit(limit).all()) as AutomationRun[]
}

export async function archiveRun(
	runId: string,
	reason: "auto" | "manual" = "manual",
): Promise<boolean> {
	const db = getDb()
	const result = await db
		.update(automationRuns)
		.set({
			status: "archived",
			archivedReason: reason,
			completedAt: Date.now(),
			updatedAt: Date.now(),
		})
		.where(eq(automationRuns.id, runId))
		.run()
	return result.rowsAffected > 0
}

export async function acceptRun(runId: string): Promise<boolean> {
	const db = getDb()
	const result = await db
		.update(automationRuns)
		.set({
			status: "accepted",
			completedAt: Date.now(),
			updatedAt: Date.now(),
		})
		.where(eq(automationRuns.id, runId))
		.run()
	return result.rowsAffected > 0
}

/** Mark a run as read without changing its status. */
export async function markRunRead(runId: string): Promise<boolean> {
	const db = getDb()
	const result = await db
		.update(automationRuns)
		.set({
			readAt: Date.now(),
			updatedAt: Date.now(),
		})
		.where(eq(automationRuns.id, runId))
		.run()
	return result.rowsAffected > 0
}

export async function runNow(id: string): Promise<boolean> {
	const config = readConfig(id)
	if (!config) return false
	await executeAutomation(id)
	return true
}

export { previewSchedule }

// ============================================================
// Execution (placeholder -- will be expanded with OpenCode SDK)
// ============================================================

async function executeAutomation(id: string): Promise<void> {
	const config = readConfig(id)
	if (!config || config.status !== "active") return

	const db = getDb()
	const release = await semaphore.acquire()

	try {
		// Run once per workspace, or once with empty workspace if none configured
		const targets = config.workspaces.length > 0 ? config.workspaces : [""]
		for (const workspace of targets) {
			const runId = crypto.randomUUID()
			const now = Date.now()

			await db
				.insert(automationRuns)
				.values({
					id: runId,
					automationId: id,
					workspace,
					status: "running",
					attempt: 1,
					startedAt: now,
					timeoutAt: now + config.execution.timeout * 1000,
					createdAt: now,
					updatedAt: now,
				})
				.run()

			// TODO: Integrate with OpenCode SDK to actually run the agent session
			// For now, mark as pending_review after a short delay
			log.info("Automation run started (stub)", { automationId: id, runId, workspace })

			await db
				.update(automationRuns)
				.set({
					status: "pending_review",
					resultTitle: config.name,
					resultSummary: "Automation completed (stub implementation)",
					resultHasActionable: true,
					completedAt: Date.now(),
					updatedAt: Date.now(),
				})
				.where(eq(automationRuns.id, runId))
				.run()
		}

		// Update timing state
		await db
			.update(automations)
			.set({
				lastRunAt: Date.now(),
				updatedAt: Date.now(),
			})
			.where(eq(automations.id, id))
			.run()
	} finally {
		release()
	}
}

// ============================================================
// Helpers
// ============================================================

function mergeAutomation(
	config: NonNullable<ReturnType<typeof readConfig>>,
	timing?: typeof automations.$inferSelect | undefined,
): Automation {
	return {
		id: config.id,
		name: config.name,
		prompt: config.prompt,
		status: config.status,
		schedule: config.schedule,
		workspaces: config.workspaces,
		execution: config.execution,
		nextRunAt: timing?.nextRunAt ?? null,
		lastRunAt: timing?.lastRunAt ?? null,
		runCount: timing?.runCount ?? 0,
		consecutiveFailures: timing?.consecutiveFailures ?? 0,
		createdAt: timing?.createdAt ?? Date.now(),
		updatedAt: timing?.updatedAt ?? Date.now(),
	}
}
