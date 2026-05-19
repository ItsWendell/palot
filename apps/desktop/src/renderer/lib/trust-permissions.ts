/**
 * Trust-profile permission policy for OpenCode agent requests.
 */

import {
	AUTO_APPROVED_ACTIONS,
	DEFAULT_TRUST_SETTINGS,
	type PermissionAuditEntry,
	type PermissionMemoryEntry,
	type ProjectTrustSettings,
	type TrustProfile,
	type TrustSettings,
} from "../../shared/trust"

export type PermissionDecisionAction = "auto-approve" | "require-approval" | "deny"

export interface PermissionLike {
	id: string
	sessionID: string
	permission: string
	patterns: string[]
	metadata: Record<string, unknown>
	always: string[]
}

export interface PermissionDecision {
	action: PermissionDecisionAction
	reason: string
	batchKey: string
}

export interface PermissionEvaluationInput {
	request: PermissionLike
	projectPath: string
	profile: TrustProfile
	memory?: PermissionMemoryEntry[]
}

export interface BatchedPermissionDecision extends PermissionDecision {
	request: PermissionLike
	batchId?: string
}

const AUDIT_LOG_LIMIT = 500
const MEMORY_LIMIT = 200
const SAFE_READ_PERMISSIONS = new Set(["read", "glob", "grep", "list"])
const EDIT_PERMISSIONS = new Set(["edit", "write"])
const WORKSPACE_WRITE_PERMISSIONS = new Set(["edit", "write", "patch"])
const SYSTEM_PATH_PREFIXES = [
	"/Applications",
	"/Library",
	"/System",
	"/Volumes",
	"/bin",
	"/dev",
	"/etc",
	"/opt",
	"/private/etc",
	"/sbin",
	"/usr",
	"/var",
]

// ============================================================
// Public API
// ============================================================

export function getAutoApprovedActionLabels(profile: TrustProfile): string[] {
	return AUTO_APPROVED_ACTIONS[profile]
}

export function normalizeTrustSettings(settings?: TrustSettings): TrustSettings {
	return {
		defaultProfile: settings?.defaultProfile ?? DEFAULT_TRUST_SETTINGS.defaultProfile,
		projects: settings?.projects ?? {},
		auditLog: settings?.auditLog ?? [],
	}
}

export function getProjectTrustProfile(
	settings: TrustSettings | undefined,
	projectPath: string,
	parentProfile?: TrustProfile,
): TrustProfile {
	const normalized = normalizeTrustSettings(settings)
	return normalized.projects[projectPath]?.profile ?? parentProfile ?? normalized.defaultProfile
}

export function getProjectTrustMemory(
	settings: TrustSettings | undefined,
	projectPath: string,
	profile: TrustProfile,
): PermissionMemoryEntry[] {
	const project = normalizeTrustSettings(settings).projects[projectPath]
	return (project?.memory ?? []).filter((entry) => entry.profile === profile)
}

export function resolveInheritedTrustProfile(
	parentProfile: TrustProfile,
	childProfile?: TrustProfile,
): TrustProfile {
	return childProfile ?? parentProfile
}

