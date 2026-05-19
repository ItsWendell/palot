import { describe, expect, test } from "bun:test"
import {
	analyzeSessionProgress,
	areMessagesSimilar,
	buildRecoveryPrompt,
	formatGoalState,
	hasSummaryPattern,
	hasTodoPlanningPattern,
	hasNextStepsPattern,
	hasWaitingOnSelfPattern,
	isPlanningOnlyTurn,
	NO_ACTION_THRESHOLD,
	PLANNING_LOOP_THRESHOLD,
	textSimilarity,
	TODO_SPAM_THRESHOLD,
	type TurnSummary,
} from "./session-watchdog"

// ============================================================
// Helpers
// ============================================================

function makeTurn(overrides: Partial<TurnSummary> & { text: string }): TurnSummary {
	return {
		hasToolUse: false,
		hasFileEdit: false,
		hasCommandRun: false,
		index: 0,
		...overrides,
	}
}

function planningTurn(text: string, index = 0): TurnSummary {
	return makeTurn({ text, index })
}

function actionTurn(index = 0): TurnSummary {
	return makeTurn({
		text: "Done.",
		hasToolUse: true,
		hasFileEdit: true,
		index,
	})
}

const TODO_TEXT = `
## Todo
- [ ] Step 1: set up the project
- [ ] Step 2: implement the feature
- [ ] Step 3: write tests
`

const NEXT_STEPS_TEXT = `
## Next Steps
First I'll set up the config. Then I'll implement the handler. After that I'll add tests.
`

const SUMMARY_TEXT = `
## Summary
To summarize: I've analyzed the problem and here is my plan for moving forward.
`

const WAITING_TEXT = `
I've outlined the approach. Shall I proceed with the implementation?
`

// ============================================================
// Pattern detection
// ============================================================

describe("hasTodoPlanningPattern", () => {
	test("detects markdown checkbox lists", () => {
		expect(hasTodoPlanningPattern("- [ ] step one\n- [ ] step two")).toBe(true)
	})

	test("detects '## Todo' headings", () => {
		expect(hasTodoPlanningPattern("## Todo\nsome items")).toBe(true)
	})

	test("detects 'Next Steps' heading", () => {
		expect(hasTodoPlanningPattern("### Next Steps\n- do something")).toBe(true)
	})

	test("does not false-positive on normal prose", () => {
		expect(hasTodoPlanningPattern("The function returns a value.")).toBe(false)
	})
})

describe("hasNextStepsPattern", () => {
	test("detects 'here is my plan'", () => {
		expect(hasNextStepsPattern("here's my plan: first I'll write the component")).toBe(true)
	})

	test("detects 'I'll now ...'", () => {
		expect(hasNextStepsPattern("I'll now implement the feature.")).toBe(true)
	})

	test("detects step numbering", () => {
		expect(hasNextStepsPattern("Step 1: create the file")).toBe(true)
	})

	test("does not match regular sentences", () => {
		expect(hasNextStepsPattern("The test passes and the build is clean.")).toBe(false)
	})
})

describe("hasSummaryPattern", () => {
	test("detects '## Summary' heading", () => {
		expect(hasSummaryPattern("## Summary\nsome text")).toBe(true)
	})

	test("detects 'to summarize' inline", () => {
		expect(hasSummaryPattern("To summarize, the component renders correctly.")).toBe(true)
	})

	test("does not match regular messages", () => {
		expect(hasSummaryPattern("The file has been written successfully.")).toBe(false)
	})
})

describe("hasWaitingOnSelfPattern", () => {
	test("detects 'shall I proceed'", () => {
		expect(hasWaitingOnSelfPattern("Shall I proceed with the implementation?")).toBe(true)
	})

	test("detects 'let me know if you're ready'", () => {
		expect(hasWaitingOnSelfPattern("Let me know when you're ready to continue.")).toBe(true)
	})

	test("detects 'waiting for confirmation'", () => {
		expect(hasWaitingOnSelfPattern("Waiting for your confirmation before proceeding.")).toBe(true)
	})

	test("does not match a confident execution message", () => {
		expect(hasWaitingOnSelfPattern("I've created the file at src/index.ts.")).toBe(false)
	})
})

describe("isPlanningOnlyTurn", () => {
	test("marks a TODO-only turn as planning", () => {
		expect(isPlanningOnlyTurn(planningTurn(TODO_TEXT))).toBe(true)
	})

	test("marks a next-steps-only turn as planning", () => {
		expect(isPlanningOnlyTurn(planningTurn(NEXT_STEPS_TEXT))).toBe(true)
	})

	test("does not mark a turn with tool use as planning", () => {
		const t = makeTurn({ text: TODO_TEXT, hasToolUse: true })
		expect(isPlanningOnlyTurn(t)).toBe(false)
	})

	test("does not mark a turn with file edits as planning", () => {
		const t = makeTurn({ text: "## Todo\n- [ ] done", hasFileEdit: true })
		expect(isPlanningOnlyTurn(t)).toBe(false)
	})
})

