/**
 * Shared trust-profile settings for agent permissions.
 */

export type TrustProfile = "strict" | "balanced" | "autonomous"

export type PermissionMemoryDecision = "allow" | "deny"

export interface PermissionMemoryEntry {
	id: string
	profile: TrustProfile
	projectPath: string
	permission: string
	pattern: string
	decision: PermissionMemoryDecision
	reason: string
	createdAt: number
}

export interface PermissionAuditEntry {
	id: string
	timestamp: number
	projectPath: string
	sessionId: string
	profile: TrustProfile
	permission: string
	patterns: string[]
	decision: "auto-approved" | "auto-denied"
	reason: string
	batchId?: string
}

export interface ProjectTrustSettings {
	profile?: TrustProfile
	memory: PermissionMemoryEntry[]
}

export interface TrustSettings {
	defaultProfile: TrustProfile
	projects: Record<string, ProjectTrustSettings>
	auditLog: PermissionAuditEntry[]
}

export interface TrustProfileOption {
	value: TrustProfile
	label: string
	description: string
}

export const TRUST_PROFILE_OPTIONS: TrustProfileOption[] = [
	{
		value: "strict",
		label: "Strict",
		description: "Ask before most actions. Best when reviewing unfamiliar projects.",
	},
	{
		value: "balanced",
		label: "Balanced",
		description: "Auto-approve read-only inspection and low-risk git checks.",
	},
	{
		value: "autonomous",
		label: "Autonomous",
		description: "Let agents inspect, edit, test, and build inside this workspace.",
	},
]

export const DEFAULT_TRUST_SETTINGS: TrustSettings = {
	defaultProfile: "autonomous",
	projects: {},
	auditLog: [],
}

export const AUTO_APPROVED_ACTIONS: Record<TrustProfile, string[]> = {
	strict: ["Previously remembered approvals for this project and profile"],
	balanced: [
		"Read and search files inside the project",
		"Check git status and git diff",
		"Previously remembered approvals for this project and profile",
	],
	autonomous: [
		"Read and search files inside the project",
		"Create and edit files inside the project",
		"Create and update tests inside the project",
		"Apply patches inside the project",
		"Run npm install, npm run dev/build/lint/test",
		"Run bun test and tsc --noEmit",
		"Check git status and git diff",
		"Spawn read-only research subagents",
		"Previously remembered approvals for this project and profile",
	],
}
