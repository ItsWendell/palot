/**
 * Static fixture data for demo/mock mode.
 *
 * All timestamps are relative to `Date.now()` so the UI always
 * looks fresh regardless of when the screenshot is taken.
 */
import type { DiscoveredProject, DiscoveredSession, DiscoveryState } from "../atoms/discovery"
import type { SessionEntry } from "../atoms/sessions"
import type {
	AssistantMessage,
	Message,
	Part,
	Permission,
	ReasoningPart,
	Session,
	TextPart,
	ToolPart,
	UserMessage,
} from "./types"

// ============================================================
// Helpers
// ============================================================

const NOW = Date.now()
const MINUTE = 60_000
const HOUR = 60 * MINUTE

/** Stable IDs so navigation works across reloads */
const IDS = {
	// Projects
	projectPalot: "proj-a1b2c3d4e5f6",
	projectAcmeApi: "proj-f6e5d4c3b2a1",
	projectLanding: "proj-1a2b3c4d5e6f",

	// Sessions
	sessionDarkMode: "ses-mock-darkmode-001",
	sessionAuthFix: "ses-mock-authfix-002",
	sessionRefactor: "ses-mock-refactor-003",
	sessionLanding: "ses-mock-landing-004",
	sessionTests: "ses-mock-tests-005",
	sessionDocs: "ses-mock-docs-006",

	// Messages -- dark mode session
	dmUser1: "msg-dm-u1",
	dmAssistant1: "msg-dm-a1",
	dmUser2: "msg-dm-u2",
	dmAssistant2: "msg-dm-a2",

	// Messages -- auth fix session
	afUser1: "msg-af-u1",
	afAssistant1: "msg-af-a1",

	// Messages -- refactor session
	rfUser1: "msg-rf-u1",
	rfAssistant1: "msg-rf-a1",
	rfUser2: "msg-rf-u2",
	rfAssistant2: "msg-rf-a2",

	// Messages -- landing session
	lnUser1: "msg-ln-u1",
	lnAssistant1: "msg-ln-a1",

	// Messages -- tests session
	tsUser1: "msg-ts-u1",
	tsAssistant1: "msg-ts-a1",

	// Messages -- docs session
	dcUser1: "msg-dc-u1",
	dcAssistant1: "msg-dc-a1",
} as const

function partId(messageId: string, index: number): string {
	return `part-${messageId}-${index}`
}

// ============================================================
// Project directories
// ============================================================

const DIRS = {
	palot: "/Users/demo/Projects/palot",
	acmeApi: "/Users/demo/Projects/acme-api",
	landing: "/Users/demo/Projects/landing-page",
}

// ============================================================
// Discovery state
// ============================================================

const mockDiscoveredProjects: DiscoveredProject[] = [
	{
		id: IDS.projectPalot,
		worktree: DIRS.palot,
		vcs: "git",
		time: { created: NOW - 30 * 24 * HOUR, updated: NOW - 2 * MINUTE },
	},
	{
		id: IDS.projectAcmeApi,
		worktree: DIRS.acmeApi,
		vcs: "git",
		time: { created: NOW - 14 * 24 * HOUR, updated: NOW - 15 * MINUTE },
	},
	{
		id: IDS.projectLanding,
		worktree: DIRS.landing,
		vcs: "git",
		time: { created: NOW - 7 * 24 * HOUR, updated: NOW - 1 * HOUR },
	},
]

const mockDiscoveredSessions: Record<string, DiscoveredSession[]> = {
	[IDS.projectPalot]: [
		{
			id: IDS.sessionDarkMode,
			projectID: IDS.projectPalot,
			directory: DIRS.palot,
			title: "Add dark mode toggle to settings",
			time: { created: NOW - 25 * MINUTE, updated: NOW - 2 * MINUTE },
			summary: { additions: 147, deletions: 23, files: 8 },
		},
		{
			id: IDS.sessionTests,
			projectID: IDS.projectPalot,
			directory: DIRS.palot,
			title: "Add unit tests for auth middleware",
			time: { created: NOW - 3 * HOUR, updated: NOW - 2 * HOUR },
			summary: { additions: 312, deletions: 5, files: 4 },
		},
		{
			id: IDS.sessionDocs,
			projectID: IDS.projectPalot,
			directory: DIRS.palot,
			title: "Update API documentation for v2 endpoints",
			time: { created: NOW - 5 * HOUR, updated: NOW - 4 * HOUR },
			summary: { additions: 89, deletions: 34, files: 3 },
		},
	],
	[IDS.projectAcmeApi]: [
		{
			id: IDS.sessionAuthFix,
			projectID: IDS.projectAcmeApi,
			directory: DIRS.acmeApi,
			title: "Fix JWT token refresh race condition",
			time: { created: NOW - 45 * MINUTE, updated: NOW - 12 * MINUTE },
			summary: { additions: 56, deletions: 18, files: 3 },
		},
		{
			id: IDS.sessionRefactor,
			projectID: IDS.projectAcmeApi,
			directory: DIRS.acmeApi,
			title: "Refactor database connection pooling",
			time: { created: NOW - 2 * HOUR, updated: NOW - 45 * MINUTE },
			summary: { additions: 203, deletions: 156, files: 12 },
		},
	],
	[IDS.projectLanding]: [
		{
			id: IDS.sessionLanding,
			projectID: IDS.projectLanding,
			directory: DIRS.landing,
			title: "Build hero section with animated gradient",
			time: { created: NOW - 1 * HOUR, updated: NOW - 35 * MINUTE },
			summary: { additions: 178, deletions: 0, files: 5 },
		},
	],
}

