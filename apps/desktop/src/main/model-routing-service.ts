import type { BrainTask } from "../shared/tasks"

export type ModelComplexity = "low" | "medium" | "high"

// Cost tiers (ascending). Keys match opencode model IDs.
export const MODEL_TIERS = {
	low: "claude-haiku-4-5-20251001",
	medium: "claude-sonnet-4-6",
	high: "claude-opus-4-7",
} as const satisfies Record<ModelComplexity, string>

const ROLE_COMPLEXITY: Record<BrainTask["role"], ModelComplexity> = {
	docs: "low",
	fixer: "medium",
	builder: "medium",
	reviewer: "medium",
	architect: "high",
}

const COMPLEXITY_OVERRIDE: Record<BrainTask["estimatedComplexity"], ModelComplexity> = {
	low: "low",
	medium: "medium",
	high: "high",
}

// Keywords that bump complexity up one tier
const HIGH_COMPLEXITY_KEYWORDS =
	/\b(architect|refactor|design|migration|security|performance|concurrent|distributed|algorithm|complex)\b/i
const LOW_COMPLEXITY_KEYWORDS =
	/\b(explain|summarize|list|describe|document|rename|format|comment|typo)\b/i

export function classifyPromptComplexity(text: string): ModelComplexity {
	if (LOW_COMPLEXITY_KEYWORDS.test(text) && text.length < 400) return "low"
	if (HIGH_COMPLEXITY_KEYWORDS.test(text) || text.length > 1500) return "high"
	if (text.length > 60) return "medium"
	return "low"
}

export function routeTask(task: Pick<BrainTask, "role" | "estimatedComplexity" | "recommendedModel">): string {
	// Honour explicit recommendedModel when set
	if (task.recommendedModel && task.recommendedModel.trim()) {
		return task.recommendedModel.trim()
	}
	// Merge role-based and complexity-based signals — take the higher tier
	const roleLevel = ROLE_COMPLEXITY[task.role]
	const complexityLevel = COMPLEXITY_OVERRIDE[task.estimatedComplexity]
	const tier = mergeTiers(roleLevel, complexityLevel)
	return MODEL_TIERS[tier]
}

export function routePrompt(text: string): string {
	const complexity = classifyPromptComplexity(text)
	return MODEL_TIERS[complexity]
}

function tierRank(t: ModelComplexity): number {
	return t === "low" ? 0 : t === "medium" ? 1 : 2
}

function mergeTiers(a: ModelComplexity, b: ModelComplexity): ModelComplexity {
	const rank = Math.max(tierRank(a), tierRank(b))
	return (["low", "medium", "high"] as const)[rank]
}

// ============================================================
// Model resolution — validate against available models
// ============================================================

/**
 * Resolves a preferred model ID against a list of available model IDs.
 *
 * Fallback chain:
 * 1. Exact match
 * 2. Fuzzy match (preferred ID is a substring of an available model)
 * 3. Same-tier fallback (try other models in the same cost tier)
 * 4. Any available model (last resort)
 * 5. Return the preferred model unchanged (no validation possible)
 */
export function resolveAvailableModel(
	preferredModelId: string,
	availableModels: string[],
): string {
	if (availableModels.length === 0) return preferredModelId

	// 1. Exact match
	if (availableModels.includes(preferredModelId)) return preferredModelId

	// 2. Fuzzy match — preferred ID is a substring of an available model
	const fuzzy = availableModels.find((m) => m.includes(preferredModelId))
	if (fuzzy) return fuzzy

	// 2b. Fuzzy match — available model base name matches preferred
	const preferredBase = preferredModelId.replace(/[-_]?\d+.*$/, "")
	if (preferredBase.length >= 4) {
		const baseFuzzy = availableModels.find((m) => m.includes(preferredBase))
		if (baseFuzzy) return baseFuzzy
	}

	// 3. Same-tier fallback — find another model in the same tier
	const preferredTier = identifyTier(preferredModelId)
	if (preferredTier) {
		const tierCandidate = availableModels.find(
			(m) => identifyTier(m) === preferredTier,
		)
		if (tierCandidate) return tierCandidate
	}

	// 4. Any available model
	return availableModels[0]
}

/**
 * Identifies which cost tier a model belongs to by checking known model
 * name patterns. Returns null if unknown.
 */
function identifyTier(modelId: string): ModelComplexity | null {
	const lower = modelId.toLowerCase()
	if (lower.includes("haiku") || lower.includes("flash")) return "low"
	if (lower.includes("sonnet") || lower.includes("pro")) return "medium"
	if (lower.includes("opus")) return "high"
	return null
}

/**
 * Routes a task to a model and validates against available models.
 * Falls back through fuzzy match → tier fallback → any available model.
 */
export function routeTaskResolved(
	task: Pick<BrainTask, "role" | "estimatedComplexity" | "recommendedModel">,
	availableModels: string[],
): string {
	const preferred = routeTask(task)
	return resolveAvailableModel(preferred, availableModels)
}

/**
 * Routes a prompt to a model and validates against available models.
 * Falls back through fuzzy match → tier fallback → any available model.
 */
export function routePromptResolved(
	text: string,
	availableModels: string[],
): string {
	const preferred = routePrompt(text)
	return resolveAvailableModel(preferred, availableModels)
}
