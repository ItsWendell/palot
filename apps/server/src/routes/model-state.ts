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

const MAX_RECENT = 10

/**
 * Resolves the OpenCode state directory path from the running server.
 */
async function resolveStatePath(): Promise<string> {
	const pathRes = await fetch("http://127.0.0.1:4101/path")
	if (!pathRes.ok) {
		throw new Error("Failed to get OpenCode state path")
	}
	const paths = (await pathRes.json()) as { state: string }
	return paths.state
}

const app = new Hono()
	.get("/", async (c) => {
		try {
			const statePath = await resolveStatePath()
			const modelFile = Bun.file(`${statePath}/model.json`)

			if (!(await modelFile.exists())) {
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
	.post("/recent", async (c) => {
		try {
			const body = (await c.req.json()) as ModelRef
			if (!body.providerID || !body.modelID) {
				return c.json({ error: "providerID and modelID are required" }, 400)
			}

			const statePath = await resolveStatePath()
			const modelFile = Bun.file(`${statePath}/model.json`)

			// Read existing state
			let existing: ModelState = { recent: [], favorite: [], variant: {} }
			if (await modelFile.exists()) {
				const data = (await modelFile.json()) as ModelState
				existing = {
					recent: Array.isArray(data.recent) ? data.recent : [],
					favorite: Array.isArray(data.favorite) ? data.favorite : [],
					variant: typeof data.variant === "object" && data.variant !== null ? data.variant : {},
				}
			}

			// Prepend, deduplicate, cap
			const key = (m: ModelRef) => `${m.providerID}/${m.modelID}`
			const seen = new Set<string>()
			const updated: ModelRef[] = []
			for (const entry of [body, ...existing.recent]) {
				const k = key(entry)
				if (!seen.has(k) && updated.length < MAX_RECENT) {
					seen.add(k)
					updated.push({ providerID: entry.providerID, modelID: entry.modelID })
				}
			}

			const newState: ModelState = {
				recent: updated,
				favorite: existing.favorite,
				variant: existing.variant,
			}

			await Bun.write(modelFile, JSON.stringify(newState))
			return c.json(newState, 200)
		} catch (err) {
			const message = err instanceof Error ? err.message : "Failed to update model state"
			return c.json({ error: message }, 500)
		}
	})

export default app
