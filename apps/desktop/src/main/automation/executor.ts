/**
 * Automation executor -- runs agent sessions via the OpenCode SDK.
 *
 * Given an automation config and workspace directory, the executor:
 * 1. Creates a worktree (if useWorktree is enabled)
 * 2. Creates an OpenCode session with the appropriate permission ruleset
 * 3. Sends the automation prompt (with memory file context)
 * 4. Monitors SSE events until session goes idle or times out
 * 5. Captures results (summary, branch, diffs) and updates the run record
 * 6. Auto-archives if the agent reports nothing actionable
 *
 * Modeled after OpenCode's `run` CLI (packages/opencode/src/cli/cmd/run.ts).
 */

import fs from "node:fs"
import path from "node:path"
import type { OpencodeClient, PermissionRuleset } from "@opencode-ai/sdk/v2/client"
import { createLogger } from "../logger"
import { createAutomationClient } from "./opencode-client"
import { getConfigDir } from "./paths"
import type { AutomationConfig, PermissionPreset } from "./types"

const log = createLogger("automation-executor")

// ============================================================
// Permission presets
// ============================================================

/**
 * Maps a PermissionPreset to a PermissionRuleset array.
 *
 * - "default": No overrides, inherit project config. Deny questions/plans
 *   so the agent doesn't block waiting for interactive input.
 * - "allow-all": Allow all permissions (fully autonomous).
 * - "read-only": Deny edit/write/bash, allow read-only tools.
 */
function buildPermissionRuleset(preset: PermissionPreset): PermissionRuleset {
	// Base rules: always deny interactive prompts (questions, plan mode)
	// since there's no human watching the automation
	const baseRules: PermissionRuleset = [
		{ permission: "question", pattern: "*", action: "deny" },
		{ permission: "plan_enter", pattern: "*", action: "deny" },
		{ permission: "plan_exit", pattern: "*", action: "deny" },
	]

	switch (preset) {
		case "allow-all":
			return [
				...baseRules,
				{ permission: "edit", pattern: "*", action: "allow" },
				{ permission: "bash", pattern: "*", action: "allow" },
				{ permission: "webfetch", pattern: "*", action: "allow" },
				{ permission: "external_directory", pattern: "*", action: "allow" },
			]
		case "read-only":
			return [
				...baseRules,
				{ permission: "edit", pattern: "*", action: "deny" },
				{ permission: "bash", pattern: "*", action: "deny" },
				{ permission: "webfetch", pattern: "*", action: "allow" },
			]
		default:
			// "default" or any unknown value: inherit project config, only deny interactive prompts
			return baseRules
	}
}

// ============================================================
// Memory file
// ============================================================

/**
 * Returns the path to the automation's memory file.
 * Lives at ~/.config/palot/automations/<id>/memory.md
 */
function getMemoryFilePath(automationId: string): string {
	return path.join(getConfigDir(), "automations", automationId, "memory.md")
}

/**
 * Reads the memory file content, or returns empty string if it doesn't exist.
 */
function readMemoryFile(automationId: string): string {
	const memPath = getMemoryFilePath(automationId)
	try {
		return fs.readFileSync(memPath, "utf-8")
	} catch {
		return ""
	}
}

/**
 * Builds the system prompt addendum that tells the agent about the memory file.
 */
function buildSystemPrompt(automationId: string, automationName: string): string {
	const memPath = getMemoryFilePath(automationId)
	const memory = readMemoryFile(automationId)

	const lines = [
		`You are running as an automated agent for the "${automationName}" automation.`,
		"",
		"IMPORTANT RULES:",
		"- Do NOT ask questions or enter plan mode. You must complete the task autonomously.",
		"- At the END of your response, include a line: `Actionable: yes` or `Actionable: no`",
		"  to indicate whether your findings require human review.",
		"",
		`You have a persistent memory file at: ${memPath}`,
		"You can read it and write to it to remember context across runs.",
	]

	if (memory) {
		lines.push("", "Current memory file contents:", "```", memory, "```")
	}

	return lines.join("\n")
}

// ============================================================
// Event monitoring
// ============================================================

export interface ExecutionResult {
	sessionId: string
	worktreePath: string | null
	title: string
	summary: string
	hasActionable: boolean
	branch: string | null
	error: string | null
}

/**
 * Monitors SSE events for a session until it goes idle, errors, or times out.
 *
 * Returns collected text output and error information.
 */
