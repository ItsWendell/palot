import { Hono } from "hono"

interface ModelRef {
	providerID: string
	modelID: string
}

interface ModelState {
	recent: ModelRef[]
	favorite: ModelRef[]
	variant: Record<string, string | undefined>
}

const app = new Hono().get("/", async (c) => {
	try {
		// Use the OpenCode SDK to get the state directory path
		const pathRes = await fetch("http://127.0.0.1:4101/path")
		if (!pathRes.ok) {
			return c.json({ error: "Failed to get OpenCode state path" }, 500)
		}
		const paths = (await pathRes.json()) as { state: string }
		const modelFile = Bun.file(`${paths.state}/model.json`)

		if (!(await modelFile.exists())) {
			// Return empty state if file doesn't exist yet
			const empty: ModelState = { recent: [], favorite: [], variant: {} }
			return c.json(empty, 200)
		}

		const data = (await modelFile.json()) as ModelState
		return c.json(
			{
				recent: Array.isArray(data.recent) ? data.recent : [],
				favorite: Array.isArray(data.favorite) ? data.favorite : [],
				variant: typeof data.variant === "object" && data.variant !== null ? data.variant : {},
			} satisfies ModelState,
			200,
		)
	} catch (err) {
		const message = err instanceof Error ? err.message : "Failed to read model state"
		return c.json({ error: message }, 500)
	}
})

export default app
