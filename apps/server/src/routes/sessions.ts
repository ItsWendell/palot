import { Hono } from "hono"
import { readSessionMessages } from "../services/messages"

const app = new Hono().get("/:id/messages", async (c) => {
	const sessionId = c.req.param("id")

	try {
		const messages = await readSessionMessages(sessionId)
		return c.json({ messages }, 200)
	} catch (err) {
		const message = err instanceof Error ? err.message : "Failed to read messages"
		return c.json({ error: message }, 500)
	}
})

export default app
