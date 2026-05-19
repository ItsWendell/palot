import { useCallback } from "react"
import type { ModelRef } from "../../hooks/use-opencode-data"
import { createLogger } from "../../lib/logger"
import type { Agent } from "../../lib/types"
import { getProjectClient } from "../../services/connection-manager"
import { isCandidateForSkillResolution, parseSlashCommand } from "./slash-commands"
import { resolveSkillCommand, SkillExecutionError } from "./skill-execution-pipeline"
import type { SkillLoader } from "./skill-execution-pipeline"
import { orchestrateResearch, parseResearchQuestions } from "../../lib/research-orchestrator"

const log = createLogger("slash-command-handler")

function defaultSkillLoader(): SkillLoader {
	return () => {
		if (typeof window === "undefined" || !("palot" in window)) {
			return Promise.resolve([])
		}
		return window.palot.skills.listAll()
	}
}

export function useSlashCommandHandler({
	agent,
	effectiveModel,
	onUndo,
	onRedo,
	skillLoader,
}: {
	agent: Agent
	effectiveModel: ModelRef | null
	onUndo?: () => Promise<string | undefined>
	onRedo?: () => Promise<void>
	/**
	 * Injectable skill loader for testing.
	 * Defaults to window.palot.skills.listAll() in production.
	 */
	skillLoader?: SkillLoader
}) {
	const loadSkills = skillLoader ?? defaultSkillLoader()

	return useCallback(
		/**
		 * Handle a slash command from the chat input.
		 *
		 * Returns:
		 *   true   — command was fully handled (undo/redo/compact). Caller should clear input.
		 *   string — skill was resolved; the string is the full prompt to send as a message.
		 *   false  — not a recognized command; caller should send raw text or surface an error.
		 */
		async (text: string): Promise<boolean | string> => {
			const command = parseSlashCommand(text)
			if (!command) return false

			log.info("[slash-cmd] parsed", { name: command.name, hasArgs: command.arguments.length > 0 })

			// ── Built-in client commands ─────────────────────────────────────────
			switch (command.name.toLowerCase()) {
				case "undo":
					log.info("[slash-cmd] executing built-in: undo")
					if (onUndo) await onUndo()
					return true

				case "redo":
					log.info("[slash-cmd] executing built-in: redo")
					if (onRedo) await onRedo()
					return true

				case "compact":
				case "summarize":
					log.info("[slash-cmd] executing built-in: compact/summarize")
					if (agent.directory && effectiveModel) {
						const client = getProjectClient(agent.directory)
						if (client) {
							try {
								await client.session.summarize({
									sessionID: agent.sessionId,
									providerID: effectiveModel.providerID,
									modelID: effectiveModel.modelID,
								})
								log.info("[slash-cmd] compact completed", { sessionId: agent.sessionId })
							} catch (err) {
								log.error("[slash-cmd] compact failed", { sessionId: agent.sessionId }, err)
							}
						}
					}
					return true

				case "research": {
					log.info("[slash-cmd] executing built-in: research")
					const questions = parseResearchQuestions(command.arguments)
					if (questions.length === 0) {
						return "Usage: /research <question1>; <question2>; ... — provide one or more questions separated by semicolons."
					}
					if (!agent.directory) {
						return "Cannot run research: no project directory is set."
					}
					try {
						const result = await orchestrateResearch({
							questions,
							projectDir: agent.directory,
						})
						if (result.mergedSummary) {
							return result.mergedSummary
						}
						return `Research completed but no results were returned. ${result.timedOut} timed out, ${result.errored} errored.`
					} catch (err) {
						log.error("[slash-cmd] research orchestration failed", err)
						return `Research failed: ${err instanceof Error ? err.message : String(err)}`
					}
				}

				default:
					break
			}

			// ── Skill resolution ────────────────────────────────────────────────
			if (isCandidateForSkillResolution(command.name)) {
				log.info("[slash-cmd] checking skill registry", { commandName: command.name })
				try {
					const resolved = await resolveSkillCommand(
						command.name,
						command.arguments,
						loadSkills,
						log,
					)

					if (resolved) {
						log.info("[slash-cmd] skill resolved, injecting into agent context", {
							skillFilename: resolved.skill.filename,
							sessionId: agent.sessionId,
						})
						return resolved.prompt
					}
					// No skill matched — fall through to server command attempt
				} catch (err) {
					if (err instanceof SkillExecutionError) {
						log.error("[slash-cmd] skill execution blocked", {
							commandName: command.name,
							code: err.code,
							reason: err.message,
						})
						// Blocked skill: return a user-visible error message as the prompt
						// so the agent can inform the user rather than silently failing.
						return `The skill "/${command.name}" could not be executed: ${err.message}`
					}
					log.error("[slash-cmd] unexpected error during skill resolution", err)
				}
			}

			// ── Server-side commands (e.g. /init, /review, MCP commands) ────────
			if (agent.directory) {
				const client = getProjectClient(agent.directory)
				if (client) {
					log.info("[slash-cmd] forwarding to server command", {
						commandName: command.name,
						sessionId: agent.sessionId,
					})
					try {
						await client.session.command({
							sessionID: agent.sessionId,
							command: command.name,
							arguments: command.arguments,
						})
						log.info("[slash-cmd] server command completed", { commandName: command.name })
						return true
					} catch (err) {
						log.warn("[slash-cmd] server command not recognized or failed", {
							commandName: command.name,
							error: String(err),
						})
					}
				}
			}

			log.info("[slash-cmd] command unresolved", { commandName: command.name })
			return false
		},
		[agent, effectiveModel, onUndo, onRedo, loadSkills],
	)
}
