/**
 * Standalone Vite config for browser-mode development (no Electron).
 * Usage: bun run dev:web (or `vite --config src/renderer/vite.web.config.ts`)
 *
 * In this mode, the Palot Bun server (apps/server) must be running
 * on port 3100 to handle filesystem operations and process management.
 */

import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
	root: __dirname,
	plugins: [react(), tailwindcss()],
	resolve: {
		alias: {
			"@": __dirname,
			"@palot/ui": path.resolve(__dirname, "../../../../packages/ui/src"),
		},
	},
	clearScreen: false,
	server: {
		port: 1420,
		strictPort: true,
	},
})
