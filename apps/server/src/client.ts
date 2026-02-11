/**
 * Type-safe client factory for the Palot server.
 *
 * Import this from the desktop app to get a fully typed Hono RPC client.
 * This file re-exports only the AppType and a pre-typed hc factory,
 * so the desktop app doesn't need to import from the server's index.ts directly.
 */

import { hc } from "hono/client"
import type { AppType } from "./index"

export type { AppType }

/**
 * Pre-typed client constructor.
 * Usage: `const client = createClient("http://localhost:3100")`
 */
export const createClient = (...args: Parameters<typeof hc>): ReturnType<typeof hc<AppType>> =>
	hc<AppType>(...args)
