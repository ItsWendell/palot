import { Hono } from "hono"
import { cors } from "hono/cors"
import discovery from "./routes/discovery"
import health from "./routes/health"
import modelState from "./routes/model-state"
import servers from "./routes/servers"
import sessions from "./routes/sessions"
import { ensureSingleServer } from "./services/server-manager"

// ============================================================
// App — CORS middleware applied first, then routes chained for RPC
// ============================================================

const app = new Hono()

// Middleware — applied via .use() before route chaining
app.use(
	"*",
	cors({
		origin: ["http://localhost:1420", "http://127.0.0.1:1420"],
	}),
)

// Routes — chained for Hono RPC type inference
const routes = app
	.route("/api/discover", discovery)
	.route("/api/servers", servers)
	.route("/api/sessions", sessions)
	.route("/api/model-state", modelState)
	.route("/health", health)

export type AppType = typeof routes

// ============================================================
// Start
// ============================================================

const port = Number(process.env.PORT) || 3100

console.log(`Palot server starting on port ${port}`)

// Eagerly start the single OpenCode server in the background
ensureSingleServer()
	.then((server) => {
		console.log(`OpenCode server ready at ${server.url}`)
	})
	.catch((err) => {
		console.error("Failed to start OpenCode server on boot:", err)
	})

export default {
	port,
	fetch: app.fetch,
}
