import { Hono } from "hono"
import { discover } from "../services/discovery"

const app = new Hono().get("/", async (c) => {
	const result = await discover()
	return c.json(result, 200)
})

export default app
