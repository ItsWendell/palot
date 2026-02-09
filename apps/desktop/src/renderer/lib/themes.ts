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
	cssVars: { light: {}, dark: {} },
	// Fonts, radius, density all come from globals.css defaults:
	//   --font-sans: "Inter", "Inter Variable", ...
	//   --font-mono: "IBM Plex Mono", ...
	//   --radius: 0.625rem (10px)
	//   --text-xs: 0.8125rem (13px)
	//   --text-sm: 0.9375rem (15px)
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
			"--popover": "#ffffff",
			"--popover-foreground": "#0d0d0d",
			"--primary": "#0d0d0d",
			"--primary-foreground": "#ffffff",
			"--secondary": "#f9f9f9",
			"--secondary-foreground": "#0d0d0d",
			"--muted": "#f9f9f9",
			"--muted-foreground": "#5d5d5d",
			"--accent": "#ededed",
			"--accent-foreground": "#0d0d0d",
			"--destructive": "#fa423e",
			"--destructive-foreground": "#ffffff",
			"--border": "#ededed",
			"--input": "#ededed",
			"--ring": "#0285ff",
			"--chart-1": "#0285ff",
			"--chart-2": "#04b84c",
			"--chart-3": "#fb6a22",
			"--chart-4": "#924ff7",
			"--chart-5": "#ffc300",
			"--sidebar": "#f9f9f9",
			"--sidebar-foreground": "#0d0d0d",
			"--sidebar-primary": "#0d0d0d",
			"--sidebar-primary-foreground": "#ffffff",
			"--sidebar-accent": "#ededed",
			"--sidebar-accent-foreground": "#0d0d0d",
			"--sidebar-border": "#ededed",
			"--sidebar-ring": "#0285ff",
			"--diff-addition": "#04b84c",
			"--diff-addition-foreground": "#00a240",
			"--diff-deletion": "#fa423e",
			"--diff-deletion-foreground": "#e02e2a",
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
			"--sidebar-accent": "#212121",
			"--sidebar-accent-foreground": "#ffffff",
			"--sidebar-border": "#2e2e2e",
			"--sidebar-ring": "#99ceff",
			"--diff-addition": "#40c977",
			"--diff-addition-foreground": "#40c977",
			"--diff-deletion": "#ff6764",
			"--diff-deletion-foreground": "#ff6764",
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
