import { useLayoutEffect, useMemo } from "react"
import { type ColorScheme, getTheme, type ThemeDefinition, themes } from "../lib/themes"
import { usePersistedStore } from "../stores/persisted-store"

// ============================================================
// Selectors — pull raw primitives from the store so useMemo
// can derive data without creating wrapper objects (avoids
// Zustand + React 19 infinite render loops).
// ============================================================

const selectThemeId = (s: { theme: string }) => s.theme
const selectColorScheme = (s: { colorScheme: ColorScheme }) => s.colorScheme
const selectSetTheme = (s: { setTheme: (id: string) => void }) => s.setTheme
const selectSetColorScheme = (s: { setColorScheme: (s: ColorScheme) => void }) => s.setColorScheme

// ============================================================
// useThemeEffect — the single effect that synchronises the
// persisted store → <html> element classes & CSS variables.
//
// Must be called exactly once, in the root layout.
// ============================================================

/** Style element id for dynamic CSS var injection */
const STYLE_ID = "codedeck-theme-vars"

function getOrCreateStyleElement(): HTMLStyleElement {
	let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null
	if (!el) {
		el = document.createElement("style")
		el.id = STYLE_ID
		document.head.appendChild(el)
	}
	return el
}

/**
 * Resolve the effective dark/light mode class from a ColorScheme.
 */
function resolveColorSchemeClass(scheme: ColorScheme): "dark" | "light" {
	if (scheme === "system") {
		return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
	}
	return scheme
}

/**
 * Build a CSS text block that sets custom properties on :root and .dark.
 */
function buildThemeCss(theme: ThemeDefinition): string {
	const lightEntries = Object.entries(theme.cssVars.light)
	const darkEntries = Object.entries(theme.cssVars.dark)

	// Include density overrides in both light and dark
	const densityEntries = theme.density ? Object.entries(theme.density) : []

	// Include radius override
	const radiusEntry = theme.radius ? [["--radius", theme.radius] as const] : []

	const allLight = [...lightEntries, ...densityEntries, ...radiusEntry]
	const allDark = [...darkEntries, ...densityEntries, ...radiusEntry]

	if (allLight.length === 0 && allDark.length === 0) return ""

	let css = ""
	if (allLight.length > 0) {
		css += `:root {\n${allLight.map(([k, v]) => `  ${k}: ${v};`).join("\n")}\n}\n`
	}
	if (allDark.length > 0) {
		css += `.dark {\n${allDark.map(([k, v]) => `  ${k}: ${v};`).join("\n")}\n}\n`
	}
	return css
}

export function useThemeEffect() {
	const themeId = usePersistedStore(selectThemeId)
	const colorScheme = usePersistedStore(selectColorScheme)

	const theme = useMemo(() => getTheme(themeId), [themeId])

	// Synchronous layout effect — prevents flash of wrong theme
	useLayoutEffect(() => {
		const root = document.documentElement

		// ---- 1. Color scheme class (dark / light) ----
		const cls = resolveColorSchemeClass(colorScheme)
		root.classList.remove("dark", "light")
		root.classList.add(cls)

		// ---- 2. Theme class (theme-<id>) ----
		// Remove any existing theme-* classes
		for (const c of Array.from(root.classList)) {
			if (c.startsWith("theme-")) root.classList.remove(c)
		}
		if (theme.id !== "default") {
			root.classList.add(`theme-${theme.id}`)
		}

		// ---- 3. CSS variable overrides via <style> element ----
		const styleEl = getOrCreateStyleElement()
		styleEl.textContent = buildThemeCss(theme)

		// ---- 4. Font overrides ----
		if (theme.fonts?.sans) {
			root.style.setProperty("--font-sans", theme.fonts.sans)
		} else {
			root.style.removeProperty("--font-sans")
		}
		if (theme.fonts?.mono) {
			root.style.setProperty("--font-mono", theme.fonts.mono)
		} else {
			root.style.removeProperty("--font-mono")
		}

		// ---- 5. Listen for system color scheme changes ----
		if (colorScheme === "system") {
			const mq = window.matchMedia("(prefers-color-scheme: dark)")
			const handler = (e: MediaQueryListEvent) => {
				root.classList.remove("dark", "light")
				root.classList.add(e.matches ? "dark" : "light")
			}
			mq.addEventListener("change", handler)
			return () => mq.removeEventListener("change", handler)
		}
	}, [theme, colorScheme])
}

// ============================================================
// Convenience hooks for components (command palette, etc.)
// ============================================================

/** Current theme definition (derived). */
export function useCurrentTheme(): ThemeDefinition {
	const themeId = usePersistedStore(selectThemeId)
	return useMemo(() => getTheme(themeId), [themeId])
}

/** Current color scheme preference. */
export function useColorScheme(): ColorScheme {
	return usePersistedStore(selectColorScheme)
}

/** All available themes. */
export function useAvailableThemes(): ThemeDefinition[] {
	return themes
}

/** Set the active theme by id. */
export function useSetTheme(): (id: string) => void {
	return usePersistedStore(selectSetTheme)
}

/** Set the color scheme. */
export function useSetColorScheme(): (scheme: ColorScheme) => void {
	return usePersistedStore(selectSetColorScheme)
}