export function evaluatePermissionRequest(input: PermissionEvaluationInput): PermissionDecision {
	const permission = input.request.permission.toLowerCase()
	const memoryDecision = findMemoryDecision(input)
	if (memoryDecision) return memoryDecision

	const dangerous = detectDangerousRequest(input.request, input.projectPath)
	if (dangerous) {
		return {
			action: "require-approval",
			reason: dangerous,
			batchKey: "requires-approval",
		}
	}

	if (SAFE_READ_PERMISSIONS.has(permission)) {
		if (!patternsStayInWorkspace(input.request.patterns, input.projectPath)) {
			return {
				action: "require-approval",
				reason: "Read/search request reaches outside the active workspace.",
				batchKey: "workspace-boundary",
			}
		}
		if (input.profile === "strict") {
			return {
				action: "require-approval",
				reason: "Strict profile asks before routine inspection.",
				batchKey: "strict-read",
			}
		}
		return {
			action: "auto-approve",
			reason: `${labelProfile(input.profile)} profile allows read/search inside the workspace.`,
			batchKey: "workspace-read",
		}
	}

	if (WORKSPACE_WRITE_PERMISSIONS.has(permission)) {
		if (!patternsStayInWorkspace(input.request.patterns, input.projectPath)) {
			return {
				action: "require-approval",
				reason: "Write request reaches outside the active workspace.",
				batchKey: "workspace-boundary",
			}
		}
		if (input.profile !== "autonomous") {
			return {
				action: "require-approval",
				reason: `${labelProfile(input.profile)} profile requires approval before file edits.`,
				batchKey: "workspace-edit",
			}
		}
		return {
			action: "auto-approve",
			reason: "Autonomous profile allows file edits and patches inside the workspace.",
			batchKey: "workspace-edit",
		}
	}

	if (permission === "bash") {
		return evaluateCommandRequest(input)
	}

	if (permission === "task") {
		return evaluateTaskRequest(input)
	}

	if (EDIT_PERMISSIONS.has(permission) && input.profile !== "autonomous") {
		return {
			action: "require-approval",
			reason: `${labelProfile(input.profile)} profile requires approval for workspace changes.`,
			batchKey: "workspace-edit",
		}
	}

	return {
		action: "require-approval",
		reason: `No auto-approval rule matched "${input.request.permission}".`,
		batchKey: "unmatched",
	}
}

export function evaluatePermissionBatch(
	requests: PermissionLike[],
	input: Omit<PermissionEvaluationInput, "request">,
	now = Date.now(),
): BatchedPermissionDecision[] {
	const evaluated = requests.map((request) => ({
		request,
		...evaluatePermissionRequest({ ...input, request }),
	}))
	const counts = new Map<string, number>()
	for (const item of evaluated) {
		if (item.action === "auto-approve") {
			counts.set(item.batchKey, (counts.get(item.batchKey) ?? 0) + 1)
		}
	}
	return evaluated.map((item) => ({
		...item,
		batchId:
			item.action === "auto-approve" && (counts.get(item.batchKey) ?? 0) > 1
				? `batch-${now}-${item.batchKey}`
				: undefined,
	}))
}

export function rememberPermissionApproval({
	settings,
	projectPath,
	profile,
	request,
	decision = "allow",
	reason = "User approved this pattern for the current project and trust profile.",
	now = Date.now(),
}: {
	settings: TrustSettings | undefined
	projectPath: string
	profile: TrustProfile
	request: PermissionLike
	decision?: "allow" | "deny"
	reason?: string
	now?: number
}): TrustSettings {
	const normalized = normalizeTrustSettings(settings)
	const project = normalized.projects[projectPath] ?? createEmptyProjectTrustSettings()
	const patterns = request.patterns.length > 0 ? request.patterns : [metadataCommand(request) ?? "*"]
	const additions = patterns.map((pattern) => ({
		id: `${now}-${request.id}-${pattern}`,
		projectPath,
		profile,
		permission: request.permission,
		pattern,
		decision,
		reason,
		createdAt: now,
	}))
	const nextMemory = dedupeMemory([...project.memory, ...additions]).slice(-MEMORY_LIMIT)
	return {
		...normalized,
		projects: {
			...normalized.projects,
			[projectPath]: {
				...project,
				memory: nextMemory,
			},
		},
	}
}

export function appendPermissionAuditLog(
	settings: TrustSettings | undefined,
	entry: PermissionAuditEntry,
): TrustSettings {
	const normalized = normalizeTrustSettings(settings)
	return {
		...normalized,
		auditLog: [...normalized.auditLog, entry].slice(-AUDIT_LOG_LIMIT),
	}
}

export function createPermissionAuditEntry({
	request,
	projectPath,
	profile,
	decision,
	batchId,
	now = Date.now(),
}: {
	request: PermissionLike
	projectPath: string
	profile: TrustProfile
	decision: PermissionDecision
	batchId?: string
	now?: number
}): PermissionAuditEntry {
	return {
		id: `${now}-${request.id}`,
		timestamp: now,
		projectPath,
		sessionId: request.sessionID,
		profile,
		permission: request.permission,
		patterns: request.patterns,
		decision: decision.action === "deny" ? "auto-denied" : "auto-approved",
		reason: decision.reason,
		batchId,
	}
}

// ============================================================
// Evaluation helpers
// ============================================================

