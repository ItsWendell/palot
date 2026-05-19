/**
 * Research fan-out orchestrator.
 *
 * Spawns N read-only research agents concurrently via the OpenCode SDK,
 * tracks their completion, and merges findings into a supervisor summary.
 *
 * This is the runtime counterpart to the utilities in `research-agent.ts`.
 */

import { getProjectClient } from "../services/connection-manager"
import {
	makeResearchPrompt,
	mergeResearchOutputs,
	type ResearchResult,
	type ResearchTask,
} from "./research-agent"
import { createLogger } from "./logger"

const log = createLogger("research-orchestrator")

// ============================================================
// Types
// ============================================================

export interface ResearchOrchestrationInput {
	/** One or more research questions to investigate concurrently */
	questions: string[]
	/** Project directory for the OpenCode client */
	projectDir: string
	/** Optional shared context prepended to each research prompt */
	context?: string
	/** Optional files to focus on (shared across all agents) */
	files?: string[]
	/** Per-agent timeout in milliseconds (default: 120_000) */
	timeoutMs?: number
	/** Max concurrent agents (default: 4) */
	maxConcurrent?: number
}

export interface ResearchOrchestrationResult {
	/** Individual results from each research agent */
	results: ResearchResult[]
	/** Merged summary suitable for injecting into the lead agent's context */
	mergedSummary: string
	/** Number of agents that timed out */
	timedOut: number
	/** Number of agents that errored */
	errored: number
}

// ============================================================
// Orchestrator
// ============================================================

/**
 * Fan out N research questions to parallel read-only agents, wait for
 * completion (with timeout), and merge the results.
 *
 * Returns the merged summary and individual results.
 */
export async function orchestrateResearch(
	input: ResearchOrchestrationInput,
): Promise<ResearchOrchestrationResult> {
	const {
		questions,
		projectDir,
		context,
		files,
		timeoutMs = 120_000,
		maxConcurrent = 4,
	} = input

	if (questions.length === 0) {
		return { results: [], mergedSummary: "", timedOut: 0, errored: 0 }
	}

	const client = getProjectClient(projectDir)
	if (!client) {
		throw new Error(`No OpenCode client available for project: ${projectDir}`)
	}

	log.info("starting research fan-out", {
		questionCount: questions.length,
		maxConcurrent,
		timeoutMs,
	})

	const tasks: ResearchTask[] = questions.map((question) => ({
		question,
		context,
		files,
	}))

	// Process in batches of maxConcurrent
	const allResults: (ResearchResult | { error: true; question: string; timedOut: boolean })[] = []

	for (let i = 0; i < tasks.length; i += maxConcurrent) {
		const batch = tasks.slice(i, i + maxConcurrent)
		const batchResults = await Promise.allSettled(
			batch.map((task) => spawnResearchAgent(client, task, timeoutMs)),
		)

		for (let j = 0; j < batchResults.length; j++) {
			const result = batchResults[j]
			if (result.status === "fulfilled") {
				allResults.push(result.value)
			} else {
				const isTimeout =
					result.reason instanceof Error &&
					result.reason.message.includes("timed out")
				log.error("research agent failed", {
					question: batch[j].question,
					error: String(result.reason),
					isTimeout,
				})
				allResults.push({
					error: true,
					question: batch[j].question,
					timedOut: isTimeout,
				})
			}
		}
	}

	const successResults: ResearchResult[] = allResults.filter(
		(r): r is ResearchResult => !("error" in r),
	)
	const timedOut = allResults.filter(
		(r): r is { error: true; question: string; timedOut: boolean } =>
			"error" in r && r.timedOut,
	).length
	const errored = allResults.filter(
		(r): r is { error: true; question: string; timedOut: boolean } =>
			"error" in r && !r.timedOut,
	).length

	const mergedSummary = mergeResearchOutputs(successResults)

	log.info("research fan-out complete", {
		total: questions.length,
		succeeded: successResults.length,
		timedOut,
		errored,
	})

	return { results: successResults, mergedSummary, timedOut, errored }
}

// ============================================================
// Single agent spawner
// ============================================================

async function spawnResearchAgent(
	client: ReturnType<typeof getProjectClient>,
	task: ResearchTask,
	timeoutMs: number,
): Promise<ResearchResult> {
	if (!client) throw new Error("No OpenCode client")

	const prompt = makeResearchPrompt(task)

	// Create a new session for this research agent
	const sessionResult = await client.session.create({})
	if (sessionResult.error || !sessionResult.data) {
		throw new Error(`Failed to create research session: ${String(sessionResult.error)}`)
	}
	const session = sessionResult.data
	const sessionId = session.id

	log.info("spawned research agent", {
		sessionId,
		question: task.question.slice(0, 80),
	})

	// Send the research prompt
	await client.session.promptAsync({
		sessionID: sessionId,
		parts: [{ type: "text", text: prompt }],
	})

	// Poll for completion with timeout
	const startTime = Date.now()
	let answer = ""

	while (Date.now() - startTime < timeoutMs) {
		await sleep(2000)

		try {
			const messagesResult = await client.session.messages({
				sessionID: sessionId,
			})
			const messages = messagesResult.data ?? []

			// Find the last assistant message
			const assistantMsgs = messages.filter(
				(m) => m.info.role === "assistant",
			)
			if (assistantMsgs.length === 0) continue

			const lastMsg = assistantMsgs[assistantMsgs.length - 1]

			// Check if the session is idle (agent finished)
			const statusResult = await client.session.status()
			const status = statusResult.data?.[sessionId]
			const isIdle = status?.type === "idle" || status === undefined

			if (isIdle && lastMsg.parts) {
				answer = lastMsg.parts
					.filter((p) => p.type === "text")
					.map((p) => p.text)
					.join("\n")
					.trim()

				if (answer.length > 0) {
					log.info("research agent completed", {
						sessionId,
						answerLength: answer.length,
					})
					break
				}
			}
		} catch (err) {
			log.warn("poll error for research agent", { sessionId, error: String(err) })
		}
	}

	if (answer.length === 0) {
		throw new Error(
			`Research agent ${sessionId} timed out after ${timeoutMs}ms for question: ${task.question.slice(0, 80)}`,
		)
	}

	return {
		sessionId,
		question: task.question,
		answer,
		completedAt: new Date().toISOString(),
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

// ============================================================
// Question parser (for slash command arguments)
// ============================================================

/**
 * Parses a `/research` argument string into individual questions.
 *
 * Supports:
 * - Comma-separated: "Where is auth?, How does routing work?"
 * - Semicolon-separated: "Where is auth?; How does routing work?"
 * - Newline-separated
 * - Single question (no delimiter)
 */
export function parseResearchQuestions(args: string): string[] {
	if (!args.trim()) return []

	// Try semicolons first (most explicit)
	if (args.includes(";")) {
		return args
			.split(";")
			.map((q) => q.trim())
			.filter(Boolean)
	}

	// Try commas (but only if there are question marks — avoids splitting "find X, Y, Z")
	if (args.includes(",") && args.includes("?")) {
		return args
			.split(",")
			.map((q) => q.trim())
			.filter(Boolean)
	}

	// Try newlines
	if (args.includes("\n")) {
		return args
			.split("\n")
			.map((q) => q.trim())
			.filter(Boolean)
	}

	// Single question
	return [args.trim()]
}
