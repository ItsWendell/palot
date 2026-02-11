import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import sharp from "sharp"

const ROOT = join(import.meta.dir, "..")
const OUT = join(ROOT, "docs/logo-drafts")

// Font files (woff2) from fontsource packages
const fonts: Record<string, { file: string; name: string }> = {
	"geist-sans": {
		file: "node_modules/@fontsource/geist-sans/files/geist-sans-latin-700-normal.woff2",
		name: "Geist Sans",
	},
	"geist-mono": {
		file: "node_modules/@fontsource/geist-mono/files/geist-mono-latin-700-normal.woff2",
		name: "Geist Mono",
	},
	"space-grotesk": {
		file: "node_modules/@fontsource/space-grotesk/files/space-grotesk-latin-700-normal.woff2",
		name: "Space Grotesk",
	},
	"space-mono": {
		file: "node_modules/@fontsource/space-mono/files/space-mono-latin-700-normal.woff2",
		name: "Space Mono",
	},
	"dm-sans": {
		file: "node_modules/@fontsource/dm-sans/files/dm-sans-latin-700-normal.woff2",
		name: "DM Sans",
	},
	inter: {
		file: "node_modules/@fontsource/inter/files/inter-latin-700-normal.woff2",
		name: "Inter",
	},
	"plus-jakarta": {
		file: "node_modules/@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-700-normal.woff2",
		name: "Plus Jakarta Sans",
	},
	"albert-sans": {
		file: "node_modules/@fontsource/albert-sans/files/albert-sans-latin-700-normal.woff2",
		name: "Albert Sans",
	},
}

// Also load semibold/medium variants for the "deck" part
const fontsLight: Record<string, { file: string }> = {
	"geist-sans": {
		file: "node_modules/@fontsource/geist-sans/files/geist-sans-latin-400-normal.woff2",
	},
	"geist-mono": {
		file: "node_modules/@fontsource/geist-mono/files/geist-mono-latin-400-normal.woff2",
	},
	"space-grotesk": {
		file: "node_modules/@fontsource/space-grotesk/files/space-grotesk-latin-400-normal.woff2",
	},
	"space-mono": {
		file: "node_modules/@fontsource/space-mono/files/space-mono-latin-400-normal.woff2",
	},
	"dm-sans": {
		file: "node_modules/@fontsource/dm-sans/files/dm-sans-latin-400-normal.woff2",
	},
	inter: {
		file: "node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2",
	},
	"plus-jakarta": {
		file: "node_modules/@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-400-normal.woff2",
	},
	"albert-sans": {
		file: "node_modules/@fontsource/albert-sans/files/albert-sans-latin-400-normal.woff2",
	},
}

async function generateWordmarks() {
	for (const [id, font] of Object.entries(fonts)) {
		const boldData = readFileSync(join(ROOT, font.file)).toString("base64")
		const lightData = readFileSync(join(ROOT, fontsLight[id].file)).toString("base64")

		// Version A: "code" bold + "deck" regular gray
		const svgA = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 140" width="800" height="140">
  <defs>
    <style>
      @font-face {
        font-family: '${font.name}';
        font-weight: 700;
        src: url(data:font/woff2;base64,${boldData}) format('woff2');
      }
      @font-face {
        font-family: '${font.name}';
        font-weight: 400;
        src: url(data:font/woff2;base64,${lightData}) format('woff2');
      }
    </style>
  </defs>
  <text x="16" y="100" font-family="'${font.name}'" font-size="92" fill="#1a1a1a">
    <tspan font-weight="700">code</tspan><tspan font-weight="400" fill="#888888">deck</tspan>
  </text>
  <text x="16" y="135" font-family="sans-serif" font-size="14" fill="#aaa">${font.name} — bold/regular</text>
</svg>`

		// Version B: all bold, single color
		const svgB = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 140" width="800" height="140">
  <defs>
    <style>
      @font-face {
        font-family: '${font.name}';
        font-weight: 700;
        src: url(data:font/woff2;base64,${boldData}) format('woff2');
      }
    </style>
  </defs>
  <text x="16" y="100" font-family="'${font.name}'" font-size="92" font-weight="700" fill="#1a1a1a">palot</text>
  <text x="16" y="135" font-family="sans-serif" font-size="14" fill="#aaa">${font.name} — bold</text>
</svg>`

		const bufA = await sharp(Buffer.from(svgA)).resize(800, 140).png().toBuffer()
		const bufB = await sharp(Buffer.from(svgB)).resize(800, 140).png().toBuffer()

		writeFileSync(join(OUT, `wm-${id}-split.png`), bufA)
		writeFileSync(join(OUT, `wm-${id}-bold.png`), bufB)
		console.log(`  -> ${id} (split + bold)`)
	}

	console.log("\nDone!")
}

generateWordmarks().catch(console.error)
