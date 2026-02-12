import { Hono } from "hono"
import { ensureSingleServer, getServerUrl, stopServer } from "../services/server-manager"

const app = new Hono()
	// New primary endpoint — ensures the single server is running and returns its URL
	.get("/opencode", async (c) => {
		try {
			const server = await ensureSingleServer()
			return c.json({ url: server.url }, 200)
		} catch (err) {
			const message = err instanceof Error ? err.message : "Failed to start OpenCode server"
			return c.json({ error: message }, 500)
		}
	})
	// Keep legacy endpoints for backward compat during transition
	.get("/", async (c) => {
		const url = getServerUrl()
		const servers = url
			? [{ id: "single", url, directory: "", name: "opencode", pid: null, managed: true }]
			: []
		return c.json({ servers }, 200)
	})
	.post("/start", async (c) => {
		try {
			const server = await ensureSingleServer()
			return c.json(
				{
					server: {
						id: "single",
						url: server.url,
						directory: "",
						name: "opencode",
						pid: server.pid,
						managed: server.managed,
					},
				},
				200,
			)
		} catch (err) {
			const message = err instanceof Error ? err.message : "Failed to start server"
			return c.json({ error: message }, 500)
		}
	})
	.post("/stop", async (c) => {
		const stopped = stopServer()
		return c.json({ stopped }, 200)
	})

export default app
