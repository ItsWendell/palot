import { useStickToBottomContext } from "@palot/ui/components/ai-elements/conversation"
import { ArrowUpToLineIcon } from "lucide-react"
import type React from "react"
import {
	useCallback,
	useEffect,
	useImperativeHandle,
	useLayoutEffect,
	useRef,
	useState,
} from "react"

export interface ScrollHandle {
	scrollToBottom: (behavior?: "instant" | "smooth") => void
	/** Returns the current scrollHeight of the scroll container. */
	getScrollHeight: () => number
	/** Smoothly scrolls the container to a specific scrollTop value. */
	scrollToPosition: (top: number) => void
}

/**
 * Forces an instant scroll when session content finishes loading.
 */
export function ScrollOnLoad({ loading, sessionId }: { loading: boolean; sessionId: string }) {
	const { scrollToBottom } = useStickToBottomContext()
	const prevLoadingRef = useRef(loading)
	const prevSessionRef = useRef(sessionId)

	useLayoutEffect(() => {
		const wasLoading = prevLoadingRef.current
		const sessionChanged = prevSessionRef.current !== sessionId
		prevLoadingRef.current = loading
		prevSessionRef.current = sessionId

		if ((wasLoading && !loading) || (sessionChanged && !loading)) {
			scrollToBottom("instant")
		}
	}, [loading, sessionId, scrollToBottom])

	return null
}

/**
 * Exposes StickToBottom imperative helpers to parent components.
 */
export function ScrollBridge({ scrollRef }: { scrollRef: React.RefObject<ScrollHandle | null> }) {
	const ctx = useStickToBottomContext()
	useImperativeHandle(
		scrollRef,
		() => ({
			scrollToBottom: (behavior?: "instant" | "smooth") => {
				ctx.scrollToBottom(behavior ?? "smooth")
			},
			getScrollHeight: () => ctx.scrollRef.current?.scrollHeight ?? 0,
			scrollToPosition: (top: number) => {
				ctx.scrollRef.current?.scrollTo({ top, behavior: "smooth" })
			},
		}),
		[ctx],
	)
	return null
}

/**
 * Shows a temporary affordance to jump to where the latest assistant response
 * began after the agent finishes working.
 */
export function ScrollToResponseStart({
	isWorking,
	scrollRef,
}: {
	isWorking: boolean
	scrollRef: React.RefObject<ScrollHandle | null>
}) {
	const [visible, setVisible] = useState(false)
	const prevWorkingRef = useRef(isWorking)
	const savedScrollTopRef = useRef(0)

	useEffect(() => {
		const wasWorking = prevWorkingRef.current
		prevWorkingRef.current = isWorking

		if (!wasWorking && isWorking) {
			const handle = scrollRef.current
			if (handle) {
				savedScrollTopRef.current = Math.max(0, handle.getScrollHeight() - 80)
			}
		}

		if (wasWorking && !isWorking) {
			setVisible(true)
		}

		if (isWorking) {
			setVisible(false)
		}
	}, [isWorking, scrollRef])

	useEffect(() => {
		if (!visible) return
		const timer = setTimeout(() => setVisible(false), 8000)
		return () => clearTimeout(timer)
	}, [visible])

	const handleClick = useCallback(() => {
		scrollRef.current?.scrollToPosition(savedScrollTopRef.current)
		setVisible(false)
	}, [scrollRef])

	if (!visible) return null

	return (
		<button
			type="button"
			onClick={handleClick}
			className="absolute bottom-14 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground shadow-md transition-colors hover:bg-muted hover:text-foreground"
		>
			<ArrowUpToLineIcon className="size-3" />
			<span>Jump to start of response</span>
		</button>
	)
}
