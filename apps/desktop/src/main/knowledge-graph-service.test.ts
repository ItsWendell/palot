import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { ProjectBrainService } from "./project-brain-service"
import { KnowledgeGraphService, tokenizeForBM25, scoreBM25 } from "./knowledge-graph-service"

async function makeService() {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "palot-kg-"))
	const brain = new ProjectBrainService(dir)
	const kg = new KnowledgeGraphService(brain)
	return { dir, kg, cleanup: () => fs.rm(dir, { recursive: true, force: true }) }
}

describe("KnowledgeGraphService", () => {
	test("add and get round-trip preserves all fields", async () => {
		const { kg, cleanup } = await makeService()
		try {
			const entry = await kg.add({
				type: "goal",
				title: "Ship v2.0",
				body: "Deliver the multi-agent overhaul by end of quarter.",
				tags: ["v2", "release"],
				relatedFiles: ["apps/desktop/src/main/ipc-handlers.ts"],
			})
			expect(entry.id).toBeTruthy()
			expect(entry.createdAt).toBeTruthy()

			const loaded = await kg.get(entry.id)
			expect(loaded?.title).toBe("Ship v2.0")
			expect(loaded?.tags).toContain("v2")
			expect(loaded?.relatedFiles[0]).toContain("ipc-handlers.ts")
		} finally {
			await cleanup()
		}
	})
	test("query by type returns only matching type", async () => {
		const { kg, cleanup } = await makeService()
		try {
			await kg.add({ type: "goal", title: "Goal A", body: "body", tags: [], relatedFiles: [] })
			await kg.add({ type: "decision", title: "Decision B", body: "body", tags: [], relatedFiles: [] })
			await kg.add({ type: "lesson", title: "Lesson C", body: "body", tags: [], relatedFiles: [] })

			const goals = await kg.query({ type: "goal" })
			expect(goals).toHaveLength(1)
			expect(goals[0].title).toBe("Goal A")
		} finally {
			await cleanup()
		}
	})

	test("query by keyword filters on title and body", async () => {
		const { kg, cleanup } = await makeService()
		try {
			await kg.add({ type: "lesson", title: "React performance", body: "Avoid inline objects in JSX", tags: [], relatedFiles: [] })
			await kg.add({ type: "lesson", title: "TypeScript tips", body: "Use satisfies for type safety", tags: [], relatedFiles: [] })

			const results = await kg.query({ keyword: "inline" })
			expect(results).toHaveLength(1)
			expect(results[0].title).toBe("React performance")
		} finally {
			await cleanup()
		}
	})

	test("query by relatedFile filters correctly", async () => {
		const { kg, cleanup } = await makeService()
		try {
			await kg.add({ type: "file-relationship", title: "IPC layer", body: "all handlers", tags: [], relatedFiles: ["ipc-handlers.ts"] })
			await kg.add({ type: "file-relationship", title: "Brain service", body: "notes", tags: [], relatedFiles: ["project-brain-service.ts"] })

			const results = await kg.query({ relatedFile: "ipc-handlers" })
			expect(results).toHaveLength(1)
			expect(results[0].title).toBe("IPC layer")
		} finally {
			await cleanup()
		}
	})

	test("remove deletes the entry", async () => {
		const { kg, cleanup } = await makeService()
		try {
			const entry = await kg.add({ type: "decision", title: "Use Bun", body: "for tests", tags: [], relatedFiles: [] })
			const removed = await kg.remove(entry.id)
			expect(removed).toBe(true)
			const loaded = await kg.get(entry.id)
			expect(loaded).toBeNull()
		} finally {
			await cleanup()
		}
	})

	test("getContext includes goals and decisions", async () => {
		const { kg, cleanup } = await makeService()
		try {
			await kg.add({ type: "goal", title: "Reliability", body: "Zero flaky tests", tags: [], relatedFiles: [] })
			await kg.add({ type: "decision", title: "Bun runtime", body: "Use Bun for test speed", tags: [], relatedFiles: [] })

			const ctx = await kg.getContext()
			expect(ctx).toContain("Reliability")
			expect(ctx).toContain("Bun runtime")
		} finally {
			await cleanup()
		}
	})

	test("getContext with prompt includes relevant lessons", async () => {
		const { kg, cleanup } = await makeService()
		try {
			await kg.add({ type: "lesson", title: "Atom family leak", body: "Always clean up atomFamily subscriptions", tags: [], relatedFiles: [] })
			await kg.add({ type: "lesson", title: "IPC timeout", body: "Add 5s timeout on all IPC calls", tags: [], relatedFiles: [] })

			const ctx = await kg.getContext("atom family subscription leak")
			expect(ctx).toContain("Atom family leak")
		} finally {
			await cleanup()
		}
	})

	test("BM25 keyword query ranks more relevant entry higher", async () => {
		const { kg, cleanup } = await makeService()
		try {
			await kg.add({
				type: "lesson",
				title: "Database connection pooling",
				body: "Always use connection pooling for database access to avoid exhausting connections",
				tags: ["database", "performance"],
				relatedFiles: [],
			})
			await kg.add({
				type: "lesson",
				title: "React memo patterns",
				body: "Use React.memo with named function expressions for performance-critical sub-components",
				tags: ["react", "performance"],
				relatedFiles: [],
			})
			await kg.add({
				type: "lesson",
				title: "Database migration safety",
				body: "Run database migrations in a transaction and always test rollback before deploying",
				tags: ["database", "safety"],
				relatedFiles: [],
			})

			const results = await kg.query({ keyword: "database connection pool" })
			expect(results.length).toBeGreaterThan(0)
			// The entry about "connection pooling" should rank first — it has all three terms
			expect(results[0].title).toBe("Database connection pooling")
		} finally {
			await cleanup()
		}
	})

	test("BM25 matches short keywords that were previously dropped", async () => {
		const { kg, cleanup } = await makeService()
		try {
			await kg.add({ type: "lesson", title: "IPC bug", body: "The IPC layer has a race condition", tags: ["ipc"], relatedFiles: [] })
			await kg.add({ type: "lesson", title: "CSS fix", body: "Tailwind v4 requires source directive", tags: ["css"], relatedFiles: [] })

			// "ipc" is only 3 chars — the old code dropped words with length <= 3
			const results = await kg.query({ keyword: "ipc" })
			expect(results).toHaveLength(1)
			expect(results[0].title).toBe("IPC bug")
		} finally {
			await cleanup()
		}
	})
})

