import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import pngToIco from "png-to-ico"
import sharp from "sharp"

const ROOT = join(import.meta.dir, "..")
const SVG_PATH = join(ROOT, "docs/logo-drafts/icon-final.svg")
const RESOURCES_DIR = join(ROOT, "apps/desktop/resources")
const PUBLIC_DIR = join(ROOT, "apps/desktop/src/renderer/public")

const svg = readFileSync(SVG_PATH)

// Sizes needed:
// - 1024x1024 PNG: electron-builder macOS/Linux (resources/icon.png)
// - 512x512 PNG: fallback
// - 256x256 PNG: Windows ICO largest layer
// - 128x128 PNG: ICO layer
// - 64x64 PNG: ICO layer
// - 48x48 PNG: ICO layer
// - 32x32 PNG: ICO layer, favicon
// - 16x16 PNG: ICO layer, favicon
// - favicon.ico: 16, 32, 48 combined
// - favicon.png: 32x32

async function generate() {
	console.log("Generating icon assets from SVG...")

	// Generate 1024px master PNG
	const png1024 = await sharp(svg, { density: 300 }).resize(1024, 1024).png().toBuffer()

	// Write main app icon
	writeFileSync(join(RESOURCES_DIR, "icon.png"), png1024)
	console.log("  -> resources/icon.png (1024x1024)")

	// Generate all ICO sizes from the 1024 master
	const sizes = [256, 128, 64, 48, 32, 16]
	const icoBuffers: Buffer[] = []

	for (const size of sizes) {
		const buf = await sharp(png1024).resize(size, size).png().toBuffer()
		icoBuffers.push(buf)
		console.log(`  -> Generated ${size}x${size} for ICO`)
	}

	// Generate ICO file
	const icoBuffer = await pngToIco(icoBuffers)
	writeFileSync(join(RESOURCES_DIR, "icon.ico"), icoBuffer)
	console.log("  -> resources/icon.ico")

	// Generate favicon.png (32x32)
	const favicon32 = await sharp(png1024).resize(32, 32).png().toBuffer()
	writeFileSync(join(PUBLIC_DIR, "favicon.png"), favicon32)
	console.log("  -> renderer/favicon.png (32x32)")

	// Generate favicon.ico (16, 32, 48)
	const faviconIcoBuffers = [
		await sharp(png1024).resize(48, 48).png().toBuffer(),
		await sharp(png1024).resize(32, 32).png().toBuffer(),
		await sharp(png1024).resize(16, 16).png().toBuffer(),
	]
	const faviconIco = await pngToIco(faviconIcoBuffers)
	writeFileSync(join(PUBLIC_DIR, "favicon.ico"), faviconIco)
	console.log("  -> renderer/favicon.ico")

	// Also save the SVG itself to resources for reference
	writeFileSync(join(RESOURCES_DIR, "icon.svg"), svg)
	console.log("  -> resources/icon.svg (source)")

	console.log("\nDone! All icon assets generated.")
}

generate().catch(console.error)
