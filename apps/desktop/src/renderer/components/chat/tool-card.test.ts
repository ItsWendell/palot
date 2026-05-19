import { describe, expect, test } from "bun:test"
import { getToolCategory } from "./tool-card"

describe("getToolCategory", () => {
	test("classifies Hive Mind memory tools as memory", () => {
		expect(getToolCategory("brain_read")).toBe("memory")
		expect(getToolCategory("brain_write")).toBe("memory")
		expect(getToolCategory("brain_search")).toBe("memory")
		expect(getToolCategory("mem9_recall")).toBe("memory")
		expect(getToolCategory("mem9_store")).toBe("memory")
	})
})
