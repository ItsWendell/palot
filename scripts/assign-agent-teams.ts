/**
 * Assigns all builtin agents to teams, marks leaders, and injects
 * the team leadership communication protocol into leader system prompts.
 *
 * Run with: bun scripts/assign-agent-teams.ts
 */

import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const AGENTS_DIR = path.join(__dirname, "../apps/desktop/src/main/builtin-agents")

// ---------------------------------------------------------------------------
// Team definitions
// ---------------------------------------------------------------------------

interface TeamDef {
	name: string
	displayName: string
	leader: string
	members: string[]
}

const TEAMS: TeamDef[] = [
	{
		name: "engineering",
		displayName: "Engineering",
		leader: "fullstack-developer",
		members: [
			"backend-developer",
			"frontend-developer",
			"react-specialist",
			"typescript-pro",
			"node-specialist",
			"javascript-pro",
			"websocket-engineer",
			"graphql-architect",
			"api-designer",
			"electron-pro",
			"mobile-developer",
			"nextjs-developer",
			"mobile-app-developer",
			"expo-react-native-expert",
			"flutter-expert",
			"microservices-architect",
		],
	},
	{
		name: "languages",
		displayName: "Language Specialists",
		leader: "python-pro",
		members: [
			"golang-pro",
			"rust-engineer",
			"java-architect",
			"swift-expert",
			"kotlin-specialist",
			"cpp-pro",
			"csharp-developer",
			"django-developer",
			"fastapi-developer",
			"rails-expert",
			"laravel-specialist",
			"symfony-specialist",
			"php-pro",
			"spring-boot-engineer",
			"elixir-expert",
			"dotnet-core-expert",
			"dotnet-framework-4.8-expert",
			"vue-expert",
			"angular-architect",
			"sql-pro",
			"postgres-pro",
			"powershell-5.1-expert",
			"powershell-7-expert",
		],
	},
	{
		name: "infrastructure",
		displayName: "Infrastructure",
		leader: "platform-engineer",
		members: [
			"devops-engineer",
			"kubernetes-specialist",
			"cloud-architect",
			"terraform-engineer",
			"docker-expert",
			"sre-engineer",
			"deployment-engineer",
			"network-engineer",
			"azure-infra-engineer",
			"terragrunt-expert",
			"windows-infra-admin",
			"m365-admin",
			"devops-incident-responder",
			"incident-responder",
		],
	},
	{
		name: "quality",
		displayName: "Quality & Security",
		leader: "architect-reviewer",
		members: [
			"code-reviewer",
			"security-auditor",
			"security-engineer",
			"qa-expert",
			"debugger",
			"penetration-tester",
			"performance-engineer",
			"compliance-auditor",
			"chaos-engineer",
			"error-detective",
			"test-automator",
			"ui-ux-tester",
			"accessibility-tester",
			"ad-security-reviewer",
			"powershell-security-hardening",
		],
	},
	{
		name: "data-ai",
		displayName: "Data & AI",
		leader: "llm-architect",
		members: [
			"ai-engineer",
			"data-scientist",
			"ml-engineer",
			"machine-learning-engineer",
			"data-engineer",
			"prompt-engineer",
			"nlp-engineer",
			"mlops-engineer",
			"reinforcement-learning-engineer",
			"data-analyst",
			"database-administrator",
			"database-optimizer",
		],
	},
	{
		name: "research",
		displayName: "Research",
		leader: "research-analyst",
		members: [
			"competitive-analyst",
			"market-researcher",
			"search-specialist",
			"trend-analyst",
			"data-researcher",
			"scientific-literature-researcher",
			"project-idea-validator",
		],
	},
	{
		name: "business",
		displayName: "Business & Product",
		leader: "product-manager",
		members: [
			"business-analyst",
			"ux-researcher",
			"project-manager",
			"technical-writer",
			"scrum-master",
			"sales-engineer",
			"content-marketer",
			"customer-success-manager",
			"legal-advisor",
			"license-engineer",
			"risk-manager",
			"quant-analyst",
			"fintech-engineer",
			"payment-integration",
			"wordpress-master",
			"seo-specialist",
			"ai-writing-auditor",
		],
	},
	{
		name: "orchestration",
		displayName: "Orchestration",
		leader: "multi-agent-coordinator",
		members: [
			"workflow-orchestrator",
			"task-distributor",
			"agent-organizer",
			"codebase-orchestrator",
			"context-manager",
			"knowledge-synthesizer",
			"error-coordinator",
			"performance-monitor",
			"it-ops-orchestrator",
			"agent-installer",
		],
	},
	{
		name: "specialized",
		displayName: "Specialized",
		leader: "mcp-developer",
		members: [
			"dx-optimizer",
			"tooling-engineer",
			"build-engineer",
			"cli-developer",
			"dependency-manager",
			"legacy-modernizer",
			"git-workflow-manager",
			"readme-generator",
			"refactoring-specialist",
			"documentation-engineer",
			"api-documenter",
			"slack-expert",
			"embedded-systems",
			"iot-engineer",
			"blockchain-developer",
			"game-developer",
			"healthcare-admin",
			"powershell-module-architect",
			"powershell-ui-architect",
			"design-bridge",
			"ui-designer",
		],
	},
]

// ---------------------------------------------------------------------------
// Leadership protocol template
// ---------------------------------------------------------------------------

