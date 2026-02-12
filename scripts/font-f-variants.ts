import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import sharp from "sharp"

const ROOT = join(import.meta.dir, "..")
const OUT = join(ROOT, "docs/logo-drafts")

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
	900: readFileSync(
		join(ROOT, "node_modules/@fontsource/geist-mono/files/geist-mono-latin-900-normal.woff2"),
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
	render: () => string
}

const variants: Variant[] = [
	{
		// Bold CODE + regular DECK, dark/gray
		name: "F1",
		desc: "ExtraBold CODE + Regular DECK, dark/gray",
		render: () => `
      <text y="176" font-family="'GM'" font-size="136" letter-spacing="12" text-anchor="middle">
        <tspan x="600" font-weight="800" fill="#1a1a1a">CODE</tspan><tspan font-weight="400" fill="#999999">DECK</tspan>
      </text>`,
	},
	{
		// Bold CODE + medium DECK, darker gray
		name: "F2",
		desc: "ExtraBold CODE + Medium DECK, subtle split",
		render: () => `
      <text y="176" font-family="'GM'" font-size="136" letter-spacing="12" text-anchor="middle">
        <tspan x="600" font-weight="800" fill="#1a1a1a">CODE</tspan><tspan font-weight="500" fill="#666666">DECK</tspan>
      </text>`,
	},
	{
		// Gradient from black to gray across all 8 letters
		name: "F3",
		desc: "Weight + color gradient across letters",
		render: () => `
      <text y="176" font-family="'GM'" font-size="136" letter-spacing="12" text-anchor="middle">
        <tspan x="600" font-weight="900" fill="#000000">C</tspan><tspan font-weight="800" fill="#1a1a1a">O</tspan><tspan font-weight="700" fill="#333333">D</tspan><tspan font-weight="700" fill="#4a4a4a">E</tspan><tspan font-weight="600" fill="#606060">D</tspan><tspan font-weight="500" fill="#777777">E</tspan><tspan font-weight="400" fill="#8a8a8a">C</tspan><tspan font-weight="400" fill="#999999">K</tspan>
      </text>`,
	},
	{
		// Bold CODE in black, regular DECK in lighter weight, wider gap between words
		name: "F4",
		desc: "ExtraBold CODE + Light DECK, word gap",
		render: () => `
      <text y="176" font-family="'GM'" font-size="136" letter-spacing="12" text-anchor="middle">
        <tspan x="568" font-weight="800" fill="#1a1a1a">CODE</tspan><tspan dx="16" font-weight="400" fill="#aaaaaa">DECK</tspan>
      </text>`,
	},
	{
		// Heavy CODE dark, semibold DECK mid, mirroring the stacked cards (dark front, lighter back)
		name: "F5",
		desc: "Black CODE + Semibold DECK, matching icon gradient",
		render: () => `
      <text y="176" font-family="'GM'" font-size="136" letter-spacing="12" text-anchor="middle">
        <tspan x="600" font-weight="900" fill="#1a1a1a">CODE</tspan><tspan font-weight="600" fill="#666666">DECK</tspan>
      </text>`,
	},
	{
		// Three-stage: CO heavy, DE mid, CK light - like three stacked cards
		name: "F6",
		desc: "3-stage weight: CO/DE/CK matching 3 cards",
		render: () => `
      <text y="176" font-family="'GM'" font-size="136" letter-spacing="12" text-anchor="middle">
        <tspan x="600" font-weight="800" fill="#1a1a1a">CO</tspan><tspan font-weight="600" fill="#666666">DE</tspan><tspan font-weight="600" fill="#666666">DE</tspan><tspan font-weight="400" fill="#aaaaaa">CK</tspan>
      </text>`,
	},
	{
		// Bold black CODE + Regular DECK with underline accent
		name: "F7",
		desc: "ExtraBold/Regular split + underline accent",
		render: () => `
      <text y="166" font-family="'GM'" font-size="136" letter-spacing="12" text-anchor="middle">
        <tspan x="600" font-weight="800" fill="#1a1a1a">CODE</tspan><tspan font-weight="400" fill="#999999">DECK</tspan>
      </text>
      <rect x="132" y="190" width="440" height="5" rx="2" fill="#1a1a1a"/>`,
	},
	{
		// Two-tone with the midpoint at the "D" - "CODE" solid, "D" transitions, "ECK" fades
		name: "F8",
		desc: "Smooth transition at boundary letter D",
		render: () => `
      <text y="176" font-family="'GM'" font-size="136" letter-spacing="12" text-anchor="middle">
        <tspan x="600" font-weight="800" fill="#1a1a1a">CODE</tspan><tspan font-weight="700" fill="#444444">D</tspan><tspan font-weight="500" fill="#777777">E</tspan><tspan font-weight="400" fill="#999999">C</tspan><tspan font-weight="400" fill="#aaaaaa">K</tspan>
      </text>`,
	},
]

async function generate() {
	for (const v of variants) {
		const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 260" width="1200" height="260">
  <defs><style>${fontFaces()}</style></defs>
  <rect width="1200" height="260" fill="#ffffff"/>
  ${v.render()}
  <text x="600" y="244" font-family="sans-serif" font-size="15" fill="#bbbbbb" text-anchor="middle">${v.name}: ${v.desc}</text>
</svg>`

		const buf = await sharp(Buffer.from(svg)).png().toBuffer()
		writeFileSync(join(OUT, `wm-${v.name}.png`), buf)
		console.log(`  -> wm-${v.name}.png`)
	}
	console.log("\nDone!")
}

generate().catch(console.error)
