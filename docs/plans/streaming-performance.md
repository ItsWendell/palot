# Streaming Text Performance Plan

> **Goal:** Make Palot's streaming text rendering as smooth as OpenCode's TUI and ChatGPT's web UI.

## Current State

We already implemented a first round of optimizations:

- 16ms event batching with coalescing in `connection-manager.ts`
- `useDeferredValue` on streaming `responseText` in `chat-turn.tsx`
- Reference-equality early-out in `upsertPart` / `upsertMessage`
- Structural sharing in `groupIntoTurns` for `React.memo` bailout

These helped but the result still isn't buttery smooth. This plan documents every remaining bottleneck and proposes solutions in priority order.

---

## Bottleneck Analysis

### B1. Shiki re-highlights entire code blocks on every token (CRITICAL)

**Where:** `@streamdown/code` plugin + streamdown's internal `CodeBlock` component

Streamdown's code block rendering path during streaming:

1. Token arrives -> `code` string grows by 1 char
2. Cache key changes (includes `code.length` + `last100chars`)
3. Cache miss -> `codeToTokens()` runs full Shiki tokenization on entire block
4. `setState(rawTokens)` -> render #1 (unhighlighted)
5. Async Shiki completes -> `setState(highlightedTokens)` -> render #2

**Result:** Every streaming token that lands inside a code block causes **two renders** and a full Shiki tokenization of the entire block. A 200-line code block being streamed token by token means 200x full tokenizations.

**Impact:** This is the single largest bottleneck for code-heavy responses.

### B2. Full remark/rehype parse per block per streaming token (HIGH)

**Where:** Streamdown internal (`Ie()` function in minified source)

Even for text blocks (not code), every streaming token causes:

1. `remend(fullMarkdown)` — O(n) string scan to close unclosed markdown syntax
2. `marked.Lexer.lex(fullMarkdown)` — full tokenization to split into blocks
3. For the changed block: `unified().parse().runSync()` through the full remark-rehype pipeline

The block-level memoization prevents re-rendering unchanged blocks (good), but the last active block gets a full remark-rehype parse on every single token.

### B3. Zustand `parts` selector is still too broad (MEDIUM)

**Where:** `use-session-chat.ts`

