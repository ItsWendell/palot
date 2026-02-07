import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
	plugins: [react(), tailwindcss()],
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "./src"),
			"@codedeck/ui": path.resolve(__dirname, "../../packages/ui/src"),
		},
	},
	clearScreen: false,
	server: {
		port: 1420,
		strictPort: true,
	},
})
