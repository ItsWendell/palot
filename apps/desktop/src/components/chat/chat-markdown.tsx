import { CheckIcon, CopyIcon } from "lucide-react"
import { memo, useCallback, useState } from "react"
import Markdown from "react-markdown"
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter"
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism"
import remarkGfm from "remark-gfm"

/**
 * Markdown renderer with syntax highlighting and code copy buttons.
 * Inspired by OpenCode's markdown.tsx but using react-markdown instead of marked+morphdom.
 */
export const ChatMarkdown = memo(function ChatMarkdown({ text }: { text: string }) {
	if (!text.trim()) return null

	return (
		<div className="prose prose-sm prose-invert max-w-none break-words text-sm text-foreground">
			<Markdown
				remarkPlugins={[remarkGfm]}
				components={{
					code: CodeBlock,
					pre: PreBlock,
					a: ExternalLink,
				}}
			>
				{text}
			</Markdown>
		</div>
	)
})

/** Links open in new tab */
function ExternalLink(props: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
	return (
		<a
			{...props}
			target="_blank"
			rel="noopener noreferrer"
			className="text-blue-400 underline decoration-blue-400/30 hover:decoration-blue-400"
		/>
	)
}

/** Wrapper around pre blocks — prevents double-styling */
function PreBlock({ children }: React.HTMLAttributes<HTMLPreElement>) {
	return <div>{children}</div>
}

/** Code block with syntax highlighting + copy button */
function CodeBlock({ children, className, ...props }: React.HTMLAttributes<HTMLElement>) {
	const match = /language-(\w+)/.exec(className || "")
	const code = String(children).replace(/\n$/, "")

	// Inline code
	if (!match) {
		return (
			<code
				className="rounded bg-muted px-1.5 py-0.5 font-mono text-[13px] text-foreground"
				{...props}
			>
				{children}
			</code>
		)
	}

	// Code block with syntax highlighting
	return (
		<div className="group/code relative my-2 overflow-hidden rounded-md border border-border">
			<div className="flex items-center justify-between border-b border-border bg-muted/50 px-3 py-1.5">
				<span className="text-[11px] text-muted-foreground">{match[1]}</span>
				<CopyButton text={code} />
			</div>
			<SyntaxHighlighter
				style={oneDark}
				language={match[1]}
				PreTag="div"
				customStyle={{
					margin: 0,
					padding: "12px",
					background: "transparent",
					fontSize: "13px",
				}}
			>
				{code}
			</SyntaxHighlighter>
		</div>
	)
}

function CopyButton({ text }: { text: string }) {
	const [copied, setCopied] = useState(false)

	const handleCopy = useCallback(async () => {
		await navigator.clipboard.writeText(text)
		setCopied(true)
		setTimeout(() => setCopied(false), 2000)
	}, [text])

	return (
		<button
			type="button"
			onClick={handleCopy}
			className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/code:opacity-100"
			aria-label={copied ? "Copied" : "Copy code"}
		>
			{copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
		</button>
	)
}
