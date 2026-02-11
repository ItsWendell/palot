import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import sharp from "sharp"

const ROOT = join(import.meta.dir, "..")
const OUT = join(ROOT, "docs/logo-drafts")
const RESOURCES = join(ROOT, "apps/desktop/resources")

const w900 = readFileSync(
	join(ROOT, "node_modules/@fontsource/geist-mono/files/geist-mono-latin-900-normal.woff2"),
).toString("base64")
const w600 = readFileSync(
	join(ROOT, "node_modules/@fontsource/geist-mono/files/geist-mono-latin-600-normal.woff2"),
).toString("base64")

const fontFaces = `
  @font-face { font-family: 'GM'; font-weight: 900; src: url(data:font/woff2;base64,${w900}) format('woff2'); }
  @font-face { font-family: 'GM'; font-weight: 600; src: url(data:font/woff2;base64,${w600}) format('woff2'); }
`

const FONT_SIZE = 136
const CHAR_WIDTH = 82
const GAP = 18
const STEP = CHAR_WIDTH + GAP

const letters = "PALOT".split("")
const totalTextWidth = letters.length * STEP - GAP // 782

function renderLetters(startX: number, y: number) {
	return letters
		.map((char, i) => {
			const x = startX + i * STEP + CHAR_WIDTH / 2
			const isCode = i < 4
			const fill = isCode ? "#1a1a1a" : "#666666"
			const weight = isCode ? 900 : 600
			return `<text x="${x}" y="${y}" font-family="'GM'" font-size="${FONT_SIZE}" font-weight="${weight}" fill="${fill}" text-anchor="middle">${char}</text>`
		})
		.join("\n    ")
}

// Icon SVG elements (reusable)
function renderIcon(x: number, y: number, scale: number) {
	// Original icon: cards at 176,270 / 212,300 / 248,330, size 600x424
	// Prompt chevron at 290,448 -> 340,490 -> 290,532, underscore at 362,520
	const s = scale / 1024 // scale factor relative to 1024 viewbox
	return `
    <g transform="translate(${x}, ${y}) scale(${s})">
      <rect x="248" y="330" width="600" height="424" rx="10" fill="#aaaaaa"/>
      <rect x="212" y="300" width="600" height="424" rx="10" fill="#666666"/>
      <rect x="176" y="270" width="600" height="424" rx="10" fill="#1a1a1a"/>
      <path d="M290,448 L340,490 L290,532" fill="none" stroke="#ffffff" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/>
      <rect x="362" y="520" width="50" height="14" rx="3" fill="#ffffff"/>
    </g>`
}