// ============================================================
// Text similarity
// ============================================================

describe("textSimilarity", () => {
	test("identical texts have similarity 1.0", () => {
		expect(textSimilarity("hello world", "hello world")).toBe(1)
	})

	test("completely different texts have low similarity", () => {
		const sim = textSimilarity("the quick brown fox", "zephyr quartz glyph")
		expect(sim).toBeLessThan(0.3)
	})

	test("empty strings return 0", () => {
		expect(textSimilarity("", "anything")).toBe(0)
		expect(textSimilarity("anything", "")).toBe(0)
	})
})

describe("areMessagesSimilar", () => {
	test("flags near-duplicate messages as similar", () => {
		const a = "## Summary\nI've analyzed the problem and here is my plan for moving forward."
		const b = "## Summary\nI've analyzed the problem and here is my plan for moving forward soon."
		expect(areMessagesSimilar(a, b)).toBe(true)
	})

	test("does not flag distinct messages as similar", () => {
		const a = "The file src/index.ts has been created with the component."
		const b = "Running the test suite to verify the implementation."
		expect(areMessagesSimilar(a, b)).toBe(false)
	})
})

// ============================================================
// analyzeSessionProgress — no stuck
// ============================================================

describe("analyzeSessionProgress - not stuck", () => {
	test("empty turn list returns not stuck", () => {
		const result = analyzeSessionProgress([])
		expect(result.isStuck).toBe(false)
	})

	test("single action turn is not stuck", () => {
		const result = analyzeSessionProgress([actionTurn(0)])
		expect(result.isStuck).toBe(false)
	})

	test("planning followed by action is not stuck", () => {
		const turns = [
			planningTurn(TODO_TEXT, 0),
			planningTurn(TODO_TEXT, 1),
			actionTurn(2),
		]
		const result = analyzeSessionProgress(turns)
		expect(result.isStuck).toBe(false)
	})

	test("one or two planning turns below threshold is not stuck", () => {
		const turns = [planningTurn(TODO_TEXT, 0), planningTurn(TODO_TEXT, 1)]
		const result = analyzeSessionProgress(turns)
		expect(result.isStuck).toBe(false)
	})
})

// ============================================================
// analyzeSessionProgress — agent does not emit repeated TODO lists
// ============================================================

describe("analyzeSessionProgress - repeated TODO detection", () => {
	test(`detects stuck after ${TODO_SPAM_THRESHOLD} consecutive TODO turns`, () => {
		const turns = Array.from({ length: TODO_SPAM_THRESHOLD }, (_, i) =>
			planningTurn(TODO_TEXT, i),
		)
		const result = analyzeSessionProgress(turns)
		expect(result.isStuck).toBe(true)
		expect(result.stuckReason).toBe("repeated-todo")
		expect(result.recoveryPrompt).toBeTruthy()
	})

	test("action turn resets the stuck counter", () => {
		const turns = [
			planningTurn(TODO_TEXT, 0),
			planningTurn(TODO_TEXT, 1),
			actionTurn(2), // ← resets
			planningTurn(TODO_TEXT, 3),
			planningTurn(TODO_TEXT, 4),
		]
		const result = analyzeSessionProgress(turns)
		expect(result.isStuck).toBe(false)
	})
})

// ============================================================
// analyzeSessionProgress — planning loop
// ============================================================

describe("analyzeSessionProgress - planning loop", () => {
	test(`detects stuck after ${PLANNING_LOOP_THRESHOLD} planning-only turns`, () => {
		const turns = Array.from({ length: PLANNING_LOOP_THRESHOLD }, (_, i) =>
			planningTurn(NEXT_STEPS_TEXT, i),
		)
		const result = analyzeSessionProgress(turns)
		expect(result.isStuck).toBe(true)
		expect(result.recoveryPrompt).toBeTruthy()
	})

	test("agent makes progress after planning (not stuck)", () => {
		const turns = [
			planningTurn(NEXT_STEPS_TEXT, 0),
			planningTurn(NEXT_STEPS_TEXT, 1),
			planningTurn(NEXT_STEPS_TEXT, 2),
			actionTurn(3),
		]
		const result = analyzeSessionProgress(turns)
		expect(result.isStuck).toBe(false)
	})
})

// ============================================================
// analyzeSessionProgress — no file changes
// ============================================================

describe("analyzeSessionProgress - no file changes", () => {
	test(`detects stuck after ${NO_ACTION_THRESHOLD} turns with no file/command output`, () => {
		const turns = Array.from({ length: NO_ACTION_THRESHOLD }, (_, i) =>
			makeTurn({ text: "Some analysis text.", hasToolUse: false, index: i }),
		)
		const result = analyzeSessionProgress(turns)
		expect(result.isStuck).toBe(true)
		expect(result.stuckReason).toBe("no-file-changes")
	})
})

