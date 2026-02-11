// ============================================================
// Theme definitions for Codedeck
//
// Each theme defines CSS custom property overrides for light and
// dark modes plus optional font, radius, and density changes.
//
// Architecture follows shadcn/ui's convention:
//   - `:root` / `.dark` define the default theme (= OpenCode)
//   - Named themes (`.theme-<id>`) override the same variables
//   - `@theme inline` in globals.css bridges vars to Tailwind
//   - useThemeEffect applies classes + CSS vars to <html>
// ============================================================

/**
 * Color scheme preference.
 *  - "dark" / "light" — explicit
 *  - "system" — follows prefers-color-scheme
 */
export type ColorScheme = "dark" | "light" | "system"

/**
 * A theme definition. Every field except `id`, `name`, and
 * `cssVars` is optional — unset values inherit from defaults.
 */
export interface ThemeDefinition {
	/** Unique identifier, used as CSS class: `theme-<id>` */
	id: string
	/** Human-readable label shown in the command palette */
	name: string
	/** Optional description */
	description?: string

	/**
	 * CSS custom property overrides.  Only properties that differ
	 * from the default theme need to be listed.
	 */
	cssVars: {
		light: Record<string, string>
		dark: Record<string, string>
	}

	/**
	 * Font stack overrides.  Applied via
	 * `document.documentElement.style.setProperty("--font-sans", ...)`.
	 * If omitted the default theme fonts remain.
	 */
	fonts?: {
		sans?: string
		mono?: string
	}

	/**
	 * Base border-radius override.  Applied as `--radius`.
	 * Other radius tokens (sm/md/lg/xl) are derived from this.
	 */
	radius?: string

	/**
	 * Text size / density overrides. Applied as --text-xs, --text-sm etc.
	 * Themes like Codex use a tighter 13px base.
	 */
	density?: {
		"--text-xs"?: string
		"--text-xs--line-height"?: string
		"--text-sm"?: string
		"--text-sm--line-height"?: string
	}

	/**
	 * Glass transparency tuning. Only takes effect when the window has
	 * native transparency (liquid glass or vibrancy). Themes can adjust
	 * opacity per surface, blur intensity, or disable glass entirely.
	 *
	 * Values override the CSS custom properties defined in globals.css.
	 * Unset fields inherit the defaults.
	 */
	glass?: {
		/** Body background opacity (0–100). Default: 50 */
		bodyOpacity?: number
		/** Sidebar panel opacity (0–100). Default: 70 */
		sidebarOpacity?: number
		/** App bar / divider surface opacity (0–100). Default: 80 */
		surfaceOpacity?: number
		/** Floating panel opacity: popovers, dialogs, command palette (0–100). Default: 85 */
		elevatedOpacity?: number
		/** Card / inline panel opacity (0–100). Default: 92 */
		cardOpacity?: number
		/** Blur multiplier (1.0 = default, 0.5 = half, 2.0 = double). Default: 1.0 */
		blurScale?: number
		/** Disable glass for this theme entirely, forcing opaque even on macOS. Default: false */
		disabled?: boolean
	}
}

// ============================================================
// OpenCode theme (default) — 1:1 clone of OpenCode OC-1
//
// This is the default theme. The values in globals.css match
// exactly, so no CSS var overrides are needed — they are the
// baseline that other themes override.
//
// Key traits:
//   - Warm "smoke" grays (slight red/brown tint)
//   - Inter + IBM Plex Mono fonts
//   - 13px small / 15px base text
//   - Compact 10px border-radius
//   - Cobalt blue interactive accent (#034cff)
//   - Ember red destructive (#fc533a)
//   - Apple green success, Solaris yellow warning
//   - Font features: ss03 (Inter), ss01 (IBM Plex Mono)
// ============================================================

export const openCodeTheme: ThemeDefinition = {
	id: "default",
	name: "OpenCode",
	description: "Warm smoke grays, Inter + IBM Plex Mono — the OC-1 palette",
	cssVars: {
		light: {
			/* Light mode: lower glass opacities so wallpaper bleeds through white */
			"--glass-body": "35%",
			"--glass-sidebar": "38%",
			"--glass-elevated": "70%",
		},
		dark: {},
	},
	// Fonts, radius, density all come from globals.css defaults:
	//   --font-sans: "Inter", "Inter Variable", ...
	//   --font-mono: "IBM Plex Mono", ...
	//   --radius: 0.625rem (10px)
	//   --text-xs: 0.8125rem (13px)
	//   --text-sm: 0.9375rem (15px)
	glass: {
		bodyOpacity: 40,
		sidebarOpacity: 42,
		surfaceOpacity: 55,
		elevatedOpacity: 85,
		cardOpacity: 90,
	},
}