async function monitorSession(
	client: OpencodeClient,
	sessionId: string,
	timeoutMs: number,
	signal: AbortSignal,
): Promise<{ text: string; error: string | null }> {
	const textParts: string[] = []
	let error: string | null = null

	const timeoutPromise = new Promise<"timeout">((resolve) => {
		const timer = setTimeout(() => resolve("timeout"), timeoutMs)
		signal.addEventListener("abort", () => clearTimeout(timer), { once: true })
	})

	const eventPromise = (async (): Promise<"done"> => {
		try {
			const result = await client.event.subscribe()
			for await (const event of result.stream) {
				if (signal.aborted) break

				// biome-ignore lint/suspicious/noExplicitAny: SSE events have dynamic types not fully covered by SDK
				const evt = event as any

				// Capture text output from the assistant
				if (evt.type === "message.part.updated") {
					const part = evt.properties?.part
					if (
						part?.sessionID === sessionId &&
						part?.type === "text" &&
						part?.time?.end &&
						part?.text
					) {
						textParts.push(part.text)
					}
				}

				// Capture errors
				if (evt.type === "session.error") {
					if (evt.properties?.sessionID === sessionId && evt.properties?.error) {
						const errObj = evt.properties.error
						const errMsg = errObj.data?.message ?? errObj.name ?? "Unknown error"
						error = error ? `${error}\n${errMsg}` : String(errMsg)
						log.error("Session error during automation", {
							sessionId,
							error: errMsg,
						})
					}
				}

				// Auto-reject permission requests (the permission ruleset should prevent
				// most, but catch any that slip through)
				if (evt.type === "permission.asked") {
					if (evt.properties?.sessionID === sessionId) {
						log.warn("Auto-rejecting permission request during automation", {
							sessionId,
							permission: evt.properties.permission,
						})
						try {
							await client.permission.reply({
								requestID: evt.properties.id,
								reply: "reject",
							})
						} catch (rejectErr) {
							log.warn("Failed to reject permission request", rejectErr)
						}
					}
				}

				// Auto-reject question requests
				if (evt.type === "question.asked") {
					if (evt.properties?.sessionID === sessionId) {
						log.warn("Auto-rejecting question during automation", { sessionId })
						try {
							await client.question.reject({
								requestID: evt.properties.id,
							})
						} catch (rejectErr) {
							log.warn("Failed to reject question", rejectErr)
						}
					}
				}

				// Session went idle -- we're done
				if (
					evt.type === "session.status" &&
					evt.properties?.sessionID === sessionId &&
					evt.properties?.status?.type === "idle"
				) {
					break
				}
			}
		} catch (err) {
			if (!signal.aborted) {
				log.error("SSE monitoring error", err)
				error = error
					? `${error}\nSSE error: ${err instanceof Error ? err.message : String(err)}`
					: `SSE error: ${err instanceof Error ? err.message : String(err)}`
			}
		}
		return "done"
	})()

	const outcome = await Promise.race([eventPromise, timeoutPromise])

	if (outcome === "timeout") {
		log.warn("Automation session timed out", { sessionId, timeoutMs })
		try {
			await client.session.abort({ sessionID: sessionId })
		} catch {
			// Best effort abort
		}
		error = error
			? `${error}\nSession timed out after ${Math.round(timeoutMs / 1000)}s`
			: `Session timed out after ${Math.round(timeoutMs / 1000)}s`
	}

	return { text: textParts.join("\n"), error }
}

/**
 * Parses the "Actionable: yes/no" line from the agent's output.
 * Defaults to true (require review) if not found.
 */
function parseActionable(text: string): boolean {
	const match = text.match(/Actionable:\s*(yes|no)/i)
	if (!match) return true
	return match[1].toLowerCase() === "yes"
}

// ============================================================
// Model resolution
// ============================================================

/**
 * Parses a model string in "providerID/modelID" format into the object
 * shape expected by the OpenCode SDK. Returns undefined if the string
 * is empty or malformed.
 */
function parseModelRef(modelStr: string): { providerID: string; modelID: string } | undefined {
	if (!modelStr) return undefined
	const slashIndex = modelStr.indexOf("/")
	if (slashIndex <= 0 || slashIndex === modelStr.length - 1) return undefined
	return {
		providerID: modelStr.slice(0, slashIndex),
		modelID: modelStr.slice(slashIndex + 1),
	}
}

// ============================================================
// Main executor
// ============================================================

/**
 * Callback fired as soon as the OpenCode session is created, before the
 * prompt is sent and monitoring begins. This allows the caller to persist
 * the sessionId immediately so the renderer can show the live session.
 */
export type OnSessionCreated = (info: {
	sessionId: string
	worktreePath: string | null
}) => void | Promise<void>

/**
 * Executes a single automation run against a workspace.
 *
 * @param config      The automation config (from disk)
 * @param workspace   The project directory to run against
 * @param onSessionCreated  Optional callback invoked as soon as the session
 *                          is created, before monitoring begins
 * @returns Execution result with session info, summary, and actionability
 */
