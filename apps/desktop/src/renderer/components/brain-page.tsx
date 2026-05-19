/**
 * BrainPage — browse and read .palot/brain/ files and search
 * persistent memories via Mem9.
 *
 * Shows a tab toggle between local brain files ("Files") and
 * semantic memory search ("Memories") when Mem9 is configured.
 */

import { cn } from "@palot/ui/lib/utils"
import { useNavigate } from "@tanstack/react-router"
import {
	ArrowLeftIcon,
	BrainIcon,
	DatabaseIcon,
	FileTextIcon,
	Loader2Icon,
	SearchIcon,
	XIcon,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { listBrainFiles, readBrainFile, searchBrainFiles, mem9Search, mem9Status } from "../services/backend"

type Tab = "files" | "memories"

interface BrainFile {
	slug: string
	title: string
}

interface SearchResult {
	slug: string
	excerpt: string
	matchCount: number
}

interface MemoryResult {
	id: string
	content: string
	source?: string | null
	tags?: string[] | null
	score?: number
	created_at: string
	relative_age?: string
}

const TITLE_OVERRIDES: Record<string, string> = {
	readme: "README",
	"run-history": "Run History",
	"coding-conventions": "Coding Conventions",
	"file-ownership": "File Ownership",
}

function deriveTitle(slug: string): string {
	return TITLE_OVERRIDES[slug] ?? slug.charAt(0).toUpperCase() + slug.slice(1).replace(/-/g, " ")
}

export function BrainPage() {
	const navigate = useNavigate()
	const [tab, setTab] = useState<Tab>("files")
	const [files, setFiles] = useState<BrainFile[]>([])
	const [loading, setLoading] = useState(true)
	const [selected, setSelected] = useState<string | null>(null)
	const [content, setContent] = useState<string | null>(null)
	const [contentLoading, setContentLoading] = useState(false)
	const [searchQuery, setSearchQuery] = useState("")
	const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null)

	// Mem9 state
	const [mem9Configured, setMem9Configured] = useState(false)
	const [memories, setMemories] = useState<MemoryResult[]>([])
	const [memoriesLoading, setMemoriesLoading] = useState(false)
	const [memSearchQuery, setMemSearchQuery] = useState("")
	const [selectedMemory, setSelectedMemory] = useState<MemoryResult | null>(null)

	// Check Mem9 status on mount
	useEffect(() => {
		mem9Status()
			.then((s) => setMem9Configured(s.configured))
			.catch(() => setMem9Configured(false))
	}, [])

	useEffect(() => {
		if (tab !== "files") return
		let cancelled = false
		setLoading(true)
		listBrainFiles()
			.then((slugs) => {
				if (!cancelled) setFiles(slugs.map((s) => ({ slug: s, title: deriveTitle(s) })))
			})
			.catch(() => { if (!cancelled) setFiles([]) })
			.finally(() => { if (!cancelled) setLoading(false) })
		return () => { cancelled = true }
	}, [tab])

	const handleSelect = useCallback(async (slug: string) => {
		if (selected === slug) {
			setSelected(null)
			setContent(null)
			return
		}
		setSelected(slug)
		setContentLoading(true)
		try {
			const text = await readBrainFile(slug)
			setContent(text)
		} catch {
			setContent("(failed to load)")
		} finally {
			setContentLoading(false)
		}
	}, [selected])

	const handleSearch = useCallback(async () => {
		if (!searchQuery.trim()) {
			setSearchResults(null)
			return
		}
		try {
			const results = await searchBrainFiles(searchQuery)
			setSearchResults(results)
		} catch {
			setSearchResults([])
		}
	}, [searchQuery])

	// Debounced file search
	useEffect(() => {
		if (tab !== "files") return
		if (!searchQuery.trim()) {
			setSearchResults(null)
			return
		}
		const timer = setTimeout(() => {
			handleSearch()
		}, 300)
		return () => clearTimeout(timer)
	}, [searchQuery, handleSearch, tab])

	// Mem9 search handler
	const handleMemSearch = useCallback(async () => {
		if (!memSearchQuery.trim()) return
		setMemoriesLoading(true)
		setSelectedMemory(null)
		try {
			const result = await mem9Search({ q: memSearchQuery, limit: 20 })
			setMemories(result.memories as MemoryResult[])
		} catch {
			setMemories([])
		} finally {
			setMemoriesLoading(false)
		}
	}, [memSearchQuery])

	const handleMemorySelect = useCallback((mem: MemoryResult) => {
		setSelectedMemory((prev) => (prev?.id === mem.id ? null : mem))
	}, [])

	const handleBack = useCallback(() => {
		navigate({ to: "/" })
	}, [navigate])

	// Build file list, optionally filtered by search
	const displayFiles = useMemo(() => {
		if (searchResults) {
			const resultSlugs = new Set(searchResults.map((r) => r.slug))
			return files.filter((f) => resultSlugs.has(f.slug))
		}
		return files
	}, [files, searchResults])

	return (
		<div className="flex h-full flex-col">
			{/* Header */}
			<div className="flex items-center gap-3 border-b border-border px-5 py-3">
				<button
					type="button"
					onClick={handleBack}
					className="rounded-md p-1 text-muted-foreground hover:text-foreground transition-colors"
					aria-label="Back"
				>
					<ArrowLeftIcon className="size-4" />
				</button>
				<div className="min-w-0 flex-1">
					<h1 className="text-sm font-semibold text-foreground">Brain</h1>
					<p className="text-[11px] text-muted-foreground/60">
						Project context files (.palot/brain/)
					</p>
				</div>
			</div>

			{/* Tabs */}
			<div className="flex items-center gap-2 border-b border-border/30 px-5 py-2">
				<button
					type="button"
					onClick={() => setTab("files")}
					className={cn(
						"rounded-md px-3 py-1 text-xs font-medium transition-colors",
						tab === "files"
							? "bg-muted/20 text-foreground"
							: "text-muted-foreground/60 hover:text-foreground/80",
					)}
				>
					Files
				</button>
				{mem9Configured && (
					<button
						type="button"
						onClick={() => setTab("memories")}
						className={cn(
							"rounded-md px-3 py-1 text-xs font-medium transition-colors",
							tab === "memories"
								? "bg-muted/20 text-foreground"
								: "text-muted-foreground/60 hover:text-foreground/80",
						)}
					>
						Memories
					</button>
				)}
			</div>

			{/* Content */}
			<div className="min-h-0 flex-1 overflow-y-auto">
				{tab === "files" ? (
					<>
						{/* Search bar */}
						<div className="border-b border-border/30 px-5 py-2.5">
							<div className="relative">
								<SearchIcon className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/40" aria-hidden="true" />
								<input
									type="text"
									value={searchQuery}
									onChange={(e) => setSearchQuery(e.target.value)}
									placeholder="Search brain files..."
									className="w-full rounded-md border border-input bg-transparent py-1.5 pl-8 pr-8 text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring"
								/>
								{searchQuery && (
									<button
										type="button"
										onClick={() => setSearchQuery("")}
										className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-muted-foreground"
									>
										<XIcon className="size-3.5" />
									</button>
								)}
							</div>
						</div>

						{/* File list */}
						{loading ? (
							<div className="flex items-center justify-center py-10">
								<Loader2Icon className="size-4 animate-spin text-muted-foreground/50" />
							</div>
						) : displayFiles.length === 0 ? (
							<div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
								<BrainIcon className="size-8 text-muted-foreground/30" aria-hidden="true" />
								<p className="text-xs text-muted-foreground/60">
									{searchResults ? "No matches found" : "No brain files found"}
								</p>
								<p className="text-[10px] text-muted-foreground/40">
									{searchResults
										? "Try a different search query"
										: "Brain files are auto-generated in .palot/brain/"}
								</p>
							</div>
						) : (
							<div className="divide-y divide-border/30">
								{searchResults && searchResults.length > 0 && (
									<div className="px-5 py-2 text-[10px] text-muted-foreground/50">
										{searchResults.length} file{searchResults.length !== 1 ? "s" : ""} match
										{searchResults.some((r) => r.matchCount > 0) && (
											<>
												{" · "}
												{searchResults.reduce((sum, r) => sum + r.matchCount, 0)} total matches
											</>
										)}
									</div>
								)}

								{displayFiles.map((file) => {
									const isSelected = selected === file.slug
									const searchMatch = searchResults?.find((r) => r.slug === file.slug)
									return (
										<button
											key={file.slug}
											type="button"
											onClick={() => handleSelect(file.slug)}
											className={cn(
												"w-full text-left transition-colors hover:bg-muted/20",
												isSelected && "bg-muted/15",
											)}
										>
											<div className="px-5 py-3">
												<div className="flex items-center gap-2">
													<FileTextIcon className="size-3.5 shrink-0 text-muted-foreground/50" aria-hidden="true" />
													<span className="text-sm font-medium text-foreground/85">{file.title}</span>
													<span className="text-[10px] text-muted-foreground/40">.md</span>
													{searchMatch && (
														<span className="ml-auto text-[10px] text-muted-foreground/50">
															{searchMatch.matchCount} match{searchMatch.matchCount !== 1 ? "es" : ""}
														</span>
													)}
												</div>

												{searchMatch && !isSelected && (
													<p className="mt-1 text-[11px] text-muted-foreground/60 line-clamp-2">
														{searchMatch.excerpt}
													</p>
												)}
											</div>

											{isSelected && (
												<div className="border-t border-border/20 bg-muted/10 px-5 py-3">
													{contentLoading ? (
														<div className="flex items-center justify-center py-6">
															<Loader2Icon className="size-3.5 animate-spin text-muted-foreground/50" />
														</div>
													) : content !== null ? (
														<div className="rounded-md border border-border/20 bg-muted/20 p-3">
															<pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-foreground/80">
																{content}
															</pre>
														</div>
													) : (
														<p className="text-xs text-muted-foreground/60">(empty)</p>
													)}
													{content && (
														<p className="mt-2 text-[10px] text-muted-foreground/40">
															{content.length.toLocaleString()} chars
														</p>
													)}
												</div>
											)}
										</button>
									)
								})}
							</div>
						)}
					</>
				) : (
					// === MEMORIES TAB ===
					<div className="p-4">
						<div className="relative mb-4">
							<SearchIcon
								className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/40"
								aria-hidden="true"
							/>
							<input
								type="text"
								value={memSearchQuery}
								onChange={(e) => setMemSearchQuery(e.target.value)}
								onKeyDown={(e) => { if (e.key === "Enter") handleMemSearch() }}
								placeholder="Search memories..."
								className="w-full rounded-md border border-input bg-transparent py-2 pl-9 pr-8 text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring"
							/>
							{memSearchQuery && (
								<button
									type="button"
									onClick={() => {
										setMemSearchQuery("")
										setMemories([])
										setSelectedMemory(null)
									}}
									className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-muted-foreground"
								>
									<XIcon className="size-3.5" />
								</button>
							)}
						</div>

						{memoriesLoading ? (
							<div className="flex items-center justify-center py-10">
								<Loader2Icon className="size-4 animate-spin text-muted-foreground/50" />
							</div>
						) : memories.length === 0 && memSearchQuery ? (
							<div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
								<DatabaseIcon className="size-8 text-muted-foreground/30" aria-hidden="true" />
								<p className="text-xs text-muted-foreground/60">No memories match your query</p>
							</div>
						) : memories.length === 0 ? (
							<div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
								<DatabaseIcon className="size-8 text-muted-foreground/30" aria-hidden="true" />
								<p className="text-xs text-muted-foreground/60">
									Search agent outputs stored in persistent memory
								</p>
							</div>
						) : (
							<div className="space-y-2">
								{memories.map((mem) => {
									const isSelected = selectedMemory?.id === mem.id
									return (
										<button
											key={mem.id}
											type="button"
											onClick={() => handleMemorySelect(mem)}
											className={cn(
												"w-full text-left rounded-md border transition-colors",
												isSelected
													? "border-sky-400/30 bg-sky-400/10"
													: "border-border/20 hover:border-border/40",
											)}
										>
											<div className="px-3 py-2">
												<div className="flex items-center gap-2">
													<span className="text-xs font-medium text-foreground/85">
														{mem.id.slice(0, 8)}
													</span>
													{mem.score != null && (
														<span className="text-[10px] text-muted-foreground/50">
															{mem.score.toFixed(2)}
														</span>
													)}
													{mem.source && (
														<span className="truncate text-[10px] text-muted-foreground/50">
															{mem.source}
														</span>
													)}
													{mem.relative_age && (
														<span className="ml-auto text-[10px] text-muted-foreground/40">
															{mem.relative_age}
														</span>
													)}
												</div>
												{mem.tags && mem.tags.length > 0 && (
													<div className="mt-1 flex flex-wrap gap-1">
														{mem.tags.slice(0, 4).map((tag) => (
															<span
																key={tag}
																className="rounded-full border border-border/20 px-1.5 py-0.5 text-[9px] bg-muted/10 text-muted-foreground/60"
															>
																{tag}
															</span>
														))}
													</div>
												)}
												<p className="mt-1 text-[11px] text-muted-foreground/70 line-clamp-2">
													{mem.content.slice(0, 200)}
													{mem.content.length > 200 ? "…" : ""}
												</p>
											</div>

											{isSelected && (
												<div className="border-t border-border/20 bg-muted/10 px-3 py-2">
													<div className="max-h-64 overflow-y-auto rounded-md border border-border/20 bg-muted/20 p-2">
														<pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-foreground/80">
															{mem.content}
														</pre>
													</div>
												</div>
											)}
										</button>
									)
								})}
							</div>
						)}
					</div>
				)}
			</div>
		</div>
	)
}
