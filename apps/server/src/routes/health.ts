import { Hono } from "hono"

const app = new Hono().get("/", (c) => {
	return c.json({ status: "ok" as const, timestamp: Date.now() }, 200)
})

export default app