export async function executeRun(
	config: AutomationConfig & { id: string; prompt: string },
	workspace: string,
	onSessionCreated?: OnSessionCreated,
): Promise<ExecutionResult> {
	const client = createAutomationClient(workspace)
	if (!client) {
		return {
			sessionId: "",
			worktreePath: null,
			title: config.name,
			summary: "",
			hasActionable: false,
			branch: null,
			error: "No OpenCode server running",
		}
	}

	const abortController = new AbortController()
	let worktreePath: string | null = null
	let sessionId = ""

	try {
		// --- Step 1: Create worktree (if enabled) ---
		if (config.execution.useWorktree) {
			log.info("Creating worktree for automation", {
				automationId: config.id,
				workspace,
			})
			try {
				const result = await client.worktree.create({
					worktreeCreateInput: {
						name: `automation-${config.id}-${Date.now()}`,
					},
				})
				// biome-ignore lint/suspicious/noExplicitAny: worktree API response shape not fully typed
				const data = result.data as any
				if (data?.directory) {
					worktreePath = data.directory
					log.info("Worktree created", {
						directory: worktreePath,
						branch: data.branch,
					})
				}
			} catch (err) {
				log.warn("Worktree creation failed, running in main workspace", err)
				// Continue without worktree -- run in the main workspace
			}
		}

		// --- Step 2: Create session with permission ruleset ---
		const permissionRuleset = buildPermissionRuleset(config.execution.permissionPreset ?? "default")

		// If running in a worktree, create a client scoped to that directory
		const sessionClient = worktreePath ? (createAutomationClient(worktreePath) ?? client) : client

		const sessionResult = await sessionClient.session.create({
			title: `[Auto] ${config.name}`,
			permission: permissionRuleset,
		})

		// biome-ignore lint/suspicious/noExplicitAny: session create response varies across SDK versions
		const session = sessionResult.data as any
		if (!session?.id) {
			return {
				sessionId: "",
				worktreePath,
				title: config.name,
				summary: "",
				hasActionable: false,
				branch: null,
				error: "Failed to create session: no session ID returned",
			}
		}

		sessionId = session.id
		log.info("Session created for automation", {
			sessionId,
			automationId: config.id,
			worktreePath,
		})

		// Notify caller immediately so sessionId can be persisted and the
		// renderer can start showing the live session view
		if (onSessionCreated) {
			try {
				await onSessionCreated({ sessionId, worktreePath })
			} catch (cbErr) {
				log.warn("onSessionCreated callback failed", cbErr)
			}
		}

		// --- Step 3: Send prompt ---
		const systemPrompt = buildSystemPrompt(config.id, config.name)

		// Parse model string (format: "providerID/modelID") if configured
		const model = config.execution.model ? parseModelRef(config.execution.model) : undefined

		await sessionClient.session.promptAsync({
			sessionID: sessionId,
			system: systemPrompt,
			parts: [{ type: "text", text: config.prompt }],
			model,
		})

		log.info("Prompt sent, monitoring session", { sessionId })

		// --- Step 4: Monitor until idle or timeout ---
		const { text, error } = await monitorSession(
			sessionClient,
			sessionId,
			config.execution.timeout * 1000,
			abortController.signal,
		)

		// --- Step 5: Capture results ---
		const hasActionable = error ? true : parseActionable(text)

		// Try to get session summary/diff info
		let branch: string | null = null
		try {
			const sessionInfo = await sessionClient.session.get({ sessionID: sessionId })
			// biome-ignore lint/suspicious/noExplicitAny: session response shape varies
			const info = sessionInfo.data as any
			if (info?.summary?.diffs?.length > 0) {
				// The branch is available from the worktree, not the session directly
				branch = worktreePath ? `automation/${config.id}` : null
			}
		} catch {
			// Non-critical, continue without summary
		}

		// Build a concise summary from the text output
		const summary = text
			? text.length > 2000
				? `${text.slice(0, 2000)}...`
				: text
			: error
				? `Error: ${error}`
				: "Automation completed with no output"

		return {
			sessionId,
			worktreePath,
			title: config.name,
			summary,
			hasActionable,
			branch,
			error,
		}
	} catch (err) {
		log.error("Automation execution failed", { automationId: config.id, workspace }, err)
		return {
			sessionId,
			worktreePath,
			title: config.name,
			summary: "",
			hasActionable: false,
			branch: null,
			error: err instanceof Error ? err.message : "Unknown execution error",
		}
	} finally {
		abortController.abort()
	}
}
