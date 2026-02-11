import { cn } from "@palot/ui/lib/utils"
import { Popover as PopoverPrimitive } from "radix-ui"
import type * as React from "react"
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react"
import { ScrollArea } from "./scroll-area"

// ============================================================
// Context — shared open/search state
// ============================================================

interface SearchableListPopoverContextValue {
	open: boolean
	setOpen: (open: boolean) => void
	search: string
	setSearch: (search: string) => void
}

const SearchableListPopoverContext = createContext<SearchableListPopoverContextValue | null>(null)

function useSearchableListPopover() {
	const ctx = useContext(SearchableListPopoverContext)
	if (!ctx) throw new Error("SearchableListPopover.* must be used within <SearchableListPopover>")
	return ctx
}

// ============================================================
// Root — manages popover + search state
// ============================================================

interface SearchableListPopoverProps {
	children: ReactNode
	open?: boolean
	onOpenChange?: (open: boolean) => void
}

function SearchableListPopover({
	children,
	open: controlledOpen,
	onOpenChange,
}: SearchableListPopoverProps) {
	const [internalOpen, setInternalOpen] = useState(false)
	const open = controlledOpen ?? internalOpen

	const setOpen = useCallback(
		(next: boolean) => {
			if (controlledOpen === undefined) setInternalOpen(next)
			onOpenChange?.(next)
		},
		[controlledOpen, onOpenChange],
	)

	const [search, setSearch] = useState("")

	// Reset search when popover closes
	useEffect(() => {
		if (!open) setSearch("")
	}, [open])

	return (
		<SearchableListPopoverContext.Provider value={{ open, setOpen, search, setSearch }}>
			<PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
				{children}
			</PopoverPrimitive.Root>
		</SearchableListPopoverContext.Provider>
	)
}

// ============================================================
// Trigger
// ============================================================

function SearchableListPopoverTrigger({
	className,
	...props
}: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
	return (
		<PopoverPrimitive.Trigger
			data-slot="searchable-list-popover-trigger"
			className={className}
			{...props}
		/>
	)
}

// ============================================================
// Content — the popover panel with proper sizing
// ============================================================

interface SearchableListPopoverContentProps
	extends Omit<React.ComponentProps<typeof PopoverPrimitive.Content>, "children"> {
	children: ReactNode
	/** Width class, defaults to "w-72" */
	width?: string
}

function SearchableListPopoverContent({
	children,
	className,
	width = "w-72",
	align = "end",
	side = "top",
	...props
}: SearchableListPopoverContentProps) {
	return (
		<PopoverPrimitive.Portal>
			<PopoverPrimitive.Content
				data-slot="searchable-list-popover-content"
				align={align}
				side={side}
				sideOffset={4}
				className={cn(
					"bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 origin-(--radix-popover-content-transform-origin) overflow-hidden rounded-md border p-0 shadow-md outline-hidden",
					width,
					className,
				)}
				onOpenAutoFocus={(e) => e.preventDefault()}
				{...props}
			>
				{children}
			</PopoverPrimitive.Content>
		</PopoverPrimitive.Portal>
	)
}

// ============================================================
// Search — auto-focused search input
// ============================================================

interface SearchableListPopoverSearchProps {
	placeholder?: string
	icon?: ReactNode
	className?: string
}

function SearchableListPopoverSearch({
	placeholder = "Search...",
	icon,
	className,
}: SearchableListPopoverSearchProps) {
	const { open, search, setSearch } = useSearchableListPopover()
	const inputRef = useRef<HTMLInputElement>(null)

	useEffect(() => {
		if (open) {
			const timer = setTimeout(() => inputRef.current?.focus(), 0)
			return () => clearTimeout(timer)
		}
	}, [open])

	return (
		<div className={cn("flex items-center border-b px-3 py-2", className)}>
			{icon && <span className="mr-2 flex shrink-0 text-muted-foreground">{icon}</span>}
			<input
				ref={inputRef}
				type="text"
				value={search}
				onChange={(e) => setSearch(e.target.value)}
				placeholder={placeholder}
				className="h-6 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
			/>
		</div>
	)
}

// ============================================================
// List — scrollable container with proper max-height
// ============================================================

interface SearchableListPopoverListProps {
	children: ReactNode
	className?: string
	/** Max height class, defaults to "max-h-64" */
	maxHeight?: string
}

function SearchableListPopoverList({
	children,
	className,
	maxHeight = "max-h-64",
}: SearchableListPopoverListProps) {
	return (
		<ScrollArea
			className={cn(
				"overflow-hidden [&>[data-radix-scroll-area-viewport]]:max-h-[inherit]",
				maxHeight,
				className,
			)}
		>
			{children}
		</ScrollArea>
	)
}

// ============================================================
// Group — section with a sticky header
// ============================================================

interface SearchableListPopoverGroupProps {
	label: string
	children: ReactNode
	className?: string
}

function SearchableListPopoverGroup({
	label,
	children,
	className,
}: SearchableListPopoverGroupProps) {
	return (
		<div className={className}>
			<div className="sticky top-0 z-10 border-b bg-popover px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
				{label}
			</div>
			{children}
		</div>
	)
}

// ============================================================
// Item — a single selectable row
// ============================================================

interface SearchableListPopoverItemProps {
	children: ReactNode
	onSelect: () => void
	isActive?: boolean
	className?: string
}

function SearchableListPopoverItem({
	children,
	onSelect,
	isActive,
	className,
}: SearchableListPopoverItemProps) {
	return (
		<button
			type="button"
			onClick={onSelect}
			className={cn(
				"flex w-full min-w-0 items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-muted",
				isActive && "bg-accent text-accent-foreground",
				className,
			)}
		>
			{children}
		</button>
	)
}

// ============================================================
// Empty — fallback when list is empty
// ============================================================

interface SearchableListPopoverEmptyProps {
	children?: ReactNode
	className?: string
}

function SearchableListPopoverEmpty({ children, className }: SearchableListPopoverEmptyProps) {
	return (
		<div className={cn("py-4 text-center text-sm text-muted-foreground", className)}>
			{children ?? "No results found"}
		</div>
	)
}

// ============================================================
// Hook — expose search value for consumer filtering
// ============================================================

function useSearchableListPopoverSearch() {
	const { search } = useSearchableListPopover()
	return search
}

// ============================================================
// Exports
// ============================================================

export {
	SearchableListPopover,
	SearchableListPopoverTrigger,
	SearchableListPopoverContent,
	SearchableListPopoverSearch,
	SearchableListPopoverList,
	SearchableListPopoverGroup,
	SearchableListPopoverItem,
	SearchableListPopoverEmpty,
	useSearchableListPopoverSearch,
}
