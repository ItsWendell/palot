/**
 * OpenCode type definitions.
 *
 * Re-exports canonical types from @opencode-ai/sdk where available,
 * and defines local aliases for convenience in the converter.
 */

// ─── Re-exports from SDK ─────────────────────────────────────────────
// These are the authoritative types generated from the OpenCode OpenAPI spec.

export type {
	// Agent (runtime, from server)
	Agent as OpenCodeAgent,
	// Agent (config-time)
	AgentConfig as OpenCodeAgentConfig,
	AgentPart as OpenCodeAgentPart,
	AssistantMessage as OpenCodeAssistantMessage,
	// Commands
	Command as OpenCodeCommand,
	CompactionPart as OpenCodeCompactionPart,
	// Top-level config
	Config as OpenCodeConfig,
	FilePart as OpenCodeFilePart,
	// MCP
	McpLocalConfig as OpenCodeMcpLocal,
	McpOAuthConfig as OpenCodeMcpOAuth,
	McpRemoteConfig as OpenCodeMcpRemote,
	Message as OpenCodeMessage,
	// Models
	Model as OpenCodeModel,
	Part as OpenCodePart,
	PatchPart as OpenCodePatchPart,
	// Permissions (runtime format)
	PermissionAction,
	PermissionActionConfig as OpenCodePermissionAction,
	// Permissions (config-time format)
	PermissionConfig as OpenCodePermission,
	PermissionObjectConfig as OpenCodePermissionObject,
	PermissionRule,
	PermissionRuleConfig as OpenCodePermissionRule,
	PermissionRuleset,
	Provider as OpenCodeProvider,
	// Provider
	ProviderConfig as OpenCodeProviderConfig,
	ReasoningPart as OpenCodeReasoningPart,
	RetryPart as OpenCodeRetryPart,
	// Server config
	ServerConfig as OpenCodeServerConfig,
	// Session / Messages / Parts
	Session as OpenCodeSession,
	SnapshotPart as OpenCodeSnapshotPart,
	StepFinishPart as OpenCodeStepFinishPart,
	StepStartPart as OpenCodeStepStartPart,
	SubtaskPart as OpenCodeSubtaskPart,
	TextPart as OpenCodeTextPart,
	ToolPart as OpenCodeToolPart,
	UserMessage as OpenCodeUserMessage,
} from "@opencode-ai/sdk/v2/client"

// ─── Local convenience types ─────────────────────────────────────────
// These are for converter internals only -- types that don't come from the SDK.

/** MCP config union (matches SDK's Config.mcp values) */
export type OpenCodeMcp =
	| import("@opencode-ai/sdk/v2/client").McpLocalConfig
	| import("@opencode-ai/sdk/v2/client").McpRemoteConfig
	| { enabled: boolean }

/** Agent markdown frontmatter for .opencode/agents/*.md */
export interface OpenCodeAgentFrontmatter {
	description?: string
	mode?: "subagent" | "primary" | "all"
	model?: string
	temperature?: number
	color?: string
	steps?: number
	permission?: import("@opencode-ai/sdk/v2/client").PermissionConfig
	hidden?: boolean
}

/** Command markdown frontmatter for .opencode/commands/*.md */
export interface OpenCodeCommandFrontmatter {
	description?: string
	agent?: string
	model?: string
	subtask?: boolean
}