export const MOCK_DISCOVERY: DiscoveryState = {
	loaded: true,
	loading: false,
	error: null,
	projects: mockDiscoveredProjects,
	sessions: mockDiscoveredSessions,
}

// ============================================================
// Providers data (for model selector)
// ============================================================

export const MOCK_PROVIDERS = {
	providers: [
		{
			id: "bedrock",
			name: "AWS Bedrock",
			source: "builtin" as const,
			env: {},
			options: {},
			models: {
				"anthropic.claude-opus-4-6": {
					id: "anthropic.claude-opus-4-6",
					name: "Claude Opus 4.6",
					variants: {
						Adaptive: {
							name: "Adaptive",
							description: "Adaptive reasoning mode for complex tasks",
						},
						Standard: {
							name: "Standard",
							description: "Standard mode for general tasks",
						},
					},
					capabilities: {
						input: { image: true, pdf: true },
						attachment: true,
					},
				},
			},
		},
		{
			id: "anthropic",
			name: "Anthropic",
			source: "builtin" as const,
			env: {},
			options: {},
			models: {
				"claude-sonnet-4-20250514": {
					id: "claude-sonnet-4-20250514",
					name: "Claude Sonnet 4",
					capabilities: {
						input: { image: true, pdf: true },
						attachment: true,
					},
				},
			},
		},
	],
	defaults: {
		bedrock: "anthropic.claude-opus-4-6",
		anthropic: "claude-sonnet-4-20250514",
	},
}

// ============================================================
// Agents data
// ============================================================

export const MOCK_AGENTS = [
	{
		id: "build",
		name: "Build",
		description: "Expert at building new features and implementing complex functionality",
		mode: "primary" as const,
		hidden: false,
		permissions: [],
		options: {},
		model: {
			providerID: "bedrock",
			modelID: "anthropic.claude-opus-4-6",
		},
	},
	{
		id: "debug",
		name: "Debug",
		description: "Specialist in finding and fixing bugs",
		mode: "primary" as const,
		hidden: false,
		permissions: [],
		options: {},
	},
	{
		id: "default",
		name: "Default",
		description: "General-purpose assistant",
		mode: "primary" as const,
		hidden: false,
		permissions: [],
		options: {},
	},
]

// ============================================================
// Config data
// ============================================================

export const MOCK_CONFIG = {
	model: "bedrock/anthropic.claude-opus-4-6",
	smallModel: "anthropic/claude-sonnet-4-20250514",
	defaultAgent: "Build",
}

// ============================================================
// Session factory helpers
// ============================================================

function makeSession(
	id: string,
	projectID: string,
	directory: string,
	title: string,
	created: number,
	updated: number,
): Session {
	return {
		id,
		projectID,
		directory,
		title,
		version: "1",
		time: { created, updated },
	}
}

// ============================================================
// Sessions (live)
// ============================================================