function evaluateCommandRequest(input: PermissionEvaluationInput): PermissionDecision {
	const command = metadataCommand(input.request)
	if (!command) {
		return {
			action: "require-approval",
			reason: "Command text was unavailable, so Nexus Builder could not verify it is safe.",
			batchKey: "unknown-command",
		}
	}
	const normalized = normalizeCommand(command)
	const dangerous = detectDangerousCommand(normalized)
	if (dangerous) {
		return {
			action: "require-approval",
			reason: dangerous,
			batchKey: "dangerous-command",
		}
	}
	if (isSafeGitInspectionCommand(normalized)) {
		if (input.profile === "strict") {
			return {
				action: "require-approval",
				reason: "Strict profile asks before shell commands.",
				batchKey: "strict-command",
			}
		}
		return {
			action: "auto-approve",
			reason: `${labelProfile(input.profile)} profile allows low-risk git inspection commands.`,
			batchKey: "safe-git-command",
		}
	}
	if (isSafeDevelopmentCommand(normalized)) {
		if (input.profile !== "autonomous") {
			return {
				action: "require-approval",
				reason: `${labelProfile(input.profile)} profile requires approval before development commands.`,
				batchKey: "safe-dev-command",
			}
		}
		return {
			action: "auto-approve",
			reason: "Autonomous profile allows common development commands in the workspace.",
			batchKey: "safe-dev-command",
		}
	}
	return {
		action: "require-approval",
		reason: `Command "${normalized}" is not on the auto-approved command list.`,
		batchKey: "unknown-command",
	}
}

function evaluateTaskRequest(input: PermissionEvaluationInput): PermissionDecision {
	const text = requestText(input.request)
	if (input.profile !== "autonomous") {
		return {
			action: "require-approval",
			reason: `${labelProfile(input.profile)} profile requires approval before spawning subagents.`,
			batchKey: "task",
		}
	}
	if (/\b(read-only|readonly|research|explore|inspect)\b/i.test(text) && !/\b(edit|write|patch|apply|build)\b/i.test(text)) {
		return {
			action: "auto-approve",
			reason: "Autonomous profile allows read-only research subagents.",
			batchKey: "readonly-subagent",
		}
	}
	return {
		action: "require-approval",
		reason: "Only read-only research subagents are auto-approved.",
		batchKey: "task",
	}
}

function findMemoryDecision(input: PermissionEvaluationInput): PermissionDecision | null {
	const patterns = input.request.patterns.length > 0 ? input.request.patterns : [metadataCommand(input.request) ?? "*"]
	const match = (input.memory ?? []).find(
		(entry) =>
			entry.profile === input.profile &&
			entry.permission === input.request.permission &&
			patterns.some((pattern) => patternMatchesMemory(pattern, entry.pattern)),
	)
	if (!match) return null
	return {
		action: match.decision === "allow" ? "auto-approve" : "deny",
		reason: `Remembered ${match.decision} for this project/profile: ${match.pattern}`,
		batchKey: "approval-memory",
	}
}

function detectDangerousRequest(request: PermissionLike, projectPath: string): string | null {
	const permission = request.permission.toLowerCase()
	if (permission === "external_directory") {
		return "Access outside the workspace requires explicit approval."
	}
	if (permission === "bash") {
		const command = metadataCommand(request)
		return command ? detectDangerousCommand(normalizeCommand(command)) : null
	}
	if (WORKSPACE_WRITE_PERMISSIONS.has(permission) && !patternsStayInWorkspace(request.patterns, projectPath)) {
		return "File changes outside the active workspace require explicit approval."
	}
	return null
}

