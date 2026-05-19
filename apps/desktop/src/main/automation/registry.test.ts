import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import { createConfig, deleteConfig, listConfigs, readConfig, updateConfig } from "./registry"

describe("automation registry", () => {
	test("creates, reads, updates, lists, and deletes automation config on disk", async () => {
		const configHome = await fs.mkdtemp(path.join(os.tmpdir(), "palot-automation-config-"))
		const previousConfigHome = process.env.XDG_CONFIG_HOME
		process.env.XDG_CONFIG_HOME = configHome

		try {
			const id = createConfig({
				name: "Nightly Review",
				prompt: "Review the repo.",
				schedule: { rrule: "FREQ=DAILY", timezone: "America/New_York" },
				workspaces: ["/tmp/project"],
				execution: { effort: "low", useWorktree: false },
			})

			expect(id).toBe("nightly-review")
			expect(listConfigs().map((config) => config.id)).toEqual(["nightly-review"])

			const created = readConfig(id)
			expect(created?.name).toBe("Nightly Review")
			expect(created?.prompt).toBe("Review the repo.")
			expect(created?.execution.effort).toBe("low")
			expect(created?.execution.useWorktree).toBe(false)

			expect(updateConfig({ id, name: "Daily Review", prompt: "Review changes." })).toBe(true)
			const updated = readConfig(id)
			expect(updated?.name).toBe("Daily Review")
			expect(updated?.prompt).toBe("Review changes.")

			expect(deleteConfig(id)).toBe(true)
			expect(listConfigs()).toEqual([])
		} finally {
			if (previousConfigHome === undefined) {
				delete process.env.XDG_CONFIG_HOME
			} else {
				process.env.XDG_CONFIG_HOME = previousConfigHome
			}
			await fs.rm(configHome, { recursive: true, force: true })
		}
	})
})
