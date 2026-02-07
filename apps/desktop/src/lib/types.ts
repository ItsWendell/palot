// Re-export SDK types that we use across the app
export type {
	AssistantMessage,
	Event,
	EventMessagePartUpdated,
	EventPermissionUpdated,
	EventSessionCreated,
	EventSessionDeleted,
	EventSessionError,
	EventSessionStatus,
	EventSessionUpdated,
	FileDiff,
	Message,
	Part,
	Permission,
	Project as OpenCodeProject,
	Session,
	SessionStatus,
	TextPart,
	Todo,
	ToolPart,
	ToolState,
	UserMessage,
} from "@opencode-ai/sdk"

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
	branch: string
	duration: string
	tokens: number
	cost: number
	currentActivity?: string
	activities: Activity[]
	/** The underlying OpenCode session ID */
	sessionId: string
	/** The server instance this agent belongs to */
	serverId: string
}

/** Legacy Project type for sidebar display */
export interface Project {
	name: string
	agentCount: number
}