// ============================================================
// Codex theme — inspired by OpenAI Codex
//
// Key traits:
//   - Neutral (cool) grays instead of warm
//   - Blue accent for focus/links (#0285ff / #99ceff)
//   - System fonts (SF Pro on macOS) instead of Inter
//   - Larger border-radius (squircle aesthetic)
//   - Slightly tighter text density (13px base)
//   - Alpha-based borders in dark mode
// ============================================================

export const codexTheme: ThemeDefinition = {
	id: "codex",
	name: "Codex",
	description: "Cool neutrals with blue accent, inspired by OpenAI Codex",
	cssVars: {
		light: {
			"--background": "#ffffff",
			"--foreground": "#0d0d0d",
			"--card": "#ffffff",
			"--card-foreground": "#0d0d0d",
			"--popover": "#fcfcfc",
			"--popover-foreground": "#0d0d0d",
			"--primary": "#0d0d0d",
			"--primary-foreground": "#ffffff",
			"--secondary": "#f9f9f9",
			"--secondary-foreground": "#0d0d0d",
			"--muted": "#f9f9f9",
			"--muted-foreground": "#414141",
			"--accent": "#ededed",
			"--accent-foreground": "#0d0d0d",
			"--destructive": "#fa423e",
			"--destructive-foreground": "#ffffff",
			"--border": "#ededed",
			"--input": "#ededed",
			"--ring": "#0169cc",
			"--chart-1": "#0285ff",
			"--chart-2": "#04b84c",
			"--chart-3": "#fb6a22",
			"--chart-4": "#924ff7",
			"--chart-5": "#ffc300",
			"--sidebar": "#ffffff",
			"--sidebar-foreground": "#212121",
			"--sidebar-primary": "#0d0d0d",
			"--sidebar-primary-foreground": "#ffffff",
			"--sidebar-accent": "#99ceff",
			"--sidebar-accent-foreground": "#0d0d0d",
			"--sidebar-border": "#ededed",
			"--sidebar-ring": "#0169cc",
			"--diff-addition": "#04b84c",
			"--diff-addition-foreground": "#00a240",
			"--diff-deletion": "#fa423e",
			"--diff-deletion-foreground": "#e02e2a",
			/* Light mode: match Codex — single 50% white tint on body,
			   sidebar inherits (no separate tint), content card is solid */
			"--glass-body": "50%",
			"--glass-sidebar": "0%",
			"--glass-elevated": "0%",
			"--glass-sidebar-accent": "35%",
		},
		dark: {
			"--background": "#181818",
			"--foreground": "#ffffff",
			"--card": "#212121",
			"--card-foreground": "#ffffff",
			"--popover": "#282828",
			"--popover-foreground": "#ffffff",
			"--primary": "#ffffff",
			"--primary-foreground": "#0d0d0d",
			"--secondary": "#212121",
			"--secondary-foreground": "#ffffff",
			"--muted": "#282828",
			"--muted-foreground": "#afafaf",
			"--accent": "#282828",
			"--accent-foreground": "#ffffff",
			"--destructive": "#fa423e",
			"--destructive-foreground": "#ffffff",
			"--border": "#2e2e2e",
			"--input": "#2e2e2e",
			"--ring": "#99ceff",
			"--chart-1": "#339cff",
			"--chart-2": "#40c977",
			"--chart-3": "#ff8549",
			"--chart-4": "#ad7bf9",
			"--chart-5": "#ffd240",
			"--sidebar": "#0d0d0d",
			"--sidebar-foreground": "#ffffff",
			"--sidebar-primary": "#ffffff",
			"--sidebar-primary-foreground": "#0d0d0d",
			"--sidebar-accent": "#000e1a",
			"--sidebar-accent-foreground": "#ffffff",
			"--sidebar-border": "#0d0d0d",
			"--sidebar-ring": "#99ceff",
			"--diff-addition": "#40c977",
			"--diff-addition-foreground": "#40c977",
			"--diff-deletion": "#ff6764",
			"--diff-deletion-foreground": "#ff6764",
			/* Dark mode: nearly opaque elevated surfaces for readability */
			"--glass-elevated": "95%",
			"--glass-sidebar-accent": "35%",
		},
	},
	fonts: {
		sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
		mono: 'ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
	},
	radius: "0.75rem",
	density: {
		"--text-xs": "0.8125rem",
		"--text-xs--line-height": "1.0625rem",
		"--text-sm": "0.8125rem",
		"--text-sm--line-height": "1.25rem",
	},
	glass: {
		bodyOpacity: 38,
		sidebarOpacity: 18,
		surfaceOpacity: 55,
		cardOpacity: 88,
	},
}

// ============================================================
// Theme registry — add new themes here
// ============================================================

export const themes: ThemeDefinition[] = [openCodeTheme, codexTheme]

/**
 * Look up a theme by id.  Falls back to default if not found.
 */
export function getTheme(id: string): ThemeDefinition {
	return themes.find((t) => t.id === id) ?? openCodeTheme
}