function detectDangerousCommand(command: string): string | null {
	if (/\bsudo\b/.test(command)) return "sudo requires explicit approval."
	if (/\brm\s+(-[^\s]*r[^\s]*f|-[^\s]*f[^\s]*r)\b/.test(command)) {
		return "Recursive force deletes require explicit approval."
	}
	if (/\b(chmod|chown)\b/.test(command)) return "chmod/chown requires explicit approval."
	if (/\bgit\s+push\b/.test(command)) return "Git push requires explicit approval."
	if (/\bgit\s+branch\s+(--delete|-d|-D)\b/.test(command)) {
		return "Git branch deletion requires explicit approval."
	}
	if (/\b(vercel|netlify|flyctl|railway|render)\b.*\b(--prod|production)\b/.test(command)) {
		return "Production deployments require explicit approval."
	}
	if (/\b(export|printenv)\b.*\b(secret|token|key|password)\b/i.test(command)) {
		return "Secret or environment variable export requires explicit approval."
	}
	if (/\b(set\s+-a|source\s+\.env|source\s+.*\.env)\b/.test(command)) {
		return "Loading or exporting environment files requires explicit approval."
	}
	if (
		/\b(curl|wget|httpie|npx|pnpm\s+dlx|bunx)\b/.test(command) &&
		!isSafeDevelopmentCommand(command)
	) {
		return "Network access to unknown hosts requires explicit approval."
	}
	return null
}

function isSafeDevelopmentCommand(command: string): boolean {
	return (
		/^npm install(\s+[-@./:\w]+)*$/.test(command) ||
		/^npm run (dev|build|lint|test)(\s+--\s+.*)?$/.test(command) ||
		/^bun test(\s+.*)?$/.test(command) ||
		command === "tsc --noEmit"
	)
}

function isSafeGitInspectionCommand(command: string): boolean {
	return /^git status(\s+(-s|--short|--porcelain|--branch))*$/.test(command) || /^git diff(\s+(--stat|--cached|--name-only|--check))*$/.test(command)
}

function patternsStayInWorkspace(patterns: string[], projectPath: string): boolean {
	if (patterns.length === 0) return true
	return patterns.every((pattern) => patternStaysInWorkspace(pattern, projectPath))
}

function patternStaysInWorkspace(pattern: string, projectPath: string): boolean {
	const cleaned = stripGlobMeta(pattern.trim())
	if (!cleaned || cleaned === "*") return true
	if (cleaned.startsWith("~")) return false
	if (cleaned === ".." || cleaned.startsWith("../") || cleaned.includes("/../")) return false
	if (!cleaned.startsWith("/")) return true
	const project = normalizeAbsolutePath(projectPath)
	const candidate = normalizeAbsolutePath(cleaned)
	if (candidate === project || candidate.startsWith(`${project}/`)) return true
	if (SYSTEM_PATH_PREFIXES.some((prefix) => candidate === prefix || candidate.startsWith(`${prefix}/`))) {
		return false
	}
	return false
}

function stripGlobMeta(pattern: string): string {
	const globIndex = pattern.search(/[*?[{]/)
	const stripped = globIndex >= 0 ? pattern.slice(0, globIndex) : pattern
	return stripped.replace(/\/+$/, "")
}

function normalizeAbsolutePath(value: string): string {
	return value.replace(/\/+/g, "/").replace(/\/$/, "")
}

function metadataCommand(request: PermissionLike): string | null {
	for (const key of ["command", "cmd", "description", "input"]) {
		const value = request.metadata?.[key]
		if (typeof value === "string" && value.trim()) return value
	}
	const firstPattern = request.patterns[0]
	if (firstPattern?.trim()) return firstPattern
	return null
}

function requestText(request: PermissionLike): string {
	return [
		request.permission,
		...request.patterns,
		...Object.values(request.metadata ?? {}).map((value) =>
			typeof value === "string" ? value : JSON.stringify(value),
		),
	].join(" ")
}

function normalizeCommand(command: string): string {
	return command
		.trim()
		.replace(/\s+/g, " ")
		.replace(/^(cd\s+[^;&|]+\s*&&\s*)/, "")
}

function patternMatchesMemory(pattern: string, remembered: string): boolean {
	return remembered === "*" || pattern === remembered || normalizeCommand(pattern) === normalizeCommand(remembered)
}

function createEmptyProjectTrustSettings(): ProjectTrustSettings {
	return { memory: [] }
}

function dedupeMemory(memory: PermissionMemoryEntry[]): PermissionMemoryEntry[] {
	const byKey = new Map<string, PermissionMemoryEntry>()
	for (const entry of memory) {
		byKey.set(
			`${entry.profile}:${entry.projectPath}:${entry.permission}:${entry.pattern}:${entry.decision}`,
			entry,
		)
	}
	return [...byKey.values()]
}

function labelProfile(profile: TrustProfile): string {
	return profile[0].toUpperCase() + profile.slice(1)
}