const mockSessions: Session[] = [
	makeSession(
		IDS.sessionDarkMode,
		IDS.projectPalot,
		DIRS.palot,
		"Add dark mode toggle to settings",
		NOW - 25 * MINUTE,
		NOW - 2 * MINUTE,
	),
	makeSession(
		IDS.sessionAuthFix,
		IDS.projectAcmeApi,
		DIRS.acmeApi,
		"Fix JWT token refresh race condition",
		NOW - 45 * MINUTE,
		NOW - 12 * MINUTE,
	),
	makeSession(
		IDS.sessionRefactor,
		IDS.projectAcmeApi,
		DIRS.acmeApi,
		"Refactor database connection pooling",
		NOW - 2 * HOUR,
		NOW - 45 * MINUTE,
	),
	makeSession(
		IDS.sessionLanding,
		IDS.projectLanding,
		DIRS.landing,
		"Build hero section with animated gradient",
		NOW - 1 * HOUR,
		NOW - 35 * MINUTE,
	),
	makeSession(
		IDS.sessionTests,
		IDS.projectPalot,
		DIRS.palot,
		"Add unit tests for auth middleware",
		NOW - 3 * HOUR,
		NOW - 2 * HOUR,
	),
	makeSession(
		IDS.sessionDocs,
		IDS.projectPalot,
		DIRS.palot,
		"Update API documentation for v2 endpoints",
		NOW - 5 * HOUR,
		NOW - 4 * HOUR,
	),
]

// ============================================================
// Session entries (with status, permissions, etc.)
// ============================================================

export const MOCK_SESSION_ENTRIES: Map<string, SessionEntry> = new Map([
	[
		IDS.sessionDarkMode,
		{
			session: mockSessions[0],
			status: { type: "busy" as const },
			permissions: [],
			questions: [],
			directory: DIRS.palot,
			branch: "feat/dark-mode",
		},
	],
	[
		IDS.sessionAuthFix,
		{
			session: mockSessions[1],
			status: { type: "idle" as const },
			permissions: [
				{
					id: "perm-mock-001",
					type: "file.write",
					sessionID: IDS.sessionAuthFix,
					messageID: IDS.afAssistant1,
					title: "Write to src/middleware/auth.ts",
					metadata: {
						file: "src/middleware/auth.ts",
						description: "Update token refresh logic to handle concurrent requests",
					},
					time: { created: NOW - 12 * MINUTE },
				} satisfies Permission,
			],
			questions: [],
			directory: DIRS.acmeApi,
			branch: "fix/token-refresh",
		},
	],
	[
		IDS.sessionRefactor,
		{
			session: mockSessions[2],
			status: { type: "idle" as const },
			permissions: [],
			questions: [],
			directory: DIRS.acmeApi,
			branch: "refactor/db-pool",
		},
	],
	[
		IDS.sessionLanding,
		{
			session: mockSessions[3],
			status: { type: "idle" as const },
			permissions: [],
			questions: [],
			directory: DIRS.landing,
			branch: "feat/hero-section",
		},
	],
	[
		IDS.sessionTests,
		{
			session: mockSessions[4],
			status: { type: "idle" as const },
			permissions: [],
			questions: [],
			directory: DIRS.palot,
			branch: "test/auth-middleware",
		},
	],
	[
		IDS.sessionDocs,
		{
			session: mockSessions[5],
			status: { type: "idle" as const },
			permissions: [],
			questions: [],
			directory: DIRS.palot,
			branch: "docs/api-v2",
		},
	],
])

export const MOCK_SESSION_IDS: Set<string> = new Set(MOCK_SESSION_ENTRIES.keys())

// ============================================================
// Message & part factory helpers
// ============================================================

function userMsg(id: string, sessionID: string, created: number): UserMessage {
	return {
		id,
		sessionID,
		role: "user",
		time: { created },
		agent: "Build",
		model: { providerID: "bedrock", modelID: "anthropic.claude-opus-4-6" },
	}
}

function assistantMsg(
	id: string,
	sessionID: string,
	parentID: string,
	created: number,
	completed?: number,
): AssistantMessage {
	return {
		id,
		sessionID,
		role: "assistant",
		time: { created, completed },
		parentID,
		modelID: "anthropic.claude-opus-4-6",
		providerID: "bedrock",
		mode: "Adaptive",
		path: { cwd: DIRS.palot, root: DIRS.palot },
		cost: 0.003 + Math.random() * 0.01,
		tokens: {
			input: 1200 + Math.floor(Math.random() * 2000),
			output: 400 + Math.floor(Math.random() * 1500),
			reasoning: 0,
			cache: { read: 800, write: 200 },
		},
	}
}

function textPart(
	messageId: string,
	sessionId: string,
	index: number,
	text: string,
	startOffset: number,
): TextPart {
	return {
		id: partId(messageId, index),
		sessionID: sessionId,
		messageID: messageId,
		type: "text",
		text,
		time: { start: NOW - startOffset, end: NOW - startOffset + 2000 },
	}
}

function reasoningPart(
	messageId: string,
	sessionId: string,
	index: number,
	text: string,
	startOffset: number,
): ReasoningPart {
	return {
		id: partId(messageId, index),
		sessionID: sessionId,
		messageID: messageId,
		type: "reasoning",
		text,
		time: { start: NOW - startOffset, end: NOW - startOffset + 1500 },
	}
}

