import { describe, expect, test } from "bun:test"
import { appStore } from "./store"
import { childSessionsFamily } from "./sub-agents"
import { getPendingPermissionLabel, getPendingQuestionHeader } from "./sub-agents"
import { upsertSessionAtom, setSessionErrorAtom } from "./sessions"

describe("sub-agent data guards", () => {
	test("handles incomplete child question data without throwing", () => {
		expect(getPendingQuestionHeader([{ id: "q-1" }])).toBe("Question")
		expect(getPendingQuestionHeader([{ questions: [] }])).toBe("Question")
		expect(getPendingQuestionHeader([{ questions: [{ header: "Pick an option" }] }])).toBe(
			"Pick an option",
		)
	})

	test("handles incomplete child permission data without throwing", () => {
		expect(getPendingPermissionLabel([{ id: "p-1" }])).toBe("approval")
		expect(getPendingPermissionLabel([{ permission: "edit" }])).toBe("edit")
		expect(getPendingPermissionLabel(null)).toBe("approval")
	})

	test("marks child sessions with SDK errors as failed", () => {
		appStore.set(upsertSessionAtom, {
			directory: "/tmp/project",
			session: {
				id: "parent-with-error-child",
				slug: "parent",
				projectID: "project",
				directory: "/tmp/project",
				title: "Lead",
				version: "1",
				time: { created: 1, updated: 1 },
			},
		})
		appStore.set(upsertSessionAtom, {
			directory: "/tmp/project",
			session: {
				id: "error-child",
				slug: "child",
				projectID: "project",
				directory: "/tmp/project",
				parentID: "parent-with-error-child",
				title: "Builder",
				version: "1",
				time: { created: 1, updated: 1 },
			},
		})
		appStore.set(setSessionErrorAtom, {
			sessionId: "error-child",
			error: { name: "ProviderAuthError", data: { message: "provider rejected request" } },
		})

		const children = appStore.get(childSessionsFamily("parent-with-error-child"))
		expect(children).toHaveLength(1)
		expect(children[0].agentStatus).toBe("failed")
		expect(children[0].errorMessage).toContain("provider rejected request")
	})
})