// ============================================================
// BM25 helpers — unit tests
// ============================================================

describe("tokenizeForBM25", () => {
	test("lowercases and splits on non-alphanumeric", () => {
		const tokens = tokenizeForBM25("Hello World! foo-bar_baz")
		expect(tokens).toEqual(["hello", "world", "foo", "bar", "baz"])
	})

	test("filters empty tokens", () => {
		const tokens = tokenizeForBM25("  ...  ")
		expect(tokens).toEqual([])
	})

	test("keeps single-character tokens", () => {
		const tokens = tokenizeForBM25("A B C")
		expect(tokens).toEqual(["a", "b", "c"])
	})
})

describe("scoreBM25", () => {
	test("returns empty array for empty documents", () => {
		expect(scoreBM25(["test"], [])).toEqual([])
	})

	test("scores document with matching term higher than without", () => {
		const docs = [
			"the database connection pool is important",
			"react components use hooks for state management",
		]
		const scores = scoreBM25(["database", "connection"], docs)
		expect(scores[0].score).toBeGreaterThan(scores[1].score)
	})

	test("document with more matching terms scores higher", () => {
		const docs = [
			"database connection pool optimization for better performance",
			"database schema migration tool",
		]
		const scores = scoreBM25(["database", "connection", "pool"], docs)
		// First doc has all three terms, second has only one
		expect(scores[0].score).toBeGreaterThan(scores[1].score)
	})
})