function toolPart(
	messageId: string,
	sessionId: string,
	index: number,
	tool: string,
	title: string,
	input: Record<string, unknown>,
	output: string,
	startOffset: number,
): ToolPart {
	return {
		id: partId(messageId, index),
		sessionID: sessionId,
		messageID: messageId,
		type: "tool",
		callID: `call-${messageId}-${index}`,
		tool,
		state: {
			status: "completed",
			input,
			output,
			title,
			metadata: {},
			time: { start: NOW - startOffset, end: NOW - startOffset + 3000 },
		},
	}
}

function runningToolPart(
	messageId: string,
	sessionId: string,
	index: number,
	tool: string,
	title: string,
	input: Record<string, unknown>,
	startOffset: number,
): ToolPart {
	return {
		id: partId(messageId, index),
		sessionID: sessionId,
		messageID: messageId,
		type: "tool",
		callID: `call-${messageId}-${index}`,
		tool,
		state: {
			status: "running",
			input,
			title,
			metadata: {},
			time: { start: NOW - startOffset },
		},
	}
}

// ============================================================
// Dark mode session
// ============================================================

const darkModeMessages: Message[] = [
	userMsg(IDS.dmUser1, IDS.sessionDarkMode, NOW - 25 * MINUTE),
	assistantMsg(
		IDS.dmAssistant1,
		IDS.sessionDarkMode,
		IDS.dmUser1,
		NOW - 25 * MINUTE + 2000,
		NOW - 20 * MINUTE,
	),
	userMsg(IDS.dmUser2, IDS.sessionDarkMode, NOW - 8 * MINUTE),
	assistantMsg(
		IDS.dmAssistant2,
		IDS.sessionDarkMode,
		IDS.dmUser2,
		NOW - 8 * MINUTE + 1500,
		// no completed -- still running
	),
]

