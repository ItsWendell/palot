// Import SDK types we reference in our own interfaces
import type {
	PermissionRequest as SdkPermissionRequest,
	QuestionRequest as SdkQuestionRequest,
} from "@opencode-ai/sdk/v2/client"

// Re-export all SDK types from v2
export type {
	AssistantMessage,
	Event,
	EventMessagePartDelta,
	EventMessagePartUpdated,
	EventPermissionAsked,
	EventSessionCreated,
	EventSessionDeleted,
	EventSessionError,
	EventSessionStatus,
	EventSessionUpdated,
	FileDiff,
	FilePart,
	FilePartInput,
	Message,
	Part,
	PermissionRequest,
	Project as OpenCodeProject,
	QuestionAnswer,
	QuestionInfo,
	QuestionOption,
	QuestionRequest,
	ReasoningPart,
	Session,
	SessionStatus,
	TextPart,
	Todo,
	ToolPart,
	ToolState,
	ToolStateCompleted,
	UserMessage,
} from "@opencode-ai/sdk/v2/client"

// ============================================================
// File attachment types
// ============================================================

/**
 * A file attachment ready to send — matches the shape returned by
 * PromptInput's onSubmit callback (FileUIPart from the `ai` package).
 */
export interface FileAttachment {
	type: "file"
	url: string
	mediaType?: string
	filename?: string
}

// ============================================================
// App-specific types
// ============================================================

/** An OpenCode server instance we're managing */
export interface ServerInstance {
	/** Unique ID for this server */
	id: string
	/** The project directory this server is for */
	directory: string
	/** URL of the running server */
	url: string
	/** Whether the server is healthy */
	connected: boolean
}

/** Where an agent runs */
export type EnvironmentType = "local" | "cloud" | "vm"

/** Derived agent status for UI display, mapped from SessionStatus */
export type AgentStatus = "running" | "waiting" | "paused" | "completed" | "failed" | "idle"

/** Project in the sidebar — aggregates from OpenCode projects */
export interface ProjectInfo {
	id: string
	name: string
	directory: string
	agentCount: number
}

/** Enriched project for the unified sidebar (includes directory for auto-start) */
export interface SidebarProject {
	/** OpenCode project ID (root commit hash) or hash of directory as fallback */
	id: string
	/** URL-safe slug: always `{name}-{id.slice(0,12)}` for stability */
	slug: string
	name: string
	directory: string
	agentCount: number
	lastActiveAt: number
}

/** Activity entry for the detail panel — derived from message parts */
export interface Activity {
	id: string
	timestamp: string
	type: "read" | "search" | "edit" | "run" | "think" | "write" | "tool"
	description: string
	detail?: string
}

/**
 * Agent is our UI-facing representation of an OpenCode session.
 * It merges Session data + SessionStatus + derived activity info.
 */
export interface Agent {
	id: string
	name: string
	status: AgentStatus
	environment: EnvironmentType
	project: string
	/** URL slug for the project (for router navigation) */
	projectSlug: string
	/** Full project directory path (for auto-starting servers) */
	directory: string
	branch: string
	/** Relative "last active" time, e.g. "5m" */
	duration: string
	/** Formatted total agent work time, e.g. "1m 34s" */
	workTime: string
	/** Raw agent work time in ms (for live-ticking) */
	workTimeMs: number
	/** Total tokens used (raw count) */
	tokens: number
	/** Total cost in USD (raw) */
	cost: number
	/** Formatted cost string, e.g. "$0.45" */
	costFormatted: string
	/** Formatted token string, e.g. "12.3k" */
	tokensFormatted: string
	/** Number of exchanges (user message + assistant responses) in this session */
	exchangeCount: number
	currentActivity?: string
	activities: Activity[]
	/** The underlying OpenCode session ID */
	sessionId: string
	/** Pending permission requests for this agent */
	permissions: SdkPermissionRequest[]
	/** Pending question requests for this agent */
	questions: SdkQuestionRequest[]
	/** If set, this is a sub-agent spawned by the parent session */
	parentId?: string
	/** If set, the session runs in a git worktree at this root path */
	worktreePath?: string
	/** The branch name auto-created for the worktree (e.g. "palot/fix-auth-bug") */
	worktreeBranch?: string
	/** Timestamp (ms) of session creation — stable, never changes */
	createdAt: number
	/** Timestamp (ms) of last activity — for sorting and relative time display */
	lastActiveAt: number
}

/** Legacy Project type for sidebar display */
export interface Project {
	name: string
	agentCount: number
}