The `partsSelector` callback creates a new array on every call (even when `s.parts` reference hasn't changed for our messages). When `s.parts` changes for ANY session's parts, this triggers:

1. `rawSessionParts` recalculates (new array instance)
2. `sessionParts` useMemo runs shallow comparison
3. If the relevant Part[] refs ARE different, `entries` recalculates
4. `turns` recalculates via `groupIntoTurns`

The shallow comparison catches same-reference cases, but the selector itself runs on every store update.

### B4. ResizeObserver + spring scroll creates layout thrashing (MEDIUM)

**Where:** `use-stick-to-bottom` library internals

During streaming, content grows on nearly every frame. The ResizeObserver fires, which reads `scrollHeight`/`clientHeight`/`scrollTop` and writes `scrollTop` — a classic read-write-read pattern that forces layout recalculation within the same frame.

### B5. No content-visibility on older messages (LOW-MEDIUM)

**Where:** Chat message list in `chat-view.tsx`

All messages in the conversation are rendered to the DOM, even those scrolled far above the viewport. For long conversations (50+ turns), this means React maintains and re-reconciles a large DOM tree on every streaming update.

---

## Proposed Solutions (Priority Order)

### P1. Debounce Shiki highlighting during active streaming

**Effort:** LOW  
**Impact:** CRITICAL  
**Files:** `packages/ui/src/components/ai-elements/code-block.tsx`

The key insight: users can't read syntax highlighting as it streams in character by character. We only need highlighting when:

- Streaming pauses for 150ms+
- The code block is completed (closing fence received)
- The user scrolls up to a completed block

**Implementation options:**

#### Option A: Wrap `@streamdown/code` with a debounced highlighter (recommended)

Create a custom streamdown code plugin that debounces Shiki calls:

```tsx
// packages/ui/src/lib/debounced-code-plugin.ts
import { code as originalCode } from "@streamdown/code"

export function debouncedCode(options) {
	return {
		...originalCode(options),
		// Override the CodeBlock component
		components: {
			code: DebouncedCodeBlock,
		},
	}
}
```

In `DebouncedCodeBlock`:
- During streaming, render with simple CSS class-based styling (language keyword coloring via regex, not Shiki)
- Use a 200ms debounce on the Shiki `codeToTokens` call
- When streaming ends (no update for 200ms), run Shiki once on the final content

#### Option B: Patch streamdown's code block cache key

The current cache key includes `code.length` + `last100chars`, causing constant misses during streaming. A better key during streaming would be based on `language + theme` only, with a debounced re-highlight.

#### Option C: Use `content-visibility: auto` on code blocks during streaming

Already partially in place (`CodeBlockContainer` has `contentVisibility: "auto"`). Ensure code blocks below the fold skip Shiki entirely during streaming.

### P2. Throttle React re-render notifications from the store

**Effort:** LOW  
**Impact:** HIGH  
**Files:** `stores/app-store.ts`, `hooks/use-session-chat.ts`

Take inspiration from the AI SDK's `experimental_throttle` pattern. Instead of notifying React on every Zustand `set()`, throttle the notification.

**Implementation:**

Add a `useThrottledStoreSelector` utility:

```tsx
// hooks/use-throttled-selector.ts
import { useRef, useSyncExternalStore, useCallback } from "react"

const THROTTLE_MS = 50 // ~20 re-renders/sec max during streaming

export function useThrottledSelector<T>(
	selector: (state: AppState) => T,
	isStreaming: boolean,
): T {
	const storeRef = useRef(useAppStore.getState())
	const callbackRef = useRef<(() => void) | null>(null)
	const timerRef = useRef<ReturnType<typeof setTimeout>>()

	const subscribe = useCallback((onStoreChange: () => void) => {
		if (!isStreaming) {
			// No throttling when idle — immediate updates
			return useAppStore.subscribe(onStoreChange)
		}

		// Throttled: buffer notifications
		const throttled = () => {
			if (timerRef.current) return
			timerRef.current = setTimeout(() => {
				timerRef.current = undefined
				onStoreChange()
			}, THROTTLE_MS)
		}
		return useAppStore.subscribe(throttled)
	}, [isStreaming])

	return useSyncExternalStore(subscribe, () => selector(useAppStore.getState()))
}
```

Apply this to `useSessionChat` for `storeMessages` and parts selectors when the session is actively streaming.

### P3. Add `content-visibility: auto` to non-active chat turns

**Effort:** LOW  
**Impact:** MEDIUM  
**Files:** `components/chat/chat-turn.tsx`

CSS containment lets the browser skip rendering/layout for off-screen elements entirely:

```tsx
export const ChatTurnComponent = memo(function ChatTurnComponent({
	turn, isLast, isWorking,
}: ChatTurnProps) {
	return (
		<div
			className="group/turn space-y-4"
			style={
				// Only apply containment to completed, non-active turns
				!isLast ? {
					contentVisibility: "auto",
					containIntrinsicSize: "auto 200px",
				} : undefined
			}
		>
			{/* ... */}
		</div>
	)
})
```

**Why this works:** For a 50-turn conversation, 49 turns are above the viewport. With `content-visibility: auto`, the browser skips layout/paint for all of them. When the user scrolls up, the browser lazily renders them.

### P4. Use `requestAnimationFrame` for flush timing instead of `setTimeout`

**Effort:** LOW  
**Impact:** MEDIUM  
**Files:** `services/connection-manager.ts`

The current 16ms `setTimeout` in the event batcher doesn't synchronize with the browser's paint cycle. Using `requestAnimationFrame` ensures flushes align with actual frames:

```tsx
function createEventBatcher() {
	let queue: Event[] = []
	const coalesced = new Map<string, Event>()
	let rafId: number | undefined
	let lastFlush = 0

	function flush() {
		const events = [...queue, ...coalesced.values()]
		queue = []
		coalesced.clear()
		rafId = undefined
		lastFlush = performance.now()

		if (events.length === 0) return
		const { processEvent } = useAppStore.getState()
		for (const event of events) processEvent(event)
	}

	function enqueue(event: Event) {
		const key = coalescingKey(event)
		if (key) coalesced.set(key, event)
		else queue.push(event)

		if (rafId) return

		const elapsed = performance.now() - lastFlush
		if (elapsed < 16) {
			rafId = requestAnimationFrame(flush)
		} else {
			flush()
		}
	}

	function dispose() {
		if (rafId) cancelAnimationFrame(rafId)
		flush()
	}

	return { enqueue, dispose }
}
```

**Why:** `requestAnimationFrame` fires right before the browser paints. `setTimeout(fn, 16)` can fire at any point — including right after a paint, wasting the update because the next paint is 16ms away.

### P5. Split streaming message store into a separate high-frequency store

**Effort:** MEDIUM  
**Impact:** HIGH  
**Files:** New `stores/streaming-store.ts`, modified `stores/app-store.ts`, `hooks/use-session-chat.ts`

The AI SDK uses separate notification channels for messages vs. status vs. error. Palot can do the same by splitting the actively-streaming message's parts into a dedicated store that doesn't trigger Zustand subscriptions on the main store.

**Concept:**

```tsx
// stores/streaming-store.ts
// A lightweight store ONLY for the actively-streaming part's text content.
// This avoids touching the main app-store on every token.

interface StreamingState {
	/** messageID -> partID -> accumulated text */
	activeText: Map<string, Map<string, string>>
	/** Version counter — bumped on every update */
	version: number
}

export const streamingStore = createStore<StreamingState>(...)
```

In `connection-manager.ts`, for `message.part.updated` events where the part is a `text` or `reasoning` type and the session is actively streaming:
- Update `streamingStore` (cheap, no Zustand overhead)
- DON'T update `appStore.parts` until streaming pauses for 100ms+

In `useSessionChat`, merge `streamingStore.activeText` with `appStore.parts` for the final `responseText`.

This way, the main app store only sees ~20 updates/sec (on flush), while the streaming store accumulates tokens at full speed without triggering any React re-renders until the throttled read.

### P6. Consider `smoothStream`-style server-side buffering

**Effort:** MEDIUM  
**Impact:** MEDIUM  
**Files:** `apps/server/` (Hono backend)

The AI SDK's `smoothStream` is a server-side TransformStream that:

1. Buffers incoming tokens
2. Detects word boundaries (regex `/\S+\s+/m`)
3. Emits word-sized chunks with a configurable delay (default 10ms)

This means the client receives ~100 word-chunks/sec instead of ~500 token-chunks/sec — an immediate 5x reduction in state updates.

**Implementation:** In the Palot server (`apps/server/`), apply a similar transform to the SSE stream before it reaches the client:

```tsx
// apps/server/src/transforms/smooth-stream.ts
export function smoothStream(options?: { delayMs?: number, chunking?: "word" | "line" }) {
	const delay = options?.delayMs ?? 10
	const pattern = options?.chunking === "line" ? /\n+/m : /\S+\s+/m

	return new TransformStream({
		transform(chunk, controller) {
			if (chunk.type !== "message.part.updated") {
				controller.enqueue(chunk)
				return
			}
			// Buffer text deltas, emit at word boundaries with delay
			// ... (same algorithm as AI SDK's smoothStream)
		}
	})
}
```

**Trade-off:** Adds 10ms latency per word but dramatically smooths the visual experience. The AI SDK team found this to be the biggest UX improvement for perceived streaming quality.

### P7. Investigate incremental markdown parsing (Incremark)

**Effort:** HIGH  
**Impact:** HIGH  
**Files:** Would require replacing or wrapping Streamdown's parser

**Problem:** Streamdown uses `marked.Lexer.lex()` on the full document, then diffs blocks. For a 10KB document, this is a full re-lex on every token.

**Incremark** (https://github.com/marwanbelike/incremark) solves this:

- Finds the "stable boundary" — the point in the document where previous parse results are still valid
- Only re-parses from the stable boundary onward
- O(n) total work over a streaming session instead of O(n^2)

**Benchmarks from Incremark:**
| Document Size | Traditional | Incremark | Reduction |
|---------------|-------------|-----------|-----------|
| 1KB           | 1,010,000 chars parsed | 20,000 | 98% |
| 5KB           | 25,050,000 chars parsed | 100,000 | 99.6% |
| 20KB          | 400,200,000 chars parsed | 400,000 | 99.9% |

**Implementation path:**

1. Fork Streamdown or create a wrapper
2. Replace `parseMarkdownIntoBlocks` with an incremental version
3. Use `Incremark.findStableBoundary()` to skip re-parsing stable prefix blocks
4. Only feed new/unstable content to `marked.Lexer.lex()`

This is the most complex change but would eliminate the #2 bottleneck entirely.

### P8. Virtual scrolling for long conversations

**Effort:** HIGH  
**Impact:** MEDIUM (only affects long conversations)  
**Files:** `components/chat/chat-view.tsx`

For conversations with 100+ turns, even with `content-visibility: auto`, React still maintains the full component tree. A true virtual scrolling solution (React Virtuoso) would:

- Only mount ~10-15 visible turns
- Handle variable-height items automatically
- Support auto-scroll during streaming natively

**Library:** [React Virtuoso](https://virtuoso.dev/) has a `VirtuosoMessageList` component purpose-built for AI chat interfaces.

**Trade-off:** Virtual scrolling adds complexity (scroll position restoration, height estimation, keyboard navigation). Only worthwhile if conversations regularly exceed 50+ turns.

### P9. Web Worker for markdown parsing

**Effort:** HIGH  
**Impact:** LOW-MEDIUM  
**Files:** New worker, modified Streamdown wrapper

Offload the `remend()` + `marked.Lexer.lex()` + `unified().parse().runSync()` pipeline to a Web Worker. The main thread only receives pre-parsed HAST nodes.

**When worthwhile:** Only for documents >5KB. For typical chat messages (1-2KB), the overhead of `postMessage` serialization exceeds the parsing cost.

**Implementation:**

```tsx
// workers/markdown-worker.ts
import { unified } from "unified"
import remarkParse from "remark-parse"
import remarkRehype from "remark-rehype"

self.onmessage = (e) => {
	const { blockContent, blockIndex } = e.data
	const hast = unified()
		.use(remarkParse)
		.use(remarkRehype)
		.processSync(blockContent)
	self.postMessage({ hast: hast.result, blockIndex })
}
```

---

## Implementation Roadmap

### Phase 1: Quick Wins (1-2 days)

| # | Change | Impact | Effort |
|---|--------|--------|--------|
| P1 | Debounce Shiki highlighting during streaming | Critical | Low |
| P3 | `content-visibility: auto` on non-active turns | Medium | Low |
| P4 | Switch batcher from `setTimeout` to `requestAnimationFrame` | Medium | Low |

### Phase 2: Store Architecture (2-3 days)

| # | Change | Impact | Effort |
|---|--------|--------|--------|
| P2 | Throttled store selectors for streaming | High | Low |
| P5 | Split streaming parts into separate high-frequency store | High | Medium |

### Phase 3: Server-Side Smoothing (1-2 days)

| # | Change | Impact | Effort |
|---|--------|--------|--------|
| P6 | `smoothStream`-style word-boundary buffering on server | Medium | Medium |

### Phase 4: Advanced Optimizations (3-5 days)

| # | Change | Impact | Effort |
|---|--------|--------|--------|
| P7 | Incremental markdown parsing (Incremark or custom) | High | High |
| P8 | Virtual scrolling for long conversations | Medium | High |
| P9 | Web Worker markdown parsing | Low-Medium | High |

---

## Key Patterns from Reference Implementations

### OpenCode TUI
- 16ms batched event flush with immediate-first semantics
- SolidJS fine-grained reactivity (no VDOM diffing)
- Double-buffered renderer at 60fps with Zig native diffing
- Incremental markdown parsing with trailing-unstable-2 strategy
- Async tree-sitter highlighting with snapshot ID invalidation
- Worker thread isolation for backend processing

### Vercel AI SDK (`@ai-sdk/react`)
- `useSyncExternalStore` for message state (not `useState`)
- Separate callback channels for messages / status / error
- `experimental_throttle` on the React re-render trigger (not the data)
- `structuredClone` on write for React Compiler compatibility
- `smoothStream` server-side word-boundary chunking with 10ms delay

### Streamdown
- Block-level `React.memo` with string equality
- Component-level `React.memo` with AST position equality
- `useTransition` for streaming block list updates
- `React.lazy()` for code blocks and Mermaid diagrams
- `IntersectionObserver` + `requestIdleCallback` for deferred off-screen rendering
- `remend` for self-healing incomplete markdown during streaming
- Unified pipeline caching (LRU, 100 entries)

### Chrome Best Practices
- Never use `innerHTML +=` for streaming — use `append()` or `insertAdjacentText()`
- Use `content-visibility: auto` for off-screen content
- Buffer tokens and flush via `requestAnimationFrame`
- Consider `streaming-markdown` for direct DOM manipulation

---

## Metrics to Track

Before implementing, add performance instrumentation:

1. **Renders per second** during streaming — `useEffect` counter in `ChatTurnComponent`
2. **Time from SSE event to paint** — `performance.mark()` in event handler + `requestAnimationFrame(() => performance.measure())`
3. **Longest frame** during streaming — `PerformanceObserver` for `longtask` entries
4. **DOM node count** in conversation — `document.querySelectorAll('*').length` on a timer
5. **Shiki tokenization time** — wrap `codeToTokens` with `performance.now()` timing

Target: no frame longer than 33ms (30fps minimum), ideally all frames under 16ms (60fps).

---

## References

- [AI SDK smoothStream source](../ai/packages/ai/src/generate-text/smooth-stream.ts)
- [AI SDK React chat.react.ts](../ai/packages/react/src/chat.react.ts)
- [AI SDK experimental_throttle](../ai/packages/react/src/use-chat.ts)
- [Streamdown (Vercel)](https://github.com/vercel/streamdown)
- [Incremark — incremental markdown parsing](https://github.com/marwanbelike/incremark)
- [Chrome: Render LLM responses](https://developer.chrome.com/docs/ai/render-llm-responses)
- [React Virtuoso MessageList](https://virtuoso.dev/)
- [Upstash: Smooth Streaming](https://upstash.com/blog/smooth-streaming)
- [Streak: Preventing Unstyled Markdown](https://engineering.streak.com/p/preventing-unstyled-markdown-streaming-ai)
- [CSS content-visibility](https://web.dev/articles/content-visibility)
- [OpenCode TUI source](../opencode/packages/opencode/src/cli/cmd/tui/)
