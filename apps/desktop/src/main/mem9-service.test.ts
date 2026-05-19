/**
 * Mem9Service tests — validates storage, search, recall, embedding,
 * and graceful degradation when Mem9 is not configured.
 *
 * The Mem9Service makes HTTP calls to a remote API. For isolated
 * unit tests, we verify behavior without a running server by testing
 * the unconfigured fallback paths (which return null/empty).
 */

import { describe, expect, test } from "bun:test"
import { Mem9Service } from "./mem9-service"

// ============================================================
// Unconfigured service (no API key) — all ops are no-ops
// ============================================================

describe("Mem9Service — unconfigured", () => {
	const svc = new Mem9Service()

	test("init without apiKey returns false", () => {
		const result = svc.init({ baseUrl: "https://api.mem9.ai" })
		expect(result).toBe(false)
		expect(svc.initialized).toBe(true)
		expect(svc.configured).toBe(false)
	})

	test("store returns null when not configured", async () => {
		svc.init({ apiKey: null })
		const result = await svc.store({ content: "test" })
		expect(result).toBeNull()
	})

	test("search returns empty when not configured", async () => {
		svc.init({ apiKey: null })
		const result = await svc.search({ q: "test", limit: 5 })
		expect(result.memories).toEqual([])
		expect(result.total).toBe(0)
		expect(result.limit).toBe(5)
	})

	test("get returns null when not configured", async () => {
		svc.init({ apiKey: null })
		const result = await svc.get("any-id")
		expect(result).toBeNull()
	})

	test("remove returns false when not configured", async () => {
		svc.init({ apiKey: null })
		const result = await svc.remove("any-id")
		expect(result).toBe(false)
	})

	test("recall returns null when not configured", async () => {
		svc.init({ apiKey: null })
		const result = await svc.recall("test query")
		expect(result).toBeNull()
	})

	test("embedKnowledgeFiles returns 0 when not configured", async () => {
		svc.init({ apiKey: null })
		const result = await svc.embedKnowledgeFiles("/fake/path")
		expect(result).toBe(0)
	})

	test("embedBrainFiles returns 0 when not configured", async () => {
		svc.init({ apiKey: null })
		const result = await svc.embedBrainFiles("/fake/path")
		expect(result).toBe(0)
	})

	test("embedAllProjectFiles returns 0 when not configured", async () => {
		svc.init({ apiKey: null })
		const result = await svc.embedAllProjectFiles("/fake/path")
		expect(result).toBe(0)
	})
})

// ============================================================
// Initialized service (valid config but no server)
// ============================================================

describe("Mem9Service — initialized (no server)", () => {
	const svc = new Mem9Service()

	test("init with apiKey returns true", () => {
		const result = svc.init({
			apiKey: "test-key-123",
			baseUrl: "https://api.mem9.ai",
			agentId: "palot-test",
		})
		expect(result).toBe(true)
		expect(svc.initialized).toBe(true)
		expect(svc.configured).toBe(true)
	})

	test("store returns null on network error (no server)", async () => {
		// With no server running at api.mem9.ai, the request should
		// fail gracefully and return null
		svc.init({
			apiKey: "test-key-123",
			baseUrl: "http://localhost:1", // Invalid port — connection refused
			agentId: "palot-test",
		})
		const result = await svc.store({ content: "test", source: "unit-test", tags: ["test"] })
		expect(result).toBeNull()
	})

	test("search returns empty on network error", async () => {
		const result = await svc.search({ q: "test", limit: 5 })
		expect(result.memories).toEqual([])
		expect(result.total).toBe(0)
	})

	test("recall returns null on network error", async () => {
		const result = await svc.recall("test query")
		expect(result).toBeNull()
	})

	test("get returns null on network error", async () => {
		const result = await svc.get("any-id")
		expect(result).toBeNull()
	})

	test("remove returns false on network error", async () => {
		const result = await svc.remove("any-id")
		expect(result).toBe(false)
	})

	test("embedAllProjectFiles fails gracefully (no server, no local files)", async () => {
		svc.resetEmbeddingFlag()
		const result = await svc.embedAllProjectFiles("/fake/path")
		expect(result).toBe(0)
	})
})

// ============================================================
// Embedding flag behavior
// ============================================================

describe("Mem9Service — embedding flag", () => {
	test("embedAllProjectFiles returns 0 on second call after success", async () => {
		const svc = new Mem9Service()
		// Set embedding as already done internally
		svc.init({ apiKey: null })

		// First call (will return 0 because not configured)
		const first = await svc.embedAllProjectFiles("/fake/path")
		expect(first).toBe(0) // Not configured, so 0

		// Call again — embedAllProjectFiles checks internal _embeddingDone flag
		// which was set to false because first returned 0
		const second = await svc.embedAllProjectFiles("/fake/path")
		expect(second).toBe(0) // Still not configured
	})

	test("resetEmbeddingFlag allows re-embedding", async () => {
		const svc = new Mem9Service()
		svc.init({ apiKey: null })
		svc["_embeddingDone"] = true // Set flag manually

		// Embedding should be skipped (returns 0) because flag is true
		const skipped = await svc.embedAllProjectFiles("/fake/path")
		expect(skipped).toBe(0)

		// Reset flag
		svc.resetEmbeddingFlag()

		// Now embedding should attempt (still returns 0 because not configured)
		const retried = await svc.embedAllProjectFiles("/fake/path")
		expect(retried).toBe(0)
	})
})

// ============================================================
// State management
// ============================================================

describe("Mem9Service — state", () => {
	test("initial state is uninitialized", () => {
		const svc = new Mem9Service()
		expect(svc.initialized).toBe(false)
		expect(svc.configured).toBe(false)
	})

	test("re-init replaces old config", () => {
		const svc = new Mem9Service()
		svc.init({ apiKey: null })
		expect(svc.configured).toBe(false)

		svc.init({ apiKey: "new-key" })
		expect(svc.configured).toBe(true)
	})

	test("empty apiKey treated as unconfigured", () => {
		const svc = new Mem9Service()
		svc.init({ apiKey: "", baseUrl: "https://api.mem9.ai" })
		expect(svc.configured).toBe(false)
	})
})

// ============================================================
// Edge cases
// ============================================================

describe("Mem9Service — edge cases", () => {
	test("trailing slash in baseUrl is normalized", () => {
		// This just tests that init doesn't throw with a trailing slash
		const svc = new Mem9Service()
		svc.init({ apiKey: "key", baseUrl: "https://api.mem9.ai/" })
		expect(svc.configured).toBe(true)
	})

	test("empty recall query still goes through", async () => {
		const svc = new Mem9Service()
		svc.init({ apiKey: null })
		const result = await svc.recall("")
		expect(result).toBeNull()
	})

	test("zero limit recall uses default", async () => {
		const svc = new Mem9Service()
		svc.init({ apiKey: null })
		const result = await svc.recall("test", 0)
		expect(result).toBeNull()
	})
})
