import { describe, expect, test } from "bun:test"
import { buildChatMessageText, prepareChatMessage } from "./chat-send"

describe("chat send preparation", () => {
	test("trims message text when no diff comments are present", () => {
		expect(buildChatMessageText("  hello  ", [])).toBe("hello")
	})

	test("prepends serialized diff comments before trimmed message text", () => {
		const text = buildChatMessageText("  please fix  ", [
			{
				id: "c1",
				filePath: "src/app.ts",
				lineNumber: 42,
				side: "additions",
				content: "This branch misses validation.",
				createdAt: 1,
			},
		])

		expect(text).toBe(
			"[Code Review Comments]\n\n- src/app.ts:42 (new): This branch misses validation.\nplease fix",
		)
	})

	test("preserves selected model, agent, variant, and files in send options", () => {
		const prepared = prepareChatMessage({
			text: "ship it",
			diffComments: [],
			effectiveModel: { providerID: "openrouter", modelID: "deepseek/deepseek-chat-v3.1" },
			selectedAgent: "lead-agent",
			selectedVariant: "fast",
			files: [{ type: "file", url: "file:///tmp/a.png", mediaType: "image/png", filename: "a.png" }],
		})

		expect(prepared.text).toBe("ship it")
		expect(prepared.options).toEqual({
			model: { providerID: "openrouter", modelID: "deepseek/deepseek-chat-v3.1" },
			agentName: "lead-agent",
			variant: "fast",
			files: [{ type: "file", url: "file:///tmp/a.png", mediaType: "image/png", filename: "a.png" }],
		})
	})
})