function hiveOperatingProtocol(): string {
	return `
## Palot Hive Operating Protocol

You are part of Palot's Hive Mind and report to the Lead Agent (Boss).

### Tools
- Use available tools directly when they materially improve certainty: inspect files, search code, run focused checks, and verify outputs.
- Prefer read/search tools before edits.
- If a tool requires approval, explain the exact reason and wait.

### Brain and shared memory
- Before major decisions, use the shared Brain tools when available: \`brain_search\`, \`brain_list\`, and \`brain_read\`.
- Useful Brain files include \`README\`, \`tasks\`, \`issues\`, \`decisions\`, \`models\`, \`skills\`, \`run-history\`, and \`agent-performance\`.
- Prefer \`brain_append\` or \`brain_record_event\` to persist durable findings, blockers, decisions, handoff notes, and lessons without overwriting other agents.
- Use \`brain_write\` only when replacing a whole Brain file is intentional.
- Use \`mem9_recall\` and \`mem9_store\` when semantic memory is configured.

### Skills
- If a project skill applies to your task, load and follow it before implementation or review.
- Project-specific skills override generic habits.

### Reporting
- End with a concise report to the Boss: status, evidence checked, files touched, result, blockers, and recommended next step.
`
}

function leadershipProtocol(team: TeamDef): string {
	const memberList = team.members.map((m) => `- ${m}`).join("\n")
	return `
## 🏢 Team Leadership — ${team.displayName}

You lead the **${team.displayName} Team** and report directly to the **Lead Agent (Boss)**.

### Delegation
When the Boss assigns a task, you:
1. Break it into subtasks matching your team members' specialties
2. Coordinate with relevant members — reference them by name (e.g. "Delegating to @code-reviewer")
3. Synthesize all outputs into one unified, high-quality result before reporting up

### Reporting Format
Always open your reply to the Boss with this block:
\`\`\`
📊 ${team.displayName.toUpperCase()} REPORT
Status: in-progress | complete | blocked
Members used: [comma-separated names]
Summary: [one sentence]
Questions for Boss: none | [specific question]
\`\`\`

### Escalation
If blocked or need a decision from the Boss, prefix immediately with \`⚠️ ESCALATING:\` and wait for direction before continuing.

### Team Skills
Use your team's combined expertise — coordinate multiple members in parallel when tasks are independent.

### Your Team Members
${memberList}
`
}

function injectHiveOperatingProtocol(body: string): string {
	const marker = "## Palot Hive Operating Protocol"
	const protocol = hiveOperatingProtocol().trim()
	const start = body.indexOf(marker)
	if (start === -1) return `${body.trimEnd()}\n${hiveOperatingProtocol()}\n`

	const nextSection = body.indexOf("\n## 🏢 Team Leadership", start + marker.length)
	const end = nextSection === -1 ? body.length : nextSection
	return `${body.slice(0, start).trimEnd()}\n${protocol}\n${body.slice(end)}`
}

// ---------------------------------------------------------------------------
// Frontmatter parsing + rewriting
// ---------------------------------------------------------------------------

function parseFm(content: string): { fm: Record<string, string>; body: string } {
	const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
	if (!match) return { fm: {}, body: content }
	const fm: Record<string, string> = {}
	for (const line of match[1].split("\n")) {
		const colonIdx = line.indexOf(":")
		if (colonIdx === -1) continue
		fm[line.slice(0, colonIdx).trim()] = line
			.slice(colonIdx + 1)
			.trim()
			.replace(/^["']|["']$/g, "")
	}
	return { fm, body: match[2] }
}

function rebuildFile(fm: Record<string, string>, body: string): string {
	const fmLines = Object.entries(fm).map(([k, v]) => {
		// Re-quote values that need it
		if (v.includes("'") && !v.includes('"')) return `${k}: "${v}"`
		if (v.includes('"') || v.includes(",") || v.includes(":") || v.includes("#"))
			return `${k}: '${v}'`
		return `${k}: ${v}`
	})
	return `---\n${fmLines.join("\n")}\n---\n${body}`
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
	// Build slug → team+role lookup
	const agentTeam = new Map<string, { team: string; role: "leader" | "member"; teamDef: TeamDef }>()
	for (const team of TEAMS) {
		agentTeam.set(team.leader, { team: team.name, role: "leader", teamDef: team })
		for (const member of team.members) {
			agentTeam.set(member, { team: team.name, role: "member", teamDef: team })
		}
	}

	const files = (await fs.readdir(AGENTS_DIR)).filter((f) => f.endsWith(".md"))
	let updated = 0
	const unassigned: string[] = []

	for (const file of files) {
		const slug = file.replace(/\.md$/, "")
		const assignment = agentTeam.get(slug)

		if (!assignment) {
			unassigned.push(slug)
			continue
		}

		const fullPath = path.join(AGENTS_DIR, file)
		const raw = await fs.readFile(fullPath, "utf-8")
		const { fm, body } = parseFm(raw)

		// Add team metadata to frontmatter
		fm.team = assignment.team
		fm["team-role"] = assignment.role

		// Inject or replace Palot hive protocol.
		let newBody = injectHiveOperatingProtocol(body)

		// For leaders: inject protocol if not already present
		if (assignment.role === "leader" && !body.includes("🏢 Team Leadership")) {
			newBody = `${newBody.trimEnd()}\n${leadershipProtocol(assignment.teamDef)}\n`
		}

		await fs.writeFile(fullPath, rebuildFile(fm, newBody), "utf-8")
		updated++
	}

	console.log(`\n✓ Updated ${updated} agents`)
	if (unassigned.length) {
		console.log(`\nUnassigned agents (${unassigned.length}):`)
		for (const s of unassigned) console.log(`  - ${s}`)
	}
}

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
