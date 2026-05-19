import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { ProjectBrainService } from "./project-brain-service"
import { ProjectIndexService } from "./project-index-service"

async function makeService() {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "palot-idx-"))
	const brain = new ProjectBrainService(dir)
	const svc = new ProjectIndexService(brain)
	return { dir, svc, cleanup: () => fs.rm(dir, { recursive: true, force: true }) }
}

async function writeFile(root: string, rel: string, content: string) {
	const full = path.join(root, rel)
	await fs.mkdir(path.dirname(full), { recursive: true })
	await fs.writeFile(full, content, "utf-8")
}

describe("ProjectIndexService", () => {
	test("build indexes exported symbols", async () => {
		const { dir, svc, cleanup } = await makeService()
		try {
			const src = path.join(dir, "src")
			await writeFile(src, "auth.ts", `
export function login(user: string) {}
export function logout() {}
export interface AuthState { token: string }
`)
			const index = await svc.build(src)
			const entry = index.entries.find((e) => e.filePath === "auth.ts")
			expect(entry).toBeDefined()
			expect(entry?.exports).toContain("login")
			expect(entry?.exports).toContain("logout")
			expect(entry?.exports).toContain("AuthState")
		} finally {
			await cleanup()
		}
	})

	test("build skips node_modules and .git", async () => {
		const { dir, svc, cleanup } = await makeService()
		try {
			const src = path.join(dir, "src")
			await writeFile(src, "index.ts", "export const x = 1")
			await writeFile(src, "node_modules/pkg/index.ts", "export const y = 2")
			await writeFile(src, ".git/config", "export const z = 3")
			const index = await svc.build(src)
			const paths = index.entries.map((e) => e.filePath)
			expect(paths).toContain("index.ts")
			expect(paths.some((p) => p.includes("node_modules"))).toBe(false)
		} finally {
			await cleanup()
		}
	})

	test("search returns relevant files by symbol", async () => {
		const { dir, svc, cleanup } = await makeService()
		try {
			const src = path.join(dir, "src")
			await writeFile(src, "user-service.ts", "export class UserService {}\nexport function getUser() {}")
			await writeFile(src, "auth-service.ts", "export class AuthService {}\nexport function login() {}")
			await svc.build(src)

			const results = await svc.search("UserService")
			expect(results[0].filePath).toBe("user-service.ts")
			expect(results[0].matchedSymbols).toContain("userservice")
		} finally {
			await cleanup()
		}
	})

	test("search matches partial path names", async () => {
		const { dir, svc, cleanup } = await makeService()
		try {
			const src = path.join(dir, "src")
			await writeFile(src, "components/sidebar.ts", "export const Sidebar = () => {}")
			await writeFile(src, "components/header.ts", "export const Header = () => {}")
			await svc.build(src)

			const results = await svc.search("sidebar")
			expect(results.length).toBeGreaterThan(0)
			expect(results[0].filePath).toContain("sidebar")
		} finally {
			await cleanup()
		}
	})

	test("load returns null when no index exists", async () => {
		const { svc, cleanup } = await makeService()
		try {
			const index = await svc.load()
			expect(index).toBeNull()
		} finally {
			await cleanup()
		}
	})

	test("search returns empty array when no index built", async () => {
		const { svc, cleanup } = await makeService()
		try {
			const results = await svc.search("anything")
			expect(results).toHaveLength(0)
		} finally {
			await cleanup()
		}
	})
})
