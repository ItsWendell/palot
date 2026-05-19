/**
 * Builds the task prompt sent to spawned Hive agents.
 *
 * The named OpenCode agent file supplies role/model identity. This prompt supplies
 * Nexus Builder-specific operating rules: Brain memory, hive reporting, tools, skills,
 * and selected knowledge references.
 */

import type { ManagedSkill } from "../../shared/skills"

export interface HiveSpawnPromptInput {
	agentName: string
	agentDescription: string
	/** Full system prompt from the agent's .md definition. Prepended before Hive protocol. */
	agentSystemPrompt?: string
	customInstruction: string
	brainContext?: string | null
	memories?: string | null
	knowledgeSections?: Array<{ title: string; prompt: string }>
	skills?: ManagedSkill[]
	warnings?: string[]
}

// Prompt section size budget (chars). Keeps spawn prompts inside a sensible
// token envelope even when attached knowledge sources are large documents.
const MAX_MEMORIES_CHARS = 3_000
const MAX_KNOWLEDGE_SECTION_CHARS = 12_000
const MAX_KNOWLEDGE_TOTAL_CHARS = 24_000

function normalize(text: string): string {
	return text.trim()
}

function clamp(text: string, max: number, label: string): { text: string; truncated: boolean } {
	if (text.length <= max) return { text, truncated: false }
	return { text: `${text.slice(0, max)}\n… [${label} truncated to ${max} chars]`, truncated: true }
}

function findRelevantSkills(agentName: string, task: string, skills: ManagedSkill[]): ManagedSkill[] {
	if (skills.length === 0) return []
	const haystack = `${agentName} ${task}`.toLowerCase()
	const scored = skills.map((skill) => {
		const terms = [
			skill.name,
			skill.filename,
			skill.description,
			...skill.tags,
		].filter(Boolean)
		const score = terms.reduce((sum, term) => {
			const words = term.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2)
			return sum + words.filter((word) => haystack.includes(word)).length
		}, 0)
		return { skill, score }
	})

	return scored
		.filter((item) => item.score > 0)
		.sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name))
		.slice(0, 6)
		.map((item) => item.skill)
}

function formatSkills(agentName: string, task: string, skills: ManagedSkill[] | undefined): string[] {
	const relevant = findRelevantSkills(agentName, task, skills ?? [])
	if (relevant.length === 0) {
		return [
			"## Skills",
			"",
			"- If a project skill applies, load and follow it before making changes.",
			"- Prefer project-specific skill instructions over generic assumptions.",
		]
	}

	return [
		"## Relevant Skills",
		"",
		...relevant.map((skill) => `- ${skill.name}: ${skill.description || "No description"}`),
		"",
		"Use these skills when applicable before implementation or review.",
	]
}

export function buildHiveSpawnPrompt(input: HiveSpawnPromptInput): string {
	const task = normalize(input.customInstruction) || `Begin your work as ${input.agentName}.`

	// Agent identity: system prompt from the agent's .md definition first,
	// then Hive protocol. This preserves specialist expertise while adding
	// shared brain/memory/reporting rules on top.
	const agentIdentity = input.agentSystemPrompt
		? [input.agentSystemPrompt.trim(), "", "---", ""]
		: [
				`You are **${input.agentName}**, spawned by the Lead Agent (Boss) inside Nexus Builder's Hive Mind.`,
				input.agentDescription ? `Role: ${input.agentDescription}` : "",
				"",
			]

	const parts: string[] = [
		...agentIdentity,
		"## Nexus Builder Hive Operating Protocol",
		"",
		"### Required workflow",
		"",
		"1. Start by checking shared context. Use `brain_search`, `brain_list`, and `brain_read` when available before making decisions.",
		"2. Use tools directly when they materially reduce uncertainty: inspect files, run focused tests, search code, and verify outputs.",
		"3. Use `brain_append` or `brain_record_event` for durable findings, blockers, decisions, or handoff notes. Use `brain_write` only when replacing a whole file is intentional.",
		"4. Coordinate through the Boss. Ask clear questions when blocked; do not silently guess around missing business or safety decisions.",
		"5. End with a concise report in your chat output: status, files touched or evidence checked, result, blockers, and recommended next step.",
		"6. **MANDATORY on completion**: Write a HANDOFF note to the brain so the Lead Agent can synthesize your output:",
		"   ```",
		"   brain_append run-history",
		"   ## HANDOFF_READY:[your-agent-name]:[ISO-timestamp]",
		"   - Status: complete | blocked | failed",
		"   - Summary: [1–2 sentence result]",
		"   - Files: [comma-separated list of files touched, or 'none']",
		"   - Blockers: [any unresolved issues, or 'none']",
		"   ```",
		"",
		"### Shared memory tools",
		"",
		"- `brain_list`: discover shared project memory files.",
		"- `brain_read`: read project memory such as tasks, decisions, issues, models, run-history, skills, and agent-performance.",
		"- `brain_search`: find relevant prior decisions or failures before acting.",
		"- `brain_append`: safely add notes without overwriting other agents.",
		"- `brain_record_event`: safely add timestamped run-history, decision, blocker, and handoff events.",
		"- `brain_write`: replace a whole brain file only when that is intentional.",
		"- `mem9_recall` / `mem9_store`: use semantic memory when configured.",
		"",
		"### Tool discipline",
		"",
		"- Prefer read/search tools before edits.",
		"- Run the smallest meaningful verification for your change.",
		"- If a tool needs approval, ask once with the exact reason and wait.",
	]

	if (input.brainContext) {
		parts.push("", "## Current Brain Context", "", input.brainContext.slice(0, 5000))
	}

	if (input.memories) {
		const { text: mem, truncated: memTruncated } = clamp(input.memories, MAX_MEMORIES_CHARS, "memories")
		parts.push("", mem)
		if (memTruncated) {
			parts.push("", "> Memory recall truncated to fit prompt budget.")
		}
	}

	if (input.warnings && input.warnings.length > 0) {
		parts.push(
			"",
			"## Context Warnings",
			"",
			...input.warnings.map((warning) => `- ${warning}`),
			"",
			"Continue if safe, but report these warnings back to the Boss.",
		)
	}

	parts.push("", ...formatSkills(input.agentName, task, input.skills))

	if (input.knowledgeSections && input.knowledgeSections.length > 0) {
		parts.push("", "## Reference Knowledge", "")
		let knowledgeBudget = MAX_KNOWLEDGE_TOTAL_CHARS
		for (const section of input.knowledgeSections) {
			if (knowledgeBudget <= 0) {
				parts.push(`### ${section.title}`, "", "> [omitted — total knowledge budget exhausted]", "")
				continue
			}
			const sectionBudget = Math.min(MAX_KNOWLEDGE_SECTION_CHARS, knowledgeBudget)
			const { text: body, truncated } = clamp(section.prompt, sectionBudget, section.title)
			parts.push(`### ${section.title}`, "", body, "")
			knowledgeBudget -= body.length
			if (truncated) {
				parts.push("> Knowledge section truncated to fit prompt budget.", "")
			}
		}
	}

	parts.push("", "## Task", "", task)

	return parts.filter((part) => part !== "").join("\n")
}
