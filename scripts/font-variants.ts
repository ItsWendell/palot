import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import sharp from "sharp"

const ROOT = join(import.meta.dir, "..")
const OUT = join(ROOT, "docs/logo-drafts")

// Load all needed weights
const weights = {
	400: readFileSync(
		join(ROOT, "node_modules/@fontsource/geist-mono/files/geist-mono-latin-400-normal.woff2"),
	).toString("base64"),
	500: readFileSync(
		join(ROOT, "node_modules/@fontsource/geist-mono/files/geist-mono-latin-500-normal.woff2"),
	).toString("base64"),
	600: readFileSync(
		join(ROOT, "node_modules/@fontsource/geist-mono/files/geist-mono-latin-600-normal.woff2"),
	).toString("base64"),
	700: readFileSync(
		join(ROOT, "node_modules/@fontsource/geist-mono/files/geist-mono-latin-700-normal.woff2"),
	).toString("base64"),
	800: readFileSync(
		join(ROOT, "node_modules/@fontsource/geist-mono/files/geist-mono-latin-800-normal.woff2"),
	).toString("base64"),
}

function fontFaces() {
	return Object.entries(weights)
		.map(
			([w, data]) => `
      @font-face {
        font-family: 'GM';
        font-weight: ${w};
        src: url(data:font/woff2;base64,${data}) format('woff2');
      }`,
		)
		.join("\n")
}

type Variant = {
	name: string
	desc: string
	render: () => string // returns the <text> element(s)
}

const variants: Variant[] = [
	{
		name: "A",
		desc: "Bold + Regular, dark/gray split",
		render: () => `
      <text x="600" y="180" font-family="'GM'" font-size="160" text-anchor="middle">
        <tspan font-weight="700" fill="#1a1a1a">code</tspan><tspan font-weight="400" fill="#999999">deck</tspan>
      </text>`,
	},
	{
		name: "B",
		desc: "Semibold + Regular, dark/gray split",
		render: () => `
      <text x="600" y="180" font-family="'GM'" font-size="160" text-anchor="middle">
        <tspan font-weight="600" fill="#1a1a1a">code</tspan><tspan font-weight="400" fill="#999999">deck</tspan>
      </text>`,
	},
	{
		name: "C",
		desc: "All semibold, single color",
		render: () => `
      <text x="600" y="180" font-family="'GM'" font-size="160" font-weight="600" fill="#1a1a1a" text-anchor="middle">palot</text>`,
	},
	{
		name: "D",
		desc: "Medium weight, extra-tight, all lowercase",
		render: () => `
      <text x="600" y="180" font-family="'GM'" font-size="160" font-weight="500" fill="#1a1a1a" letter-spacing="-4" text-anchor="middle">palot</text>`,
	},
	{
		name: "E",
		desc: "Bold + Medium, subtle split",
		render: () => `
      <text x="600" y="180" font-family="'GM'" font-size="160" text-anchor="middle">
        <tspan font-weight="700" fill="#1a1a1a">code</tspan><tspan font-weight="500" fill="#666666">deck</tspan>
      </text>`,
	},
	{
		name: "F",
		desc: "ExtraBold, all caps, tracked",
		render: () => `
      <text x="600" y="176" font-family="'GM'" font-size="136" font-weight="800" fill="#1a1a1a" letter-spacing="12" text-anchor="middle">PALOT</text>`,
	},
]

async function generate() {
	for (const v of variants) {
		const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 260" width="1200" height="260">
  <defs><style>${fontFaces()}</style></defs>
  <rect width="1200" height="260" fill="#ffffff"/>
  ${v.render()}
  <text x="600" y="240" font-family="sans-serif" font-size="16" fill="#bbbbbb" text-anchor="middle">${v.name}: ${v.desc} — Geist Mono</text>
</svg>`

		const buf = await sharp(Buffer.from(svg)).png().toBuffer()
		writeFileSync(join(OUT, `wm-final-${v.name}.png`), buf)
		console.log(`  -> wm-final-${v.name}.png`)
	}

	// Also render a "proof" image showing Geist Mono's unique glyphs
	const proofSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 200" width="1200" height="200">
  <defs><style>${fontFaces()}</style></defs>
  <rect width="1200" height="200" fill="#f4f4f4"/>
  <text x="40" y="60" font-family="sans-serif" font-size="16" fill="#999">GEIST MONO GLYPH PROOF — unique letterforms:</text>
  <text x="40" y="140" font-family="'GM'" font-size="72" font-weight="600" fill="#1a1a1a">a d e k g 0 1 {} &lt;&gt;</text>
  <text x="40" y="180" font-family="sans-serif" font-size="14" fill="#bbb">Note the single-story 'a', flat-top 'd', geometric 'e' counter, angular 'k' leg, and distinctive '0' with dot</text>
</svg>`

	const proofBuf = await sharp(Buffer.from(proofSvg)).png().toBuffer()
	writeFileSync(join(OUT, "wm-geist-mono-proof.png"), proofBuf)
	console.log("  -> wm-geist-mono-proof.png")

	console.log("\nDone!")
}

generate().catch(console.error)
