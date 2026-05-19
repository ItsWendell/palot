import { useCallback, useEffect, useRef, useState } from "react"
import type { Agent } from "../../lib/types"

export function useEscapeAbort({
	agent,
	isWorking,
	onStop,
}: {
	agent: Agent
	isWorking: boolean
	onStop?: (agent: Agent) => Promise<void>
}) {
	const [interruptCount, setInterruptCount] = useState(0)
	const interruptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

	const handleStop = useCallback(() => {
		if (onStop && isWorking) {
			onStop(agent)
		}
	}, [onStop, isWorking, agent])

	const handleEscapeAbort = useCallback(() => {
		if (!isWorking) return

		setInterruptCount((prev) => {
			const next = prev + 1
			if (next >= 2) {
				handleStop()
				if (interruptTimerRef.current) clearTimeout(interruptTimerRef.current)
				return 0
			}
			if (interruptTimerRef.current) clearTimeout(interruptTimerRef.current)
			interruptTimerRef.current = setTimeout(() => setInterruptCount(0), 3000)
			return next
		})
	}, [isWorking, handleStop])

	useEffect(() => {
		return () => {
			if (interruptTimerRef.current) clearTimeout(interruptTimerRef.current)
		}
	}, [])

	return {
		interruptCount,
		handleStop,
		handleEscapeAbort,
	}
}