const darkModeParts: Record<string, Part[]> = {
	[IDS.dmUser1]: [
		textPart(
			IDS.dmUser1,
			IDS.sessionDarkMode,
			0,
			"Add a dark mode toggle to the application settings page. It should persist the user's preference to localStorage and apply the theme immediately without a page reload.",
			25 * MINUTE,
		),
	],
	[IDS.dmAssistant1]: [
		reasoningPart(
			IDS.dmAssistant1,
			IDS.sessionDarkMode,
			0,
			"The user wants a theme toggle in settings. I should:\n1. Read the existing Settings component to see the layout\n2. Create a theme utility module (resolve, apply, persist)\n3. Add a three-way toggle: light / dark / system\n4. Use `data-theme` attribute so CSS custom properties switch instantly",
			25 * MINUTE - 2000,
		),
		toolPart(
			IDS.dmAssistant1,
			IDS.sessionDarkMode,
			1,
			"read",
			"Read src/components/settings.tsx",
			{ path: "src/components/settings.tsx" },
			'import { Card, CardContent, CardHeader } from "@/ui/card"\nimport { Label } from "@/ui/label"\n\nexport function Settings() {\n  return (\n    <Card>\n      <CardHeader title="Preferences" />\n      <CardContent>\n        <Label>Language</Label>\n        <LanguagePicker />\n        {/* TODO: add theme toggle */}\n      </CardContent>\n    </Card>\n  )\n}',
			24 * MINUTE,
		),
		toolPart(
			IDS.dmAssistant1,
			IDS.sessionDarkMode,
			2,
			"edit",
			"Edit src/lib/theme.ts",
			{
				path: "src/lib/theme.ts",
				diff: '+type Theme = "light" | "dark" | "system"\n+\n+const STORAGE_KEY = "app-theme"\n+const query = "(prefers-color-scheme: dark)"\n+\n+export function resolveTheme(stored: Theme | null): "light" | "dark" {\n+  if (stored === "light" || stored === "dark") return stored\n+  return window.matchMedia(query).matches ? "dark" : "light"\n+}\n+\n+export function applyTheme(theme: "light" | "dark") {\n+  document.documentElement.dataset.theme = theme\n+}',
			},
			"Applied edit to src/lib/theme.ts",
			23 * MINUTE,
		),
		toolPart(
			IDS.dmAssistant1,
			IDS.sessionDarkMode,
			3,
			"edit",
			"Edit src/components/settings.tsx",
			{
				path: "src/components/settings.tsx",
				diff: '+import { ToggleGroup, ToggleGroupItem } from "@/ui/toggle-group"\n+import { Sun, Moon, Monitor } from "lucide-react"\n ...\n+        <Label>Theme</Label>\n+        <ToggleGroup type="single" value={theme} onValueChange={setTheme}>\n+          <ToggleGroupItem value="light"><Sun /></ToggleGroupItem>\n+          <ToggleGroupItem value="dark"><Moon /></ToggleGroupItem>\n+          <ToggleGroupItem value="system"><Monitor /></ToggleGroupItem>\n+        </ToggleGroup>',
			},
			"Applied edit to src/components/settings.tsx",
			22 * MINUTE,
		),
		textPart(
			IDS.dmAssistant1,
			IDS.sessionDarkMode,
			4,
			"I've added the dark mode toggle to the settings page. Here's what I did:\n\n1. **Created `src/lib/theme.ts`** - Pure functions to resolve, apply, and persist the theme. Supports `light`, `dark`, and `system` (which reads `prefers-color-scheme`).\n\n2. **Updated `src/components/settings.tsx`** - Added a three-way toggle group (Sun/Moon/Monitor icons) so users can pick light, dark, or match their OS.\n\nThe theme applies instantly via `data-theme` on the root element, no reload needed.",
			20 * MINUTE,
		),
	],
	[IDS.dmUser2]: [
		textPart(
			IDS.dmUser2,
			IDS.sessionDarkMode,
			0,
			"Great! Now also add system preference detection so it defaults to the user's OS setting, and add a transition animation when switching themes.",
			8 * MINUTE,
		),
	],
	[IDS.dmAssistant2]: [
		reasoningPart(
			IDS.dmAssistant2,
			IDS.sessionDarkMode,
			0,
			"The `system` option already resolves on load, but doesn't react when the OS preference changes. I'll add a `matchMedia` listener so the theme updates in real-time, plus a CSS transition on `background-color` and `color` for a smooth switch.",
			8 * MINUTE - 1500,
		),
		toolPart(
			IDS.dmAssistant2,
			IDS.sessionDarkMode,
			1,
			"read",
			"Read src/lib/theme.ts",
			{ path: "src/lib/theme.ts" },
			'type Theme = "light" | "dark" | "system"\n\nconst STORAGE_KEY = "app-theme"\nconst query = "(prefers-color-scheme: dark)"\n\nexport function resolveTheme(stored: Theme | null) {\n  if (stored === "light" || stored === "dark") return stored\n  return window.matchMedia(query).matches ? "dark" : "light"\n}\n\nexport function applyTheme(theme: "light" | "dark") {\n  document.documentElement.dataset.theme = theme\n}',
			7 * MINUTE,
		),
		runningToolPart(
			IDS.dmAssistant2,
			IDS.sessionDarkMode,
			2,
			"edit",
			"Edit src/lib/theme.ts",
			{
				path: "src/lib/theme.ts",
				diff: '+export function watchSystemTheme(cb: (dark: boolean) => void) {\n+  const mql = window.matchMedia(query)\n+  const handler = (e: MediaQueryListEvent) => cb(e.matches)\n+  mql.addEventListener("change", handler)\n+  return () => mql.removeEventListener("change", handler)\n+}',
			},
			2 * MINUTE,
		),
	],
}

// ============================================================
// Auth fix session
// ============================================================

const authFixMessages: Message[] = [
	userMsg(IDS.afUser1, IDS.sessionAuthFix, NOW - 45 * MINUTE),
	assistantMsg(
		IDS.afAssistant1,
		IDS.sessionAuthFix,
		IDS.afUser1,
		NOW - 45 * MINUTE + 2000,
		NOW - 15 * MINUTE,
	),
]

