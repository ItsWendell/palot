import { useCallback, useEffect, useRef, useState } from "react"

/**
 * React port of OpenCode's createAutoScroll hook.
 * Follows streaming content to bottom, pauses on user scroll-up,
 * resumes when user scrolls back to bottom.
 */
export function useAutoScroll(working: boolean) {
	const scrollRef = useRef<HTMLDivElement>(null)
	const contentRef = useRef<HTMLDivElement>(null)
	const [userScrolled, setUserScrolled] = useState(false)
	const autoRef = useRef<{ top: number; time: number } | null>(null)
	const settlingRef = useRef(false)
	const settleTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
	const autoTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

	const BOTTOM_THRESHOLD = 10

	const distanceFromBottom = useCallback((el: HTMLElement) => {
		return el.scrollHeight - el.clientHeight - el.scrollTop
	}, [])

	const canScroll = useCallback((el: HTMLElement) => {
		return el.scrollHeight - el.clientHeight > 1
	}, [])

	const markAuto = useCallback((el: HTMLElement) => {
		autoRef.current = {
			top: Math.max(0, el.scrollHeight - el.clientHeight),
			time: Date.now(),
		}
		if (autoTimerRef.current) clearTimeout(autoTimerRef.current)
		autoTimerRef.current = setTimeout(() => {
			autoRef.current = null
		}, 250)
	}, [])

	const isAuto = useCallback((el: HTMLElement) => {
		const a = autoRef.current
		if (!a) return false
		if (Date.now() - a.time > 250) {
			autoRef.current = null
			return false
		}
		return Math.abs(el.scrollTop - a.top) < 2
	}, [])

	const scrollToBottom = useCallback(
		(force: boolean) => {
			const active = working || settlingRef.current
			if (!force && !active) return
			const el = scrollRef.current
			if (!el) return
			if (!force && userScrolled) return
			if (force && userScrolled) setUserScrolled(false)

			const distance = distanceFromBottom(el)
			if (distance < 2) return

			markAuto(el)
			el.scrollTop = el.scrollHeight
		},
		[working, userScrolled, distanceFromBottom, markAuto],
	)

	// Auto-scroll when working starts/stops
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentionally only fires on `working` changes (mirrors OpenCode's createAutoScroll)
	useEffect(() => {
		settlingRef.current = false
		if (settleTimerRef.current) clearTimeout(settleTimerRef.current)

		if (working) {
			if (!userScrolled) scrollToBottom(true)
			return
		}

		// Settling period after work stops
		settlingRef.current = true
		settleTimerRef.current = setTimeout(() => {
			settlingRef.current = false
		}, 300)

		return () => {
			if (settleTimerRef.current) clearTimeout(settleTimerRef.current)
		}
	}, [working])

	// ResizeObserver to follow growing content
	useEffect(() => {
		const content = contentRef.current
		if (!content) return

		const observer = new ResizeObserver(() => {
			const el = scrollRef.current
			if (!el) return
			if (!canScroll(el)) {
				if (userScrolled) setUserScrolled(false)
				return
			}
			const active = working || settlingRef.current
			if (!active) return
			if (userScrolled) return
			scrollToBottom(false)
		})

		observer.observe(content)
		return () => observer.disconnect()
	}, [working, userScrolled, canScroll, scrollToBottom])

	const handleScroll = useCallback(() => {
		const el = scrollRef.current
		if (!el) return

		if (!canScroll(el)) {
			if (userScrolled) setUserScrolled(false)
			return
		}

		if (distanceFromBottom(el) < BOTTOM_THRESHOLD) {
			if (userScrolled) setUserScrolled(false)
			return
		}

		// Ignore programmatic scroll events
		if (!userScrolled && isAuto(el)) return

		if (!userScrolled) setUserScrolled(true)
	}, [canScroll, distanceFromBottom, isAuto, userScrolled])

	const handleWheel = useCallback(
		(e: React.WheelEvent) => {
			if (e.deltaY >= 0) return
			// Don't break follow mode for scrolling inside nested scrollable regions
			const target = e.target instanceof Element ? e.target : undefined
			const nested = target?.closest("[data-scrollable]")
			if (scrollRef.current && nested && nested !== scrollRef.current) return

			const el = scrollRef.current
			if (!el) return
			if (!canScroll(el)) return
			if (!userScrolled) setUserScrolled(true)
		},
		[canScroll, userScrolled],
	)

	const forceScrollToBottom = useCallback(() => {
		scrollToBottom(true)
	}, [scrollToBottom])

	// Scroll to bottom on initial content load
	const initialScrollDone = useRef(false)
	useEffect(() => {
		const content = contentRef.current
		const el = scrollRef.current
		if (!content || !el) return

		// Wait for content to render, then scroll to bottom once
		if (!initialScrollDone.current && el.scrollHeight > el.clientHeight) {
			initialScrollDone.current = true
			markAuto(el)
			el.scrollTop = el.scrollHeight
		}
	})

	// Cleanup
	useEffect(() => {
		return () => {
			if (settleTimerRef.current) clearTimeout(settleTimerRef.current)
			if (autoTimerRef.current) clearTimeout(autoTimerRef.current)
		}
	}, [])

	return {
		scrollRef,
		contentRef,
		handleScroll,
		handleWheel,
		userScrolled,
		forceScrollToBottom,
	}
}
