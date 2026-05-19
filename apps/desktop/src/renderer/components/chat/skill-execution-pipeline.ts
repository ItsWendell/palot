/**
 * Skill execution pipeline — resolves slash commands to local skills,
 * validates them for safe execution, and builds the final prompt.
 *
 * Pure functions only: no React, no IPC, fully unit-testable.
 * The skill loader is injected so callers can pass window.palot.skills.listAll()
 * without coupling this module to Electron at test time.
 */

import type { ManagedSkill } from "../../../shared/skills"
import type { Logger } from "../../lib/logger"

// ============================================================
// Types
// ============================================================

export interface SkillValidationResult {
	safe: boolean
	reason?: string
}

export interface SkillResolutionResult {
	skill: ManagedSkill
	prompt: string
}

export type SkillLoader = () => Promise<ManagedSkill[]>

// ============================================================
// Name normalization
// ============================================================

/**
 * Normalize a slash command name for matching against skill filenames.
 * "My Skill Name" → "my-skill-name", "react_patterns" → "react_patterns"
 */
export function normalizeCommandName(raw: string): string {
	return raw.toLowerCase().trim().replace(/\s+/g, "-")
}

// ============================================================
// Skill lookup
// ============================================================

/**
 * Find a skill whose filename or display name matches the slash command.
 * Matching order: exact filename → normalized display name.
 */
export function findSkillByCommandName(
	commandName: string,
	skills: ManagedSkill[],
): ManagedSkill | null {
	const needle = normalizeCommandName(commandName)
	return (
		skills.find((s) => normalizeCommandName(s.filename) === needle) ??
		skills.find((s) => normalizeCommandName(s.name) === needle) ??
		null
	)
}

// ============================================================
// Safety validation
// ============================================================

const EXECUTION_RISK_PATTERNS: Array<[RegExp, string]> = [
	[
		/-----BEGIN (?:RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/,
		"Private key material detected in skill content.",
	],
	[
		/\b(?:sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9_]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/,
		"API token pattern detected in skill content.",
	],
	[
		/\bignore (?:all )?(?:previous|prior) instructions\b/i,
		"Prompt injection pattern detected in skill content.",
	],
	[/\boverride palot\b/i, "System override instruction detected in skill content."],
	[
		/[‪-‮⁦-⁩​‌‍﻿]/,
		"Hidden Unicode control characters detected in skill content.",
	],
]

function scanForRisks(content: string): string[] {
	return EXECUTION_RISK_PATTERNS.filter(([pattern]) => pattern.test(content)).map(
		([, message]) => message,
	)
}

/**
 * Validate that a skill is safe to execute.
 *
 * User-authored skills are trusted. External (GitHub-imported) skills
 * are re-scanned at execution time even though they passed import-time
 * checks, guarding against manual file edits after import.
 */
export function validateSkillForExecution(skill: ManagedSkill): SkillValidationResult {
	if (!skill.content || skill.content.trim().length === 0) {
		return { safe: false, reason: "Skill has no content." }
	}

	if (skill.origin === "external") {
		const issues = scanForRisks(skill.content)
		if (issues.length > 0) {
			return { safe: false, reason: issues[0] }
		}
	}

	return { safe: true }
}

// ============================================================
// Prompt building
// ============================================================

/**
 * Build the final prompt that will be sent to the agent when a skill is invoked.
 *
 * The skill content becomes the primary instruction context; the user's
 * arguments (everything after /skillname) are appended as the concrete request.
 */
export function buildSkillPrompt(skill: ManagedSkill, args: string): string {
	const lines: string[] = [
		`<!-- skill:${skill.filename} origin:${skill.origin} -->`,
		skill.content.trim(),
	]

	if (args.trim()) {
		lines.push("", "---", "", args.trim())
	}

	return lines.join("\n")
}

// ============================================================
// High-level resolver
// ============================================================

/**
 * Resolve a slash command to a skill prompt, logging each lifecycle step.
 *
 * Returns null when the command name does not match any loaded skill,
 * or throws a SkillExecutionError when a skill is found but fails validation.
 */
export async function resolveSkillCommand(
	commandName: string,
	commandArgs: string,
	loadSkills: SkillLoader,
	log: Logger,
): Promise<SkillResolutionResult | null> {
	log.info("[skill-pipeline] resolving slash command", { commandName, commandArgs })

	let skills: ManagedSkill[]
	try {
		skills = await loadSkills()
		log.info("[skill-pipeline] skills loaded", { count: skills.length })
	} catch (err) {
		log.error("[skill-pipeline] failed to load skills", err)
		return null
	}

	const skill = findSkillByCommandName(commandName, skills)
	if (!skill) {
		log.info("[skill-pipeline] no skill matched command", { commandName })
		return null
	}

	log.info("[skill-pipeline] skill matched", {
		commandName,
		skillFilename: skill.filename,
		skillName: skill.name,
		origin: skill.origin,
	})

	const validation = validateSkillForExecution(skill)
	if (!validation.safe) {
		log.warn("[skill-pipeline] skill failed safety validation", {
			skillFilename: skill.filename,
			reason: validation.reason,
		})
		throw new SkillExecutionError(
			`Skill "${skill.name}" blocked: ${validation.reason}`,
			skill,
			"validation-failed",
		)
	}

	log.info("[skill-pipeline] skill validated, building prompt", {
		skillFilename: skill.filename,
	})

	const prompt = buildSkillPrompt(skill, commandArgs)

	log.info("[skill-pipeline] skill prompt ready", {
		skillFilename: skill.filename,
		promptLength: prompt.length,
		hasArgs: commandArgs.trim().length > 0,
	})

	return { skill, prompt }
}

// ============================================================
// Error type
// ============================================================

export type SkillExecutionErrorCode =
	| "validation-failed"
	| "load-failed"
	| "not-found"

export class SkillExecutionError extends Error {
	constructor(
		message: string,
		public readonly skill: ManagedSkill | null,
		public readonly code: SkillExecutionErrorCode,
	) {
		super(message)
		this.name = "SkillExecutionError"
	}
}