const authFixParts: Record<string, Part[]> = {
	[IDS.afUser1]: [
		textPart(
			IDS.afUser1,
			IDS.sessionAuthFix,
			0,
			"There's a race condition in our JWT token refresh. When multiple API calls happen simultaneously and the token is expired, they all try to refresh at once, causing 401 errors. Fix this with a mutex pattern.",
			45 * MINUTE,
		),
	],
	[IDS.afAssistant1]: [
		toolPart(
			IDS.afAssistant1,
			IDS.sessionAuthFix,
			0,
			"read",
			"Read src/middleware/auth.ts",
			{ path: "src/middleware/auth.ts" },
			'export async function refreshToken() {\n  const response = await fetch("/api/refresh", { ... })\n  const { token } = await response.json()\n  localStorage.setItem("token", token)\n  return token\n}',
			44 * MINUTE,
		),
		toolPart(
			IDS.afAssistant1,
			IDS.sessionAuthFix,
			1,
			"edit",
			"Edit src/middleware/auth.ts",
			{
				path: "src/middleware/auth.ts",
				diff: "+let refreshPromise: Promise<string> | null = null\n+\n+export async function refreshToken() {\n+  if (refreshPromise) return refreshPromise\n+  refreshPromise = doRefresh().finally(() => {\n+    refreshPromise = null\n+  })\n+  return refreshPromise\n+}",
			},
			"Applied edit to src/middleware/auth.ts",
			40 * MINUTE,
		),
		toolPart(
			IDS.afAssistant1,
			IDS.sessionAuthFix,
			2,
			"bash",
			"Run tests",
			{ command: "bun test src/middleware/auth.test.ts" },
			"PASS  src/middleware/auth.test.ts\n  refreshToken\n    ✓ refreshes token on expiry (12ms)\n    ✓ deduplicates concurrent refresh calls (8ms)\n    ✓ retries on network failure (15ms)\n\nTests: 3 passed, 3 total\nTime: 0.42s",
			35 * MINUTE,
		),
		textPart(
			IDS.afAssistant1,
			IDS.sessionAuthFix,
			3,
			"I've fixed the race condition by implementing a singleton promise pattern (sometimes called a \"refresh mutex\"). Here's the approach:\n\n- A module-level `refreshPromise` variable holds the in-flight refresh request\n- When `refreshToken()` is called, if a refresh is already in progress, it returns the existing promise instead of starting a new one\n- The promise is cleared in a `.finally()` block so subsequent calls after completion will trigger a fresh refresh\n\nAll 3 tests pass, including a new test for concurrent refresh deduplication.",
			15 * MINUTE,
		),
	],
}

// ============================================================
// Refactor session
// ============================================================

const refactorMessages: Message[] = [
	userMsg(IDS.rfUser1, IDS.sessionRefactor, NOW - 2 * HOUR),
	assistantMsg(
		IDS.rfAssistant1,
		IDS.sessionRefactor,
		IDS.rfUser1,
		NOW - 2 * HOUR + 3000,
		NOW - 1.5 * HOUR,
	),
	userMsg(IDS.rfUser2, IDS.sessionRefactor, NOW - 1 * HOUR),
	assistantMsg(
		IDS.rfAssistant2,
		IDS.sessionRefactor,
		IDS.rfUser2,
		NOW - 1 * HOUR + 2000,
		NOW - 45 * MINUTE,
	),
]

const refactorParts: Record<string, Part[]> = {
	[IDS.rfUser1]: [
		textPart(
			IDS.rfUser1,
			IDS.sessionRefactor,
			0,
			"Our database connection pooling is creating too many connections under load. Refactor it to use a proper connection pool with configurable limits and health checking.",
			2 * HOUR,
		),
	],
	[IDS.rfAssistant1]: [
		toolPart(
			IDS.rfAssistant1,
			IDS.sessionRefactor,
			0,
			"glob",
			"Search for database files",
			{ pattern: "src/**/*db*" },
			"src/db/connection.ts\nsrc/db/pool.ts\nsrc/db/migrations/\nsrc/db/types.ts",
			2 * HOUR - 3000,
		),
		toolPart(
			IDS.rfAssistant1,
			IDS.sessionRefactor,
			1,
			"read",
			"Read src/db/connection.ts",
			{ path: "src/db/connection.ts" },
			'import pg from "pg"\n\nexport function createConnection() {\n  return new pg.Client({\n    connectionString: process.env.DATABASE_URL,\n  })\n}\n\nexport async function query(\n  sql: string,\n  params?: unknown[],\n) {\n  const client = createConnection()\n  await client.connect()\n  const result = await client.query(sql, params)\n  await client.end()\n  return result\n}',
			2 * HOUR - 5000,
		),
		textPart(
			IDS.rfAssistant1,
			IDS.sessionRefactor,
			2,
			"I can see the issue. Each query creates a new connection and tears it down afterwards. This is very expensive under load. I'll refactor this to use `pg.Pool` with configurable connection limits, idle timeouts, and health checking.\n\nLet me update the connection module and add proper pool management.",
			1.5 * HOUR,
		),
	],
	[IDS.rfUser2]: [
		textPart(
			IDS.rfUser2,
			IDS.sessionRefactor,
			0,
			"Looks good. Can you also add connection retry logic with exponential backoff?",
			1 * HOUR,
		),
	],
	[IDS.rfAssistant2]: [
		toolPart(
			IDS.rfAssistant2,
			IDS.sessionRefactor,
			0,
			"edit",
			"Edit src/db/pool.ts",
			{
				path: "src/db/pool.ts",
				diff: '+async function connectWithRetry(\n+  pool: Pool,\n+  maxRetries = 5,\n+): Promise<PoolClient> {\n+  for (let attempt = 0; attempt < maxRetries; attempt++) {\n+    try {\n+      return await pool.connect()\n+    } catch (err) {\n+      const delay = Math.min(1000 * 2 ** attempt, 30000)\n+      await new Promise((r) => setTimeout(r, delay))\n+    }\n+  }\n+  throw new Error("Failed to connect after retries")\n+}',
			},
			"Applied edit to src/db/pool.ts",
			55 * MINUTE,
		),
		textPart(
			IDS.rfAssistant2,
			IDS.sessionRefactor,
			1,
			"Done! I've added exponential backoff retry logic to the connection pool:\n\n- Retries up to 5 times (configurable)\n- Backoff starts at 1s and doubles each attempt, capped at 30s\n- Logs each retry attempt for observability\n- Throws a clear error after all retries are exhausted",
			45 * MINUTE,
		),
	],
}