async function generate() {
	// === 1. Wordmark only (horizontal) ===
	const wmPadding = 40
	const wmWidth = totalTextWidth + wmPadding * 2
	const wmHeight = 200
	const wmSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${wmWidth} ${wmHeight}" width="${wmWidth}" height="${wmHeight}">
  <defs><style>${fontFaces}</style></defs>
    ${renderLetters(wmPadding, 140)}
</svg>`

	const wmBuf = await sharp(Buffer.from(wmSvg)).png().toBuffer()
	writeFileSync(join(OUT, "wordmark-final.png"), wmBuf)
	writeFileSync(
		join(RESOURCES, "wordmark.svg"),
		Buffer.from(wmSvg.replace(/<defs>.*?<\/defs>/s, "<!-- Font: Geist Mono 900/600 -->")),
	)
	console.log("  -> wordmark-final.png + resources/wordmark.svg")

	// === 2. Horizontal lockup: icon left + wordmark right ===
	const iconSize = 160
	const lockupGap = 28
	const lockupPadX = 40
	const lockupPadY = 30
	const textBlockHeight = FONT_SIZE
	const lockupHeight = Math.max(iconSize, textBlockHeight) + lockupPadY * 2
	const lockupWidth = lockupPadX + iconSize + lockupGap + totalTextWidth + lockupPadX

	// Vertically center both icon and text
	const iconY = (lockupHeight - iconSize) / 2
	const textY = lockupHeight / 2 + FONT_SIZE * 0.35 // baseline offset for visual centering

	const lockupSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${lockupWidth} ${lockupHeight}" width="${lockupWidth}" height="${lockupHeight}">
  <defs><style>${fontFaces}</style></defs>
    ${renderIcon(lockupPadX, iconY, iconSize)}
    ${renderLetters(lockupPadX + iconSize + lockupGap, textY)}
</svg>`

	const lockupBuf = await sharp(Buffer.from(lockupSvg)).png().toBuffer()
	writeFileSync(join(OUT, "lockup-horizontal.png"), lockupBuf)
	console.log("  -> lockup-horizontal.png")

	// === 3. Stacked lockup: icon on top, wordmark below ===
	const stackIconSize = 200
	const stackGap = 20
	const stackPadX = 40
	const stackPadTop = 40
	const stackPadBottom = 50
	const stackWidth = Math.max(totalTextWidth, stackIconSize) + stackPadX * 2
	const stackTextY = stackPadTop + stackIconSize + stackGap + FONT_SIZE * 0.8
	const stackHeight = stackTextY + stackPadBottom

	const stackIconX = (stackWidth - stackIconSize) / 2
	const stackTextX = (stackWidth - totalTextWidth) / 2

	const stackSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${stackWidth} ${stackHeight}" width="${stackWidth}" height="${stackHeight}">
  <defs><style>${fontFaces}</style></defs>
    ${renderIcon(stackIconX, stackPadTop, stackIconSize)}
    ${renderLetters(stackTextX, stackTextY)}
</svg>`

	const stackBuf = await sharp(Buffer.from(stackSvg)).png().toBuffer()
	writeFileSync(join(OUT, "lockup-stacked.png"), stackBuf)
	console.log("  -> lockup-stacked.png")

	// === 4. Dark mode variants (white on dark) ===
	function renderLettersDark(startX: number, y: number) {
		return letters
			.map((char, i) => {
				const x = startX + i * STEP + CHAR_WIDTH / 2
				const isCode = i < 4
				const fill = isCode ? "#ffffff" : "#999999"
				const weight = isCode ? 900 : 600
				return `<text x="${x}" y="${y}" font-family="'GM'" font-size="${FONT_SIZE}" font-weight="${weight}" fill="${fill}" text-anchor="middle">${char}</text>`
			})
			.join("\n    ")
	}

	function renderIconDark(x: number, y: number, scale: number) {
		const s = scale / 1024
		return `
    <g transform="translate(${x}, ${y}) scale(${s})">
      <rect x="248" y="330" width="600" height="424" rx="10" fill="#555555"/>
      <rect x="212" y="300" width="600" height="424" rx="10" fill="#888888"/>
      <rect x="176" y="270" width="600" height="424" rx="10" fill="#e0e0e0"/>
      <path d="M290,448 L340,490 L290,532" fill="none" stroke="#1a1a1a" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/>
      <rect x="362" y="520" width="50" height="14" rx="3" fill="#1a1a1a"/>
    </g>`
	}

	const darkLockupSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${lockupWidth} ${lockupHeight}" width="${lockupWidth}" height="${lockupHeight}">
  <defs><style>${fontFaces}</style></defs>
  <rect width="${lockupWidth}" height="${lockupHeight}" fill="#1a1a1a"/>
    ${renderIconDark(lockupPadX, iconY, iconSize)}
    ${renderLettersDark(lockupPadX + iconSize + lockupGap, textY)}
</svg>`

	const darkBuf = await sharp(Buffer.from(darkLockupSvg)).png().toBuffer()
	writeFileSync(join(OUT, "lockup-horizontal-dark.png"), darkBuf)
	console.log("  -> lockup-horizontal-dark.png")

	console.log("\nDone!")
}

generate().catch(console.error)
