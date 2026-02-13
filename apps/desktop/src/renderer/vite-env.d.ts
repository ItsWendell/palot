/** Vite-specific extensions to ImportMeta (renderer process only). */
interface ImportMeta {
	glob<T = Record<string, unknown>>(pattern: string, opts?: { query?: string; eager?: boolean }): T
}
