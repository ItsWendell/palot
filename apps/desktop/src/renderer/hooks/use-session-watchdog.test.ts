import { describe, expect, test } from "bun:test"
import { summarizeTurns, FILE_EDIT_TOOLS, COMMAND_TOOLS } from "./use-session-watchdog"
import type { ChatTurn } from "./use-session-chat"

// ============================================================
// Helpers
// ============================================================

function makeTurn(parts: Array<{ type: string; text?: string; tool?: string }>): ChatTurn {
	return {
		id: `turn-${Math.random()}`,
		userMessage: {
			info: { id: "user-1", sessionID: "s1", role: "user", time: {} } as never,
			parts: [],
		},
		assistantMessages: [
			{
				info: { id: "asst-1", sessionID: "s1", role: "assistant", time: {} } as never,
				parts: parts.map((p, i) => ({ id: `part-${i}`, messageID: "asst-1", ...p }) as never),
			},
		],
	}
}

function textTurn(text: string): ChatTurn {
	return makeTurn([{ type: "text", text }])
}

function toolTurn(toolName: string): ChatTurn {
	return makeTurn([{ type: "tool", tool: toolName }])
}

function mixedTurn(text: string, toolName: string): ChatTurn {
	return makeTurn([
		{ type: "text", text },
		{ type: "tool", tool: toolName },
	])
}

// ============================================================
// summarizeTurns — part classification
// ============================================================

describe("summarizeTurns", () => {
	test("extracts text from text parts", () => {
		const summaries = summarizeTurns([textTurn("Hello world")])
		expect(summaries).toHaveLength(1)
		expect(summaries[0].text).toBe("Hello world")
		expect(summaries[0].hasToolUse).toBe(false)
		expect(summaries[0].hasFileEdit).toBe(false)
		expect(summaries[0].hasCommandRun).toBe(false)
	})

	test("sets hasToolUse for any tool part", () => {
		const summaries = summarizeTurns([toolTurn("read")])
		expect(summaries[0].hasToolUse).toBe(true)
		expect(summaries[0].hasFileEdit).toBe(false)
		expect(summaries[0].hasCommandRun).toBe(false)
	})

	test("sets hasFileEdit for file edit tools", () => {
		for (const tool of FILE_EDIT_TOOLS) {
			const summaries = summarizeTurns([toolTurn(tool)])
			expect(summaries[0].hasFileEdit).toBe(true)
		}
	})

	test("sets hasCommandRun for bash tool", () => {
		for (const tool of COMMAND_TOOLS) {
			const summaries = summarizeTurns([toolTurn(tool)])
			expect(summaries[0].hasCommandRun).toBe(true)
		}
	})

	test("handles mixed text + tool parts in one turn", () => {
		const summaries = summarizeTurns([mixedTurn("Here is my plan", "write")])
		expect(summaries[0].text).toBe("Here is my plan")
		expect(summaries[0].hasToolUse).toBe(true)
		expect(summaries[0].hasFileEdit).toBe(true)
	})

	test("extracts text from reasoning parts", () => {
		const turn = makeTurn([{ type: "reasoning", text: "thinking..." }])
		const summaries = summarizeTurns([turn])
		expect(summaries[0].text).toBe("thinking...")
	})

	test("assigns sequential indices", () => {
		const turns = [textTurn("a"), textTurn("b"), textTurn("c")]
		const summaries = summarizeTurns(turns)
		expect(summaries.map((s) => s.index)).toEqual([0, 1, 2])
	})

	test("returns empty array for empty input", () => {
		expect(summarizeTurns([])).toHaveLength(0)
	})

	test("trims to last 10 turns (WINDOW_SIZE)", () => {
		const turns = Array.from({ length: 15 }, (_, i) => textTurn(`Turn ${i}`))
		const summaries = summarizeTurns(turns)
		expect(summaries).toHaveLength(10)
		expect(summaries[0].text).toBe("Turn 5")
		expect(summaries[9].text).toBe("Turn 14")
	})

	test("concatenates text from multiple assistant messages in one turn", () => {
		const turn: ChatTurn = {
			id: "multi",
			userMessage: {
				info: { id: "u1", sessionID: "s1", role: "user", time: {} } as never,
				parts: [],
			},
			assistantMessages: [
				{
					info: { id: "a1", sessionID: "s1", role: "assistant", time: {} } as never,
					parts: [{ id: "p1", messageID: "a1", type: "text", text: "First part." } as never],
				},
				{
					info: { id: "a2", sessionID: "s1", role: "assistant", time: {} } as never,
					parts: [{ id: "p2", messageID: "a2", type: "text", text: "Second part." } as never],
				},
			],
		}
		const summaries = summarizeTurns([turn])
		expect(summaries[0].text).toContain("First part.")
		expect(summaries[0].text).toContain("Second part.")
	})
})
