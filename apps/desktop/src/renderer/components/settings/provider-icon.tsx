/**
 * Provider logo icons sourced from models.dev (same source as OpenCode).
 * SVGs use `currentColor` so they adapt to the current theme.
 *
 * Falls back to a colored letter avatar when no logo is available.
 */

// ============================================================
// SVG loading via Vite glob import
// ============================================================

// Vite transforms this at compile time into static imports.
// Type declaration lives in renderer/vite-env.d.ts.
const svgModules = import.meta.glob("../../assets/provider-icons/*.svg", {
	query: "?raw",
	eager: true,
}) as Record<string, { default: string }>

/** Make SVGs responsive by removing fixed width/height and ensuring they fill their container */
function makeResponsive(svg: string): string {
	return svg
		.replace(/\s+width=["'][^"']*["']/g, "")
		.replace(/\s+height=["'][^"']*["']/g, "")
		.replace("<svg", '<svg width="100%" height="100%"')
}

/** Map of provider ID -> raw SVG string */
const SVG_MAP = new Map<string, string>()

for (const [path, mod] of Object.entries(svgModules)) {
	// Extract filename without extension: "../../assets/provider-icons/anthropic.svg" -> "anthropic"
	const match = path.match(/\/([^/]+)\.svg$/)
	if (match) {
		SVG_MAP.set(match[1], makeResponsive(mod.default))
	}
}

/** Fallback icon (sparkle) for providers without a logo */
const FALLBACK_SVG = SVG_MAP.get("synthetic")

// ============================================================
// Color palette for letter avatars (fallback)
// ============================================================

const AVATAR_COLORS = [
	"bg-blue-500/20 text-blue-400",
	"bg-purple-500/20 text-purple-400",
	"bg-green-500/20 text-green-400",
	"bg-amber-500/20 text-amber-400",
	"bg-rose-500/20 text-rose-400",
	"bg-cyan-500/20 text-cyan-400",
	"bg-indigo-500/20 text-indigo-400",
	"bg-emerald-500/20 text-emerald-400",
	"bg-orange-500/20 text-orange-400",
	"bg-pink-500/20 text-pink-400",
]

function hashString(str: string): number {
	let hash = 0
	for (let i = 0; i < str.length; i++) {
		hash = (hash << 5) - hash + str.charCodeAt(i)
		hash |= 0
	}
	return Math.abs(hash)
}

// ============================================================
// Component
// ============================================================

const SIZE_CLASSES = {
	sm: "size-7",
	md: "size-8",
	lg: "size-10",
} as const

interface ProviderIconProps {
	/** Provider ID (e.g. "anthropic", "openai") */
	id: string
	/** Provider display name (used for letter fallback) */
	name: string
	size?: "sm" | "md" | "lg"
	className?: string
}

export function ProviderIcon({ id, name, size = "md", className = "" }: ProviderIconProps) {
	const svg = SVG_MAP.get(id) ?? FALLBACK_SVG

	if (svg) {
		return (
			<div
				className={`flex shrink-0 items-center justify-center rounded-md ${SIZE_CLASSES[size]} ${className}`}
				aria-hidden="true"
				// biome-ignore lint/security/noDangerouslySetInnerHtml: trusted SVGs from models.dev
				dangerouslySetInnerHTML={{ __html: svg }}
			/>
		)
	}

	// Ultimate fallback: colored letter avatar
	const colorClass = AVATAR_COLORS[hashString(id) % AVATAR_COLORS.length]
	const letter = name.charAt(0).toUpperCase()
	const textSize = size === "sm" ? "text-xs" : "text-sm"

	return (
		<div
			className={`flex shrink-0 items-center justify-center rounded-md font-semibold ${SIZE_CLASSES[size]} ${textSize} ${colorClass} ${className}`}
			aria-hidden="true"
		>
			{letter}
		</div>
	)
}
