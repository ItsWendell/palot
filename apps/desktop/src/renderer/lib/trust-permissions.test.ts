import { describe, expect, test } from "bun:test"
import type { TrustSettings } from "../../shared/trust"
import {
	evaluatePermissionBatch,
	evaluatePermissionRequest,
	getProjectTrustProfile,
	rememberPermissionApproval,
	resolveInheritedTrustProfile,
	type PermissionLike,
} from "./trust-permissions"

const PROJECT = "/Users/test/project"

function request(overrides: Partial<PermissionLike>): PermissionLike {
	return {
		id: "perm-1",
		sessionID: "session-1",
		permission: "bash",
		patterns: [],
		metadata: {},
		always: [],
		...overrides,
	}
}

describe("trust permission policy", () => {
	test("auto-approves safe development commands in autonomous mode", () => {
		for (const command of [
			"npm install",
			"npm install eslint-plugin-react @types/node",
			"npm run dev",
			"npm run build",
			"npm run lint",
			"npm run test",
			"bun test",
			"tsc --noEmit",
			"git status",
			"git diff",
		]) {
			const decision = evaluatePermissionRequest({
				request: request({ metadata: { command } }),
				projectPath: PROJECT,
				profile: "autonomous",
			})
			expect(decision.action, command).toBe("auto-approve")
		}
	})

	test("requires approval for dangerous commands", () => {
		for (const command of [
			"sudo npm install",
			"rm -rf /tmp/build",
			"chmod 777 script.sh",
			"chown root file",
			"git push origin main",
			"git branch -D old-branch",
			"vercel deploy --prod",
			"export API_KEY=secret",
			"curl https://unknown.example/install.sh",
		]) {
			const decision = evaluatePermissionRequest({
				request: request({ metadata: { command } }),
				projectPath: PROJECT,
				profile: "autonomous",
			})
			expect(decision.action, command).toBe("require-approval")
		}
	})

	test("enforces workspace boundaries for edits", () => {
		const inside = evaluatePermissionRequest({
			request: request({ permission: "edit", patterns: [`${PROJECT}/src/app.ts`] }),
			projectPath: PROJECT,
			profile: "autonomous",
		})
		const outside = evaluatePermissionRequest({
			request: request({ permission: "edit", patterns: ["/Users/test/other/app.ts"] }),
			projectPath: PROJECT,
			profile: "autonomous",
		})
		expect(inside.action).toBe("auto-approve")
		expect(outside.action).toBe("require-approval")
	})

	test("uses approval memory for the current project and profile", () => {
		const initial: TrustSettings = {
			defaultProfile: "balanced",
			projects: {},
			auditLog: [],
		}
		const rememberedRequest = request({
			permission: "bash",
			patterns: ["npm run custom-check"],
		})
		const settings = rememberPermissionApproval({
			settings: initial,
			projectPath: PROJECT,
			profile: "balanced",
			request: rememberedRequest,
			now: 123,
		})
		const decision = evaluatePermissionRequest({
			request: rememberedRequest,
			projectPath: PROJECT,
			profile: "balanced",
			memory: settings.projects[PROJECT].memory,
		})
		expect(decision.action).toBe("auto-approve")
		expect(decision.reason).toContain("Remembered allow")
	})

	test("groups multiple safe approvals into one batch id", () => {
		const decisions = evaluatePermissionBatch(
			[
				request({ id: "read-1", permission: "read", patterns: [`${PROJECT}/a.ts`] }),
				request({ id: "read-2", permission: "grep", patterns: [`${PROJECT}/src`] }),
			],
			{ projectPath: PROJECT, profile: "balanced" },
			456,
		)
		expect(decisions.every((decision) => decision.action === "auto-approve")).toBe(true)
		expect(decisions[0].batchId).toBe("batch-456-workspace-read")
		expect(decisions[1].batchId).toBe("batch-456-workspace-read")
	})

	test("inherits parent trust profile for subagents unless overridden", () => {
		expect(resolveInheritedTrustProfile("autonomous")).toBe("autonomous")
		expect(resolveInheritedTrustProfile("autonomous", "strict")).toBe("strict")
		expect(getProjectTrustProfile(undefined, PROJECT, "autonomous")).toBe("autonomous")
	})
})