// ============================================================
// analyzeSessionProgress — agent waiting on itself
// ============================================================

describe("analyzeSessionProgress - agent waiting on itself", () => {
	test("detects 'shall I proceed' as stuck", () => {
		const turns = [actionTurn(0), planningTurn(WAITING_TEXT, 1)]
		const result = analyzeSessionProgress(turns)
		expect(result.isStuck).toBe(true)
		expect(result.stuckReason).toBe("agent-waiting-on-self")
	})
})

// ============================================================
// analyzeSessionProgress — repeated summaries
// ============================================================

describe("analyzeSessionProgress - repeated summaries", () => {
	test("detects near-identical consecutive summaries as stuck", () => {
		const turns = [
			actionTurn(0),
			planningTurn(SUMMARY_TEXT, 1),
			planningTurn(SUMMARY_TEXT + " Additionally.", 2),
		]
		const result = analyzeSessionProgress(turns)
		expect(result.isStuck).toBe(true)
		expect(result.stuckReason).toBe("repeated-summary")
	})
})

// ============================================================
// analyzeSessionProgress — real blocker stops execution properly
// ============================================================

describe("analyzeSessionProgress - stops after real blocker", () => {
	test("a non-repeating message with no planning patterns is not stuck", () => {
		const turns = [
			actionTurn(0),
			actionTurn(1),
			makeTurn({
				text: "Error: Cannot find module 'react'. Make sure react is installed.",
				index: 2,
			}),
		]
		const result = analyzeSessionProgress(turns)
		expect(result.isStuck).toBe(false)
	})
})

// ============================================================
// analyzeSessionProgress — long running session preserves goal state
// ============================================================

describe("analyzeSessionProgress - long session window", () => {
	test("correctly tracks lastActionableTurnIndex over many turns", () => {
		const turns = [
			actionTurn(0),
			actionTurn(1),
			planningTurn(TODO_TEXT, 2),
			planningTurn(TODO_TEXT, 3),
		]
		const result = analyzeSessionProgress(turns)
		expect(result.lastActionableTurnIndex).toBe(1)
	})

	test("handles 20-turn session without false positives when action occurs regularly", () => {
		const turns: TurnSummary[] = []
		for (let i = 0; i < 20; i++) {
			// Every 4th turn is actionable
			turns.push(i % 4 === 3 ? actionTurn(i) : planningTurn(NEXT_STEPS_TEXT, i))
		}
		const result = analyzeSessionProgress(turns)
		// Last 4 turns: plan, plan, plan, action — action resets counter
		// Actually let me think: turns 16=plan, 17=plan, 18=plan, 19=action
		// Last turn is action so consecutive planning = 0
		expect(result.isStuck).toBe(false)
	})
})

// ============================================================
// Recovery prompts
// ============================================================

describe("buildRecoveryPrompt", () => {
	test("returns a non-empty string for every StuckReason", () => {
		const reasons = [
			"repeated-todo",
			"repeated-next-steps",
			"repeated-summary",
			"no-file-changes",
			"planning-loop",
			"agent-waiting-on-self",
		] as const
		for (const reason of reasons) {
			const prompt = buildRecoveryPrompt(reason)
			expect(typeof prompt).toBe("string")
			expect(prompt.length).toBeGreaterThan(20)
		}
	})

	test("repeated-todo prompt tells agent to stop planning", () => {
		const prompt = buildRecoveryPrompt("repeated-todo")
		expect(prompt.toLowerCase()).toContain("stop")
	})

	test("agent-waiting-on-self prompt tells agent to decide and proceed", () => {
		const prompt = buildRecoveryPrompt("agent-waiting-on-self")
		expect(prompt.toLowerCase()).toMatch(/proceed|decision|decide/)
	})
})

// ============================================================
// Goal state tracker
// ============================================================

describe("formatGoalState", () => {
	test("includes original goal", () => {
		const formatted = formatGoalState({
			originalGoal: "Build a login page",
			currentMilestone: "Auth form",
			completedActions: ["Created component"],
			remainingActions: ["Add validation"],
			blockers: [],
		})
		expect(formatted).toContain("Build a login page")
		expect(formatted).toContain("Auth form")
		expect(formatted).toContain("Created component")
		expect(formatted).toContain("Add validation")
	})

	test("omits empty sections", () => {
		const formatted = formatGoalState({
			originalGoal: "Fix bug",
			currentMilestone: null,
			completedActions: [],
			remainingActions: [],
			blockers: [],
		})
		expect(formatted).not.toContain("Completed")
		expect(formatted).not.toContain("Remaining")
		expect(formatted).not.toContain("Blockers")
	})
})