// ============================================================
// Landing page session
// ============================================================

const landingMessages: Message[] = [
	userMsg(IDS.lnUser1, IDS.sessionLanding, NOW - 1 * HOUR),
	assistantMsg(
		IDS.lnAssistant1,
		IDS.sessionLanding,
		IDS.lnUser1,
		NOW - 1 * HOUR + 2000,
		NOW - 35 * MINUTE,
	),
]

const landingParts: Record<string, Part[]> = {
	[IDS.lnUser1]: [
		textPart(
			IDS.lnUser1,
			IDS.sessionLanding,
			0,
			"Create a hero section for the landing page with an animated gradient background, a bold headline, and a CTA button. Use Tailwind CSS and Framer Motion for animations.",
			1 * HOUR,
		),
	],
	[IDS.lnAssistant1]: [
		toolPart(
			IDS.lnAssistant1,
			IDS.sessionLanding,
			0,
			"edit",
			"Edit src/components/hero.tsx",
			{
				path: "src/components/hero.tsx",
				diff: '+export function Hero() {\n+  return (\n+    <section className="relative min-h-screen flex items-center">\n+      <div className="animated-gradient absolute inset-0" />\n+      <div className="relative z-10 text-center">\n+        <motion.h1\n+          initial={{ opacity: 0, y: 20 }}\n+          animate={{ opacity: 1, y: 0 }}\n+        >\n+          Ship faster with AI\n+        </motion.h1>\n+      </div>\n+    </section>\n+  )\n+}',
			},
			"Created src/components/hero.tsx",
			50 * MINUTE,
		),
		textPart(
			IDS.lnAssistant1,
			IDS.sessionLanding,
			1,
			"I've created the hero section with:\n\n- **Animated gradient background** using CSS `@keyframes` with a shifting color stop\n- **Bold headline** with Framer Motion fade-in and slide-up animation\n- **CTA button** with a subtle hover scale effect and gradient border\n\nThe component is fully responsive and uses Tailwind for all styling.",
			35 * MINUTE,
		),
	],
}

// ============================================================
// Tests session
// ============================================================

const testsMessages: Message[] = [
	userMsg(IDS.tsUser1, IDS.sessionTests, NOW - 3 * HOUR),
	assistantMsg(
		IDS.tsAssistant1,
		IDS.sessionTests,
		IDS.tsUser1,
		NOW - 3 * HOUR + 2000,
		NOW - 2 * HOUR,
	),
]

