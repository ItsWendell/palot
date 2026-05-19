import { useMemo } from "react"
import {
	analyzeSessionProgress,
	type TurnSummary,
	type WatchdogAnalysis,
} from "../lib/session-watchdog"
import type { ChatTurn } from "./use-session-chat"

const WINDOW_SIZE = 10

export const FILE_EDIT_TOOLS = new Set(["edit", "write", "apply_patch", "patch", "multiedit"])
export const COMMAND_TOOLS = new Set(["bash"])

const NOT_STUCK: WatchdogAnalysis = {
	isStuck: false,
	stuckReason: null,
	consecutivePlanningTurns: 0,
	lastActionableTurnIndex: null,
	recoveryPrompt: null,
}

/**
 * Converts the last WINDOW_SIZE ChatTurns into TurnSummary objects for the watchdog.
 * Pure function — exported for testing.
 */
export function summarizeTurns(turns: ChatTurn[]): TurnSummary[] {
	return turns.slice(-WINDOW_SIZE).map((turn, i) => {
		let text = ""
		let hasToolUse = false
		let hasFileEdit = false
		let hasCommandRun = false

		for (const msg of turn.assistantMessages) {
			for (const part of msg.parts) {
				if (part.type === "text" || part.type === "reasoning") {
					text += part.text + "\n"
				} else if (part.type === "tool") {
					hasToolUse = true
					if (FILE_EDIT_TOOLS.has(part.tool)) hasFileEdit = true
					if (COMMAND_TOOLS.has(part.tool)) hasCommandRun = true
				}
			}
		}

		return { text: text.trim(), hasToolUse, hasFileEdit, hasCommandRun, index: i }
	})
}

export function useSessionWatchdog(turns: ChatTurn[], isWorking: boolean): WatchdogAnalysis {
	return useMemo(() => {
		if (!isWorking || turns.length === 0) return NOT_STUCK
		return analyzeSessionProgress(summarizeTurns(turns))
	}, [turns, isWorking])
}
