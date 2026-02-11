import { useAppBarContent } from "./app-bar-context"

// Height of the app bar in pixels — used as CSS variable
export const APP_BAR_HEIGHT = 46

/**
 * Detect whether we're running inside Electron (preload injects `window.palot`).
 */
function isElectron(): boolean {
	return typeof window !== "undefined" && "palot" in window
}

export function AppBar() {
	const pageContent = useAppBarContent()

	return (
		<div
			data-slot="app-bar"
			className="relative z-30 flex shrink-0 items-center border-b border-border/50 pl-4 pr-3 transition-[padding-left] duration-250 ease-in-out group-data-[state=collapsed]/sidebar-wrapper:pl-[var(--window-controls-inset)]"
			style={{
				height: APP_BAR_HEIGHT,
				// Make entire bar draggable on Electron (title bar replacement)
				// @ts-expect-error -- vendor-prefixed CSS property
				WebkitAppRegion: isElectron() ? "drag" : undefined,
			}}
		>
			{/* ===== Page content (via portal) ===== */}
			<div className="relative flex h-full min-w-0 flex-1 items-center">{pageContent}</div>
		</div>
	)
}