const testsParts: Record<string, Part[]> = {
	[IDS.tsUser1]: [
		textPart(
			IDS.tsUser1,
			IDS.sessionTests,
			0,
			"Write comprehensive unit tests for the auth middleware. Cover token validation, expiry handling, refresh flow, and error cases.",
			3 * HOUR,
		),
	],
	[IDS.tsAssistant1]: [
		toolPart(
			IDS.tsAssistant1,
			IDS.sessionTests,
			0,
			"bash",
			"Run existing tests",
			{ command: "bun test src/middleware/" },
			"No test files found in src/middleware/",
			3 * HOUR - 3000,
		),
		toolPart(
			IDS.tsAssistant1,
			IDS.sessionTests,
			1,
			"edit",
			"Edit src/middleware/auth.test.ts",
			{
				path: "src/middleware/auth.test.ts",
				diff: '+import { describe, expect, it, mock } from "bun:test"\n+import { validateToken, refreshToken, authMiddleware } from "./auth"\n+\n+describe("validateToken", () => {\n+  it("returns true for valid non-expired token", () => { ... })\n+  it("returns false for expired token", () => { ... })\n+  it("returns false for malformed token", () => { ... })\n+})\n+\n+describe("authMiddleware", () => {\n+  it("passes through when token is valid", async () => { ... })\n+  it("refreshes expired token automatically", async () => { ... })\n+  it("returns 401 when refresh fails", async () => { ... })\n+})',
			},
			"Created src/middleware/auth.test.ts",
			2.5 * HOUR,
		),
		toolPart(
			IDS.tsAssistant1,
			IDS.sessionTests,
			2,
			"bash",
			"Run tests",
			{ command: "bun test src/middleware/auth.test.ts" },
			"PASS  src/middleware/auth.test.ts\n  validateToken\n    ✓ returns true for valid non-expired token (3ms)\n    ✓ returns false for expired token (2ms)\n    ✓ returns false for malformed token (1ms)\n  authMiddleware\n    ✓ passes through when token is valid (8ms)\n    ✓ refreshes expired token automatically (12ms)\n    ✓ returns 401 when refresh fails (5ms)\n\nTests: 6 passed, 6 total\nTime: 0.31s",
			2 * HOUR,
		),
		textPart(
			IDS.tsAssistant1,
			IDS.sessionTests,
			3,
			"All 6 tests pass. I've created comprehensive tests covering:\n\n1. **Token validation**: valid tokens, expired tokens, and malformed tokens\n2. **Middleware flow**: successful auth, automatic refresh on expiry, and proper 401 responses when refresh fails\n\nThe tests use `bun:test` with mocked fetch calls for the refresh endpoint.",
			2 * HOUR,
		),
	],
}

// ============================================================
// Docs session
// ============================================================

const docsMessages: Message[] = [
	userMsg(IDS.dcUser1, IDS.sessionDocs, NOW - 5 * HOUR),
	assistantMsg(
		IDS.dcAssistant1,
		IDS.sessionDocs,
		IDS.dcUser1,
		NOW - 5 * HOUR + 2000,
		NOW - 4 * HOUR,
	),
]

const docsParts: Record<string, Part[]> = {
	[IDS.dcUser1]: [
		textPart(
			IDS.dcUser1,
			IDS.sessionDocs,
			0,
			"Update the API docs to document the new v2 endpoints. Include request/response examples and error codes.",
			5 * HOUR,
		),
	],
	[IDS.dcAssistant1]: [
		toolPart(
			IDS.dcAssistant1,
			IDS.sessionDocs,
			0,
			"read",
			"Read docs/api/v2.md",
			{ path: "docs/api/v2.md" },
			"# API v2\n\n> TODO: Document new endpoints",
			5 * HOUR - 3000,
		),
		textPart(
			IDS.dcAssistant1,
			IDS.sessionDocs,
			1,
			"I've updated the API documentation with complete coverage of all v2 endpoints, including:\n\n- Authentication endpoints (`POST /v2/auth/login`, `POST /v2/auth/refresh`)\n- User management (`GET /v2/users`, `PATCH /v2/users/:id`)\n- Request/response schemas with TypeScript types\n- Error codes and their meanings (400, 401, 403, 404, 429, 500)\n- Rate limiting headers and retry guidance",
			4 * HOUR,
		),
	],
}

// ============================================================
// Public API: collected mock data
// ============================================================

export const MOCK_MESSAGES: Map<string, Message[]> = new Map([
	[IDS.sessionDarkMode, darkModeMessages],
	[IDS.sessionAuthFix, authFixMessages],
	[IDS.sessionRefactor, refactorMessages],
	[IDS.sessionLanding, landingMessages],
	[IDS.sessionTests, testsMessages],
	[IDS.sessionDocs, docsMessages],
])

export const MOCK_PARTS: Map<string, Record<string, Part[]>> = new Map([
	[IDS.sessionDarkMode, darkModeParts],
	[IDS.sessionAuthFix, authFixParts],
	[IDS.sessionRefactor, refactorParts],
	[IDS.sessionLanding, landingParts],
	[IDS.sessionTests, testsParts],
	[IDS.sessionDocs, docsParts],
])

/** The first session ID, suitable for navigating to after enabling mock mode */
export const MOCK_DEFAULT_SESSION_ID = IDS.sessionDarkMode

/** Project slug for the default session (palot project) */
export const MOCK_DEFAULT_PROJECT_SLUG = `palot-${IDS.projectPalot.slice(0, 12)}`
