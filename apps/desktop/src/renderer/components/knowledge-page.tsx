/**
 * KnowledgePage — browse and read agent knowledge sources (.agents/knowledge/*.md)
 * and search persistent memories via Mem9.
 *
 * Shows a tab toggle between local knowledge files ("Sources") and
 * semantic memory search ("Memories") when Mem9 is configured.
 */

import { cn } from "@palot/ui/lib/utils"
import { useNavigate } from "@tanstack/react-router"
import {
	ArrowLeftIcon,
	BookOpenIcon,
	DatabaseIcon,
	Loader2Icon,
	SearchIcon,
	XIcon,
} from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import type { KnowledgeSource } from "../../shared/knowledge"
import { listKnowledgeSources, mem9Search, mem9Status } from "../services/backend"

type Tab = "sources" | "memories"

interface MemoryResult {
	id: string
	content: string
	source?: string | null
	tags?: string[] | null
	score?: number
	created_at: string
	relative_age?: string
}

export function KnowledgePage() {
	const navigate = useNavigate()
	const [tab, setTab] = useState<Tab>("sources")
	const [sources, setSources] = useState<KnowledgeSource[]>([])
	const [loading, setLoading] = useState(true)
	const [selected, setSelected] = useState<KnowledgeSource | null>(null)

	// Mem9 state
	const [mem9Configured, setMem9Configured] = useState(false)
	const [memories, setMemories] = useState<MemoryResult[]>([])
	const [memoriesLoading, setMemoriesLoading] = useState(false)
	const [searchQuery, setSearchQuery] = useState("")
	const [selectedMemory, setSelectedMemory] = useState<MemoryResult | null>(null)

	// Check Mem9 status on mount
	useEffect(() => {
		mem9Status()
			.then((s) => setMem9Configured(s.configured))
			.catch(() => setMem9Configured(false))
	}, [])

	// Load knowledge sources
	useEffect(() => {
		if (tab !== "sources") return
		let cancelled = false
		setLoading(true)
		listKnowledgeSources()
			.then((list) => {
				if (!cancelled) setSources(list.sort((a, b) => a.title.localeCompare(b.title)))
			})
			.catch(() => {
				if (!cancelled) setSources([])
			})
			.finally(() => {
				if (!cancelled) setLoading(false)
			})
		return () => {
			cancelled = true
		}
	}, [tab])

	const handleSelect = useCallback((source: KnowledgeSource) => {
		setSelected((prev) => (prev?.filename === source.filename ? null : source))
	}, [])

	const handleBack = useCallback(() => {
		navigate({ to: "/" })
	}, [navigate])

	const handleSearch = useCallback(async () => {
		if (!searchQuery.trim()) return
		setMemoriesLoading(true)
		setSelectedMemory(null)
		try {
			const result = await mem9Search({ q: searchQuery, limit: 20 })
			setMemories(result.memories as MemoryResult[])
		} catch {
			setMemories([])
		} finally {
			setMemoriesLoading(false)
		}
	}, [searchQuery])

	const handleMemorySelect = useCallback((mem: MemoryResult) => {
		setSelectedMemory((prev) => (prev?.id === mem.id ? null : mem))
	}, [])

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === "Enter") handleSearch()
		},
		[handleSearch],
	)

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
				<div>
					<h1 className="text-sm font-semibold text-foreground">Knowledge</h1>
					<p className="text-[11px] text-muted-foreground/60">
						Reference docs injected into agent prompts at spawn time
					</p>
				</div>
			</div>

			{/* Tabs */}
			<div className="flex items-center gap-2 border-b border-border/30 px-5 py-2">
				<button
					type="button"
					onClick={() => setTab("sources")}
					className={cn(
						"rounded-md px-3 py-1 text-xs font-medium transition-colors",
						tab === "sources"
							? "bg-muted/20 text-foreground"
							: "text-muted-foreground/60 hover:text-foreground/80",
					)}
				>
					Sources
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
				{tab === "sources" ? (
					// === SOURCES TAB ===
					loading ? (
						<div className="flex items-center justify-center py-10">
							<Loader2Icon className="size-4 animate-spin text-muted-foreground/50" />
						</div>
					) : sources.length === 0 ? (
						<div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
							<BookOpenIcon className="size-8 text-muted-foreground/30" aria-hidden="true" />
							<p className="text-xs text-muted-foreground/60">No knowledge sources found</p>
							<p className="text-[10px] text-muted-foreground/40">
								Add .md files with frontmatter to .agents/knowledge/
							</p>
						</div>
					) : (
						<div className="divide-y divide-border/30">
							{sources.map((source) => {
								const isSelected = selected?.filename === source.filename
								return (
									<button
										key={source.filename}
										type="button"
										onClick={() => handleSelect(source)}
										className={cn(
											"w-full text-left transition-colors hover:bg-muted/20",
											isSelected && "bg-muted/15",
										)}
									>
										<div className="px-5 py-3">
											<div className="flex items-center gap-2">
												<BookOpenIcon className="size-3.5 shrink-0 text-muted-foreground/50" aria-hidden="true" />
												<span className="text-sm font-medium text-foreground/85">{source.title}</span>
											</div>
											{source.description && (
												<p className="mt-1 text-xs text-muted-foreground/70 line-clamp-2">
													{source.description}
												</p>
											)}
											<div className="mt-1.5 flex items-center gap-2 text-[10px] text-muted-foreground/50">
												<span className="rounded-full border border-border/30 px-1.5 py-0.5">{source.source}</span>
												{source.tags
													?.split(",")
													.map((tag: string) => (
														<span
															key={tag.trim()}
															className="rounded-full border border-border/20 px-1.5 py-0.5 bg-muted/10"
														>
															{tag.trim()}
														</span>
													))}
												<span className="ml-auto">{source.updated}</span>
											</div>
										</div>

										{isSelected && (
											<div className="border-t border-border/20 bg-muted/10 px-5 py-3">
												<p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/50">
													Content
												</p>
												<div className="max-h-96 overflow-y-auto rounded-md border border-border/20 bg-muted/20 p-3">
													<pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-foreground/80">
														{source.prompt}
													</pre>
												</div>
												<p className="mt-2 text-[10px] text-muted-foreground/40">
													{source.prompt.length.toLocaleString()} chars
												</p>
											</div>
										)}
									</button>
								)
							})}
						</div>
					)
				) : (
					// === MEMORIES TAB ===
					<div className="p-4">
						{/* Search bar */}
						<div className="relative mb-4">
							<SearchIcon
								className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/40"
								aria-hidden="true"
							/>
							<input
								type="text"
								value={searchQuery}
								onChange={(e) => setSearchQuery(e.target.value)}
								onKeyDown={handleKeyDown}
								placeholder="Search memories..."
								className="w-full rounded-md border border-input bg-transparent py-2 pl-9 pr-8 text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring"
							/>
							{searchQuery && (
								<button
									type="button"
									onClick={() => {
										setSearchQuery("")
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
						) : memories.length === 0 && searchQuery ? (
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
