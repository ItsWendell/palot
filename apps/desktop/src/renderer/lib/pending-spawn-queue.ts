/**
 * Pending-spawn queue — two detection modes:
 *
 * 1. JSON message blocks (primary) — Lead Agent emits a structured JSON block
 *    in its chat output. Nexus Builder detects it in real-time without requiring any
 *    MCP tool call to succeed.
 *
 *    Format:
 *    ```json
 *    {
 *      "type": "palot.spawn_request",
 *      "agents": [
 *        { "name": "react-specialist", "task": "Fix the scroll bug", "reason": "UI work" }
 *      ]
 *    }
 *    ```
 *
 * 2. Brain file (backup) — Lead Agent writes `brain_append "spawn-requests"`.
 *    Polled every 10 s. Useful when the Lead Agent uses MCP tools.
 *
 *    Format:
 *    ## REQUEST:agent-name:ISO-timestamp
 *    - **Agent**: agent-name
 *    - **Reason**: one-line reason
 *    - **Status**: pending
 */

export interface SpawnRequest {
	/** Unique identifier: "<agent>:<requestedAt>" */
	id: string
	agent: string
	/** What this agent will work on — used as customInstruction when spawning */
	task: string
	/** Why this agent was selected — shown to the user in the pending-spawn UI */
	reason: string
	status: "pending" | "approved" | "rejected"
	requestedAt: string
}

export interface SpawnTeamTemplate {
	name: string
	agents: string[]
}

interface JsonSpawnTeam {
	name: string
	task?: string
	reason?: string
}

export const SPAWN_TEAM_TEMPLATES: Record<string, SpawnTeamTemplate> = {
	"frontend-team": {
		name: "Frontend Team",
		agents: ["react-specialist", "typescript-pro", "code-reviewer"],
	},
	"backend-team": {
		name: "Backend Team",
		agents: ["typescript-pro", "api-designer", "code-reviewer"],
	},
	"infrastructure-team": {
		name: "Infrastructure Team",
		agents: ["devops-engineer", "security-auditor"],
	},
	"architecture-team": {
		name: "Architecture Team",
		agents: ["architect-reviewer", "code-reviewer"],
	},
	"research-team": {
		name: "Research Team",
		agents: ["research-analyst", "knowledge-synthesizer"],
	},
	"full-build-team": {
		name: "Full Build Team",
		agents: ["architect-reviewer", "fullstack-developer", "code-reviewer"],
	},
}

/** Parse all spawn requests from the brain slug content. */
export function parseSpawnRequests(content: string | null): SpawnRequest[] {
	if (!content) return []
	const requests: SpawnRequest[] = []
	const sections = content.split(/(?=^## REQUEST:)/m).filter((s) => s.startsWith("## REQUEST:"))

	for (const section of sections) {
		const headerMatch = section.match(/^## REQUEST:([^:\n]+):([^\n]+)/)
		if (!headerMatch) continue
		const [, agentFromHeader, requestedAt] = headerMatch

		const agentMatch = section.match(/- \*\*Agent\*\*:\s*(.+)/)
		const reasonMatch = section.match(/- \*\*Reason\*\*:\s*(.+)/)
		const statusMatch = section.match(/- \*\*Status\*\*:\s*(pending|approved|rejected)/)

		const agent = (agentMatch?.[1] ?? agentFromHeader).trim()
		const reason = reasonMatch?.[1]?.trim() ?? ""
		const status = (statusMatch?.[1]?.trim() ?? "pending") as SpawnRequest["status"]

		requests.push({ id: `${agent}:${requestedAt.trim()}`, agent, task: reason, reason, status, requestedAt: requestedAt.trim() })
	}

	return requests
}

/** Returns only pending requests. */
export function pendingRequests(requests: SpawnRequest[]): SpawnRequest[] {
	return requests.filter((r) => r.status === "pending")
}

/** Returns updated content with the given request ID marked as approved. */
export function markRequestApproved(content: string, id: string): string {
	const [agent, requestedAt] = id.split(/:(.+)/)
	const headerEscaped = `## REQUEST:${agent}:${requestedAt}`

	return content.replace(
		new RegExp(`(${escapeRegex(headerEscaped)}[\\s\\S]*?)- \\*\\*Status\\*\\*: pending`, "m"),
		"$1- **Status**: approved",
	)
}

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Build a brain_append payload the Lead Agent should use to request a spawn. */
export function buildSpawnRequestMarkdown(agent: string, reason: string): string {
	const ts = new Date().toISOString()
	return [
		`## REQUEST:${agent}:${ts}`,
		`- **Agent**: ${agent}`,
		`- **Reason**: ${reason}`,
		`- **Status**: pending`,
		"",
	].join("\n")
}

// ============================================================
// JSON message block parser (primary detection path)
// ============================================================

interface JsonSpawnAgent {
	name: string
	task?: string
	reason?: string
}

interface JsonSpawnBlock {
	type: "palot.spawn_request"
	agents?: JsonSpawnAgent[]
	teams?: JsonSpawnTeam[]
}

/**
 * Extract spawn requests embedded in Lead Agent text output.
 *
 * Searches for ```json ... ``` fences that contain a `palot.spawn_request`
 * block. Returns one SpawnRequest per agent entry.
 */
export function parseSpawnRequestsFromText(text: string): SpawnRequest[] {
	if (!text) return []
	const requests: SpawnRequest[] = []
	// Match ```json ... ``` and ``` ... ``` (no language tag)
	const FENCE_RE = /```(?:json)?\s*([\s\S]*?)\s*```/g
	let match: RegExpExecArray | null

	while ((match = FENCE_RE.exec(text)) !== null) {
		let block: unknown
		try {
			block = JSON.parse(match[1])
		} catch {
			continue
		}
		if (
			typeof block !== "object" ||
			block === null ||
			(block as JsonSpawnBlock).type !== "palot.spawn_request" ||
			(!Array.isArray((block as JsonSpawnBlock).agents) &&
				!Array.isArray((block as JsonSpawnBlock).teams))
		) {
			continue
		}
		const ts = new Date().toISOString()
		for (const team of (block as JsonSpawnBlock).teams ?? []) {
			const template = SPAWN_TEAM_TEMPLATES[team.name]
			if (!template) continue
			const task = team.task ?? team.reason ?? ""
			const reason = team.reason ?? template.name
			for (const agentName of template.agents) {
				const id = `msg:${team.name}:${agentName}:${ts}`
				requests.push({
					id,
					agent: agentName,
					task,
					reason,
					status: "pending",
					requestedAt: ts,
				})
			}
		}
		for (const agent of (block as JsonSpawnBlock).agents ?? []) {
			if (!agent.name) continue
			const task = agent.task ?? agent.reason ?? ""
			const reason = agent.reason ?? agent.task ?? ""
			const id = `msg:${agent.name}:${ts}`
			requests.push({ id, agent: agent.name, task, reason, status: "pending", requestedAt: ts })
		}
	}

	return requests
}
