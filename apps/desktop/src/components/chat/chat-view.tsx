import {
	Conversation,
	ConversationContent,
	ConversationScrollButton,
} from "@codedeck/ui/components/ai-elements/conversation"
import { Button } from "@codedeck/ui/components/button"
import { Loader2Icon, SendIcon } from "lucide-react"
import { useCallback, useRef, useState } from "react"
import type { ChatTurn } from "../../hooks/use-session-chat"
import type { Agent } from "../../lib/types"
import { ChatTurnComponent } from "./chat-turn"

interface ChatViewProps {
	turns: ChatTurn[]
	loading: boolean
	agent: Agent
	isConnected: boolean
	onSendMessage?: (agent: Agent, message: string) => Promise<void>
}

/**
 * Main chat view component.
 * Renders the full conversation as turns with auto-scroll,
 * plus a message input at the bottom.
 *
 * Uses the AI Elements Conversation component for stick-to-bottom scrolling.
 */
export function ChatView({ turns, loading, agent, isConnected, onSendMessage }: ChatViewProps) {
	const isWorking = agent.status === "running"

	return (
		<div className="flex h-full flex-col">
			<Conversation className="min-h-0 flex-1">
				<ConversationContent className="px-4 py-4">
					{loading ? (
						<div className="flex items-center justify-center py-8">
							<Loader2Icon className="size-5 animate-spin text-muted-foreground" />
							<span className="ml-2 text-sm text-muted-foreground">Loading chat...</span>
						</div>
					) : turns.length > 0 ? (
						turns.map((turn, index) => (
							<ChatTurnComponent
								key={turn.id}
								turn={turn}
								isLast={index === turns.length - 1}
								isWorking={isWorking}
							/>
						))
					) : (
						<div className="flex items-center justify-center py-8">
							<p className="text-sm text-muted-foreground">No messages yet</p>
						</div>
					)}
				</ConversationContent>
				<ConversationScrollButton />
			</Conversation>

			<ChatInput
				agent={agent}
				isConnected={isConnected}
				isWorking={isWorking}
				onSendMessage={onSendMessage}
			/>
		</div>
	)
}

/**
 * Chat message input — textarea with send button.
 * Simpler than OpenCode's contenteditable approach but functional.
 */
function ChatInput({
	agent,
	isConnected,
	isWorking,
	onSendMessage,
}: {
	agent: Agent
	isConnected: boolean
	isWorking: boolean
	onSendMessage?: (agent: Agent, message: string) => Promise<void>
}) {
	const [message, setMessage] = useState("")
	const [sending, setSending] = useState(false)
	const inputRef = useRef<HTMLTextAreaElement>(null)

	const handleSend = useCallback(async () => {
		const text = message.trim()
		if (!text || !onSendMessage || sending) return
		setSending(true)
		try {
			await onSendMessage(agent, text)
			setMessage("")
			// Re-focus input after sending
			inputRef.current?.focus()
		} finally {
			setSending(false)
		}
	}, [message, onSendMessage, sending, agent])

	const canSend = isConnected && !isWorking && message.trim().length > 0 && !sending

	return (
		<div className="border-t border-border p-3">
			<div className="flex items-end gap-2">
				<textarea
					ref={inputRef}
					value={message}
					onChange={(e) => setMessage(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter" && !e.shiftKey) {
							e.preventDefault()
							if (canSend) handleSend()
						}
					}}
					placeholder={
						!isConnected
							? "Connect to server to send messages..."
							: isWorking
								? "Waiting for response..."
								: "Send a message... (Enter to send, Shift+Enter for newline)"
					}
					disabled={!isConnected}
					rows={1}
					className="min-h-[36px] max-h-[120px] flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
				/>
				<Button
					size="sm"
					variant="ghost"
					onClick={handleSend}
					disabled={!canSend}
					className="shrink-0"
				>
					{sending ? (
						<Loader2Icon className="size-4 animate-spin" />
					) : (
						<SendIcon className="size-4" />
					)}
				</Button>
			</div>
			{!isConnected && (
				<p className="mt-1.5 text-[11px] text-muted-foreground">
					No server connection. Start the OpenCode server to interact with this session.
				</p>
			)}
		</div>
	)
}
