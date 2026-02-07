import { Hono } from "hono"
import { cors } from "hono/cors"
import discovery from "./routes/discovery"
import health from "./routes/health"
import servers from "./routes/servers"
import sessions from "./routes/sessions"

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
	.route("/health", health)

export type AppType = typeof routes

// ============================================================
// Start
// ============================================================

const port = Number(process.env.PORT) || 3100

console.log(`Codedeck server starting on port ${port}`)

export default {
	port,
	fetch: app.fetch,
}
