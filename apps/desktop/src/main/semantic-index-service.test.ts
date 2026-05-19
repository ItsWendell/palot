import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { ProjectBrainService } from "./project-brain-service"
import { SemanticIndexService, tokenize } from "./semantic-index-service"

async function makeService() {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "palot-semantic-"))
	const brain = new ProjectBrainService(dir)
	const svc = new SemanticIndexService(brain)
	return { dir, svc, cleanup: () => fs.rm(dir, { recursive: true, force: true }) }
}

async function writeFile(root: string, rel: string, content: string) {
	const full = path.join(root, rel)
	await fs.mkdir(path.dirname(full), { recursive: true })
	await fs.writeFile(full, content, "utf-8")
}

// ============================================================
// tokenize
// ============================================================

describe("tokenize", () => {
	test("splits camelCase into separate tokens", () => {
		const tokens = tokenize("fetchUserData")
		expect(tokens).toContain("fetch")
		expect(tokens).toContain("user")
		expect(tokens).toContain("data")
	})

	test("splits snake_case into separate tokens", () => {
		const tokens = tokenize("get_user_profile")
		expect(tokens).toContain("user")
		expect(tokens).toContain("profile")
	})

	test("splits kebab-case path into separate tokens", () => {
		const tokens = tokenize("src/components/user-profile.tsx")
		expect(tokens).toContain("src")
		expect(tokens).toContain("components")
		expect(tokens).toContain("user")
		expect(tokens).toContain("profile")
		expect(tokens).toContain("tsx")
	})

	test("filters out stop words and short tokens", () => {
		const tokens = tokenize("the function is a return of the value")
		// "the", "is", "a", "of" are stop words; "function" and "return" are code stop words
		expect(tokens).not.toContain("the")
		expect(tokens).not.toContain("is")
		expect(tokens).not.toContain("function")
		expect(tokens).not.toContain("return")
		expect(tokens).toContain("value")
	})

	test("lowercases all tokens", () => {
		const tokens = tokenize("FetchUserData")
		for (const t of tokens) {
			expect(t).toBe(t.toLowerCase())
		}
	})
})

// ============================================================
// SemanticIndexService
// ============================================================

describe("SemanticIndexService", () => {
	test("build indexes source files and persists to brain", async () => {
		const { dir, svc, cleanup } = await makeService()
		try {
			const src = path.join(dir, "src")
			await writeFile(src, "auth-service.ts", `
export class AuthService {
	async login(username: string, password: string) {
		return authenticate(username, password)
	}
	async logout() {
		clearSession()
	}
}
`)
			await writeFile(src, "user-service.ts", `
export class UserService {
	async getProfile(userId: string) {
		return fetchUserProfile(userId)
	}
	async updateProfile(userId: string, data: object) {
		return saveUserProfile(userId, data)
	}
}
`)
			const index = await svc.build(src)
			expect(index.entries.length).toBe(2)
			expect(index.entries.some((e) => e.filePath === "auth-service.ts")).toBe(true)
			expect(index.entries.some((e) => e.filePath === "user-service.ts")).toBe(true)
			expect(Object.keys(index.idf).length).toBeGreaterThan(0)

			// Verify it was persisted
			const loaded = await svc.load()
			expect(loaded).not.toBeNull()
			expect(loaded?.entries.length).toBe(2)
		} finally {
			await cleanup()
		}
	})

	test("search returns relevant files ranked by similarity", async () => {
		const { dir, svc, cleanup } = await makeService()
		try {
			const src = path.join(dir, "src")
			await writeFile(src, "auth-service.ts", `
export class AuthService {
	async login(username: string, password: string) {
		return authenticate(username, password)
	}
}
`)
			await writeFile(src, "user-profile.ts", `
export class UserProfile {
	async getProfile(userId: string) {
		return fetchUserProfile(userId)
	}
}
`)
			await writeFile(src, "database.ts", `
export class Database {
	async connect(connectionString: string) {
		return openConnection(connectionString)
	}
}
`)
			await svc.build(src)

			const results = await svc.search("user profile")
			expect(results.length).toBeGreaterThan(0)
			// user-profile.ts should rank highest — it has both "user" and "profile"
			expect(results[0].filePath).toBe("user-profile.ts")
			expect(results[0].score).toBeGreaterThan(0)
			expect(results[0].matchedTerms.length).toBeGreaterThan(0)
		} finally {
			await cleanup()
		}
	})

	test("search with camelCase query matches camelCase symbols", async () => {
		const { dir, svc, cleanup } = await makeService()
		try {
			const src = path.join(dir, "src")
			await writeFile(src, "handlers.ts", `
export function handleUserLogin(req: Request) {}
export function handleOrderPayment(req: Request) {}
`)
			await svc.build(src)

			const results = await svc.search("handleUserLogin")
			expect(results.length).toBeGreaterThan(0)
			expect(results[0].matchedTerms).toContain("handle")
		} finally {
			await cleanup()
		}
	})

	test("search returns empty array when no index exists", async () => {
		const { svc, cleanup } = await makeService()
		try {
			const results = await svc.search("anything")
			expect(results).toHaveLength(0)
		} finally {
			await cleanup()
		}
	})

	test("search returns empty array for empty query", async () => {
		const { dir, svc, cleanup } = await makeService()
		try {
			const src = path.join(dir, "src")
			await writeFile(src, "index.ts", "export const x = 1")
			await svc.build(src)
			const results = await svc.search("")
			expect(results).toHaveLength(0)
		} finally {
			await cleanup()
		}
	})

	test("build skips node_modules and .git directories", async () => {
		const { dir, svc, cleanup } = await makeService()
		try {
			const src = path.join(dir, "src")
			await writeFile(src, "index.ts", "export const main = true")
			await writeFile(src, "node_modules/pkg/index.ts", "export const dep = true")
			await writeFile(src, ".git/config.ts", "export const gitConfig = true")
			const index = await svc.build(src)
			expect(index.entries).toHaveLength(1)
			expect(index.entries[0].filePath).toBe("index.ts")
		} finally {
			await cleanup()
		}
	})

	test("load returns null when no index file exists", async () => {
		const { svc, cleanup } = await makeService()
		try {
			const index = await svc.load()
			expect(index).toBeNull()
		} finally {
			await cleanup()
		}
	})
})
