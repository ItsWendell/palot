import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import sharp from "sharp"

const ROOT = join(import.meta.dir, "..")
const OUT = join(ROOT, "docs/logo-drafts")

// Load both fonts for comparison
const geistMonoBold = readFileSync(
	join(ROOT, "node_modules/@fontsource/geist-mono/files/geist-mono-latin-700-normal.woff2"),
).toString("base64")
const geistMonoRegular = readFileSync(
	join(ROOT, "node_modules/@fontsource/geist-mono/files/geist-mono-latin-400-normal.woff2"),
).toString("base64")
const geistMonoMedium = readFileSync(
	join(ROOT, "node_modules/@fontsource/geist-mono/files/geist-mono-latin-500-normal.woff2"),
).toString("base64")
const geistMonoSemibold = readFileSync(
	join(ROOT, "node_modules/@fontsource/geist-mono/files/geist-mono-latin-600-normal.woff2"),
).toString("base64")
const spaceMonoBold = readFileSync(
	join(ROOT, "node_modules/@fontsource/space-mono/files/space-mono-latin-700-normal.woff2"),
).toString("base64")
const spaceMonoRegular = readFileSync(
	join(ROOT, "node_modules/@fontsource/space-mono/files/space-mono-latin-400-normal.woff2"),
).toString("base64")

// Big comparison sheet
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 900" width="1200" height="900">
  <defs>
    <style>
      @font-face {
        font-family: 'GeistMono';
        font-weight: 700;
        src: url(data:font/woff2;base64,${geistMonoBold}) format('woff2');
      }
      @font-face {
        font-family: 'GeistMono';
        font-weight: 600;
        src: url(data:font/woff2;base64,${geistMonoSemibold}) format('woff2');
      }
      @font-face {
        font-family: 'GeistMono';
        font-weight: 500;
        src: url(data:font/woff2;base64,${geistMonoMedium}) format('woff2');
      }
      @font-face {
        font-family: 'GeistMono';
        font-weight: 400;
        src: url(data:font/woff2;base64,${geistMonoRegular}) format('woff2');
      }
      @font-face {
        font-family: 'SpaceMono';
        font-weight: 700;
        src: url(data:font/woff2;base64,${spaceMonoBold}) format('woff2');
      }
      @font-face {
        font-family: 'SpaceMono';
        font-weight: 400;
        src: url(data:font/woff2;base64,${spaceMonoRegular}) format('woff2');
      }
    </style>
  </defs>

  <rect width="1200" height="900" fill="#f8f8f8"/>

  <!-- Geist Mono section -->
  <text x="40" y="50" font-family="sans-serif" font-size="18" fill="#999">GEIST MONO</text>
  <line x1="40" y1="60" x2="1160" y2="60" stroke="#ddd" stroke-width="1"/>

  <text x="40" y="120" font-family="'GeistMono'" font-size="80" font-weight="700" fill="#1a1a1a">palot</text>
  <text x="1060" y="120" font-family="sans-serif" font-size="14" fill="#aaa">700</text>

  <text x="40" y="200" font-family="'GeistMono'" font-size="80" font-weight="600" fill="#1a1a1a">palot</text>
  <text x="1060" y="200" font-family="sans-serif" font-size="14" fill="#aaa">600</text>

  <text x="40" y="280" font-family="'GeistMono'" font-size="80" font-weight="500" fill="#1a1a1a">palot</text>
  <text x="1060" y="280" font-family="sans-serif" font-size="14" fill="#aaa">500</text>

  <text x="40" y="360" font-family="'GeistMono'" font-size="80" font-weight="400" fill="#1a1a1a">palot</text>
  <text x="1060" y="360" font-family="sans-serif" font-size="14" fill="#aaa">400</text>

  <!-- Split versions -->
  <text x="40" y="420" font-family="sans-serif" font-size="18" fill="#999">GEIST MONO — SPLIT TREATMENTS</text>
  <line x1="40" y1="430" x2="1160" y2="430" stroke="#ddd" stroke-width="1"/>

  <text x="40" y="500" font-family="'GeistMono'" font-size="80" fill="#1a1a1a">
    <tspan font-weight="700">code</tspan><tspan font-weight="400" fill="#888">deck</tspan>
  </text>
  <text x="1060" y="500" font-family="sans-serif" font-size="14" fill="#aaa">700/400</text>

  <text x="40" y="580" font-family="'GeistMono'" font-size="80" fill="#1a1a1a">
    <tspan font-weight="600">code</tspan><tspan font-weight="400" fill="#888">deck</tspan>
  </text>
  <text x="1060" y="580" font-family="sans-serif" font-size="14" fill="#aaa">600/400</text>

  <!-- Space Mono for comparison -->
  <text x="40" y="650" font-family="sans-serif" font-size="18" fill="#999">SPACE MONO (comparison)</text>
  <line x1="40" y1="660" x2="1160" y2="660" stroke="#ddd" stroke-width="1"/>

  <text x="40" y="730" font-family="'SpaceMono'" font-size="80" font-weight="700" fill="#1a1a1a">palot</text>
  <text x="1060" y="730" font-family="sans-serif" font-size="14" fill="#aaa">700</text>

  <text x="40" y="820" font-family="'SpaceMono'" font-size="80" fill="#1a1a1a">
    <tspan font-weight="700">code</tspan><tspan font-weight="400" fill="#888">deck</tspan>
  </text>
  <text x="1060" y="820" font-family="sans-serif" font-size="14" fill="#aaa">700/400</text>

  <!-- Unique glyph markers - these characters differ between the fonts -->
  <text x="40" y="880" font-family="sans-serif" font-size="14" fill="#bbb">Distinguishing chars: "a e d k" — if these look identical across sections, fonts aren't loading</text>
</svg>`

const buf = await sharp(Buffer.from(svg)).resize(1200, 900).png().toBuffer()
writeFileSync(join(OUT, "font-comparison-sheet.png"), buf)
console.log("Done -> font-comparison-sheet.png")
