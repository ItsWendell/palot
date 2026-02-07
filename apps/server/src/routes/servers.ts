import { Hono } from "hono"
import { listServers, startServer, stopServer } from "../services/server-manager"

const app = new Hono()
	.get("/", async (c) => {
		const servers = await listServers()
		return c.json({ servers }, 200)
	})
	.post("/start", async (c) => {
		const body = await c.req.json<{ directory: string }>()
		if (!body.directory) {
			return c.json({ error: "directory is required" }, 400)
		}

		try {
			const server = await startServer(body.directory)
			return c.json({ server }, 200)
		} catch (err) {
			const message = err instanceof Error ? err.message : "Failed to start server"
			return c.json({ error: message }, 500)
		}
	})
	.post("/stop", async (c) => {
		const body = await c.req.json<{ directory: string }>()
		if (!body.directory) {
			return c.json({ error: "directory is required" }, 400)
		}

		const stopped = await stopServer(body.directory)
		return c.json({ stopped }, 200)
	})

export default app
