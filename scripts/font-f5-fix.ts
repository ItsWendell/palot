import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import sharp from "sharp"

const ROOT = join(import.meta.dir, "..")
const OUT = join(ROOT, "docs/logo-drafts")

const w800 = readFileSync(
	join(ROOT, "node_modules/@fontsource/geist-mono/files/geist-mono-latin-800-normal.woff2"),
).toString("base64")
const w900 = readFileSync(
	join(ROOT, "node_modules/@fontsource/geist-mono/files/geist-mono-latin-900-normal.woff2"),
).toString("base64")
const w600 = readFileSync(
	join(ROOT, "node_modules/@fontsource/geist-mono/files/geist-mono-latin-600-normal.woff2"),
).toString("base64")

function fontFaces() {
	return `
      @font-face { font-family: 'GM'; font-weight: 900; src: url(data:font/woff2;base64,${w900}) format('woff2'); }
      @font-face { font-family: 'GM'; font-weight: 800; src: url(data:font/woff2;base64,${w800}) format('woff2'); }
      @font-face { font-family: 'GM'; font-weight: 600; src: url(data:font/woff2;base64,${w600}) format('woff2'); }
    `
}

// Geist Mono is monospaced, so every character has the same advance width.
// At font-size 136, each character cell is roughly 82px wide.
// We'll place each letter individually with exact x positions to guarantee
// perfectly equal spacing regardless of weight differences.

const FONT_SIZE = 136
const CHAR_WIDTH = 82 // approximate monospace cell width at this size
const GAP = 18 // gap between character cells
const STEP = CHAR_WIDTH + GAP // total step per letter

const letters = "PALOT".split("")
const codeColors = ["#1a1a1a", "#1a1a1a", "#1a1a1a", "#1a1a1a"]
const deckColors = ["#666666", "#666666", "#666666", "#666666"]
const codeWeight = 900
const deckWeight = 600

// Total width = 8 letters * STEP - GAP (no trailing gap)
const totalWidth = letters.length * STEP - GAP
const _canvasWidth = totalWidth + 120 // 60px padding each side
const _startX = 60

// Try a few gap sizes to find the perfect one
const gapVariants = [12, 16, 18, 20, 24]

async function generate() {
	for (const gap of gapVariants) {
		const step = CHAR_WIDTH + gap
		const tw = letters.length * step - gap
		const cw = tw + 120
		const y = 176

		const letterEls = letters
			.map((char, i) => {
				const x = 60 + i * step
				const isCode = i < 4
				const fill = isCode ? codeColors[i] : deckColors[i - 4]
				const weight = isCode ? codeWeight : deckWeight
				// text-anchor middle, so offset by half char width
				return `<text x="${x + CHAR_WIDTH / 2}" y="${y}" font-family="'GM'" font-size="${FONT_SIZE}" font-weight="${weight}" fill="${fill}" text-anchor="middle">${char}</text>`
			})
			.join("\n    ")

		const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${cw} 260" width="${cw}" height="260">
  <defs><style>${fontFaces()}</style></defs>
  <rect width="${cw}" height="260" fill="#ffffff"/>
  ${letterEls}
  <text x="${cw / 2}" y="244" font-family="sans-serif" font-size="14" fill="#bbbbbb" text-anchor="middle">F5 fixed spacing — gap=${gap}px, Black(900) CODE + Semibold(600) DECK</text>
</svg>`

		const buf = await sharp(Buffer.from(svg)).png().toBuffer()
		writeFileSync(join(OUT, `wm-F5-gap${gap}.png`), buf)
		console.log(`  -> wm-F5-gap${gap}.png`)
	}

	console.log("\nDone!")
}

generate().catch(console.error)
