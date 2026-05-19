/**
 * Unified backend service layer.
 *
 * Detects whether we're running inside Electron (preload bridge available)
 * or in a plain browser (Bun + Hono server on port 3100). All hooks import
 * from here instead of `palot-server.ts` directly.
 *
 * In Electron mode, calls go through IPC to the main process.
 * In browser mode, calls go through HTTP to the Nexus Builder server.
 */

import type {
	Automation,
	AutomationRun,
	CreateAutomationInput,
	GitApplyResult,
	GitBranchInfo,
	GitCheckoutResult,
	GitCommitResult,
	GitDiffStat,
	GitPushResult,
	GitStashResult,
	GitStatusInfo,
	ModelState,
	OpenInTargetsResult,
	UpdateAutomationInput,
} from "../../preload/api"
import { createLogger } from "../lib/logger"

const log = createLogger("backend")

// ============================================================
// Runtime detection
// ============================================================

/**
 * Returns true when running inside Electron (preload bridge is available).
 * The `palot` object is exposed via `contextBridge.exposeInMainWorld`.
 */
export const isElectron = typeof window !== "undefined" && "palot" in window

// ============================================================
// Backend API — same signatures regardless of runtime
// ============================================================

/**
 * Ensures the single OpenCode server is running and returns its URL.
 * For local servers, this spawns/attaches via IPC.
 * For remote servers, the URL is already known and returned directly.
 */
export async function fetchOpenCodeUrl(): Promise<{ url: string }> {
	log.debug("fetchOpenCodeUrl", { via: isElectron ? "ipc" : "http" })
	try {
		if (isElectron) {
			const info = await window.palot.ensureOpenCode()
			log.info("OpenCode server URL resolved", { url: info.url })
			return { url: info.url }
		}
		const { fetchOpenCodeUrl: httpFetch } = await import("./palot-server")
		const result = await httpFetch()
		log.info("OpenCode server URL resolved", { url: result.url })
		return result
	} catch (err) {
		log.error("fetchOpenCodeUrl failed", err)
		throw err
	}
}

/**
 * Resolve the connection URL for a server config.
 * For local servers, spawns/attaches via the existing IPC mechanism.
 * For remote servers, returns the configured URL directly.
 */
export async function resolveServerUrl(
	server: import("../../preload/api").ServerConfig,
): Promise<string> {
	switch (server.type) {
		case "local": {
			const { url } = await fetchOpenCodeUrl()
			return url
		}
		case "remote":
			return server.url
		case "ssh":
			// SSH tunneling not yet implemented; the URL would come from the tunnel manager
			throw new Error("SSH tunnel servers are not yet supported")
		default:
			throw new Error(`Unknown server type: ${(server as { type: string }).type}`)
	}
}

/**
 * Resolve the auth header for a server config.
 * Fetches the encrypted password from the main process via IPC.
 * Returns null for unauthenticated servers.
 */
export async function resolveAuthHeader(
	server: import("../../preload/api").ServerConfig,
): Promise<string | null> {
	if (server.type === "local") return null
	if (server.type === "remote" || server.type === "ssh") {
		if (!server.hasPassword) return null
		if (!isElectron) return null

		const password = await window.palot.credential.get(server.id)
		if (!password) return null

		const username = server.username || "opencode"
		return `Basic ${btoa(`${username}:${password}`)}`
	}
	return null
}

/**
 * Fetches the OpenCode model state (recent models, favorites, variants)
 * from ~/.local/state/opencode/model.json.
 */
export async function fetchModelState(): Promise<ModelState> {
	if (isElectron) {
		return window.palot.getModelState()
	}
	const { fetchModelState: httpFetch } = await import("./palot-server")
	return httpFetch() as unknown as Promise<ModelState>
}

/**
 * Adds a model to the front of the recent list in model.json.
 * Matches the TUI's `model.set(model, { recent: true })` behavior.
 * Returns the updated model state.
 */
export async function updateModelRecent(model: {
	providerID: string
	modelID: string
}): Promise<ModelState> {
	if (isElectron) {
		return window.palot.updateModelRecent(model)
	}
	const { updateModelRecent: httpUpdate } = await import("./palot-server")
	return httpUpdate(model) as unknown as Promise<ModelState>
}

/**
 * Checks if the backend is available.
 * In Electron, always returns true (main process is always there).
 * In browser, pings the Nexus Builder HTTP server.
 */
export async function checkBackendHealth(): Promise<boolean> {
	if (isElectron) {
		return true
	}
	const { checkServerHealth } = await import("./palot-server")
	return checkServerHealth()
}

// ============================================================
// Directory picker — Electron-only (native dialog via IPC)
// ============================================================

/**
 * Opens a native folder picker dialog.
 * Returns the selected directory path, or null if cancelled.
 */
export async function pickDirectory(): Promise<string | null> {
	if (isElectron) {
		return window.palot.pickDirectory()
	}
	throw new Error("Directory picker is only available in Electron mode")
}

/**
 * Opens a native folder picker to choose a parent location, then creates
 * a new subfolder with the given name. Returns the created path, or null if cancelled.
 */
export async function createProjectDirectory(name: string): Promise<string | null> {
	if (isElectron) {
		return window.palot.createProjectDirectory(name)
	}
	throw new Error("Directory creation is only available in Electron mode")
}

/**
 * Reveals the given path in the system file manager (Finder, Explorer, etc.).
 */
export async function showInFinder(filePath: string): Promise<void> {
	if (isElectron) {
		return window.palot.showInFinder(filePath)
	}
}

// ============================================================
// Git operations — Electron-only (main process via IPC)
// In browser mode, these are not available (OpenCode server
// doesn't expose git checkout/stash APIs).
// ============================================================

/**
 * Lists all local and remote branches for a project directory.
 */
export async function fetchGitBranches(directory: string): Promise<GitBranchInfo> {
	if (isElectron) {
		return window.palot.git.listBranches(directory)
	}
	throw new Error("Git operations are only available in Electron mode")
}

/**
 * Gets the working tree status (clean/dirty, file counts).
 */
export async function fetchGitStatus(directory: string): Promise<GitStatusInfo> {
	if (isElectron) {
		return window.palot.git.getStatus(directory)
	}
	throw new Error("Git operations are only available in Electron mode")
}

/**
 * Checks out a branch. Fails if there are uncommitted changes
 * that would conflict.
 */
export async function gitCheckout(directory: string, branch: string): Promise<GitCheckoutResult> {
	if (isElectron) {
		return window.palot.git.checkout(directory, branch)
	}
	throw new Error("Git operations are only available in Electron mode")
}

/**
 * Stashes uncommitted changes, then checks out the target branch.
 */
export async function gitStashAndCheckout(
	directory: string,
	branch: string,
): Promise<GitStashResult> {
	if (isElectron) {
		return window.palot.git.stashAndCheckout(directory, branch)
	}
	throw new Error("Git operations are only available in Electron mode")
}

/**
 * Pops the most recent stash entry.
 */
export async function gitStashPop(directory: string): Promise<GitStashResult> {
	if (isElectron) {
		return window.palot.git.stashPop(directory)
	}
	throw new Error("Git operations are only available in Electron mode")
}

// ============================================================
// Worktree operations — OpenCode API only
// ============================================================

export type { WorktreeResult } from "./worktree-service"
export {
	createWorktree as createWorktreeViaApi,
	listWorktrees as listWorktreesViaApi,
	removeWorktree as removeWorktreeViaApi,
	resetWorktree,
} from "./worktree-service"

/**
 * Gets the git repository root for a directory.
 */
export async function getGitRoot(directory: string): Promise<string | null> {
	if (isElectron) {
		return window.palot.git.getRoot(directory)
	}
	throw new Error("Git operations are only available in Electron mode")
}

/**
 * Gets a summary of uncommitted changes in a directory.
 */
export async function fetchDiffStat(directory: string): Promise<GitDiffStat> {
	if (isElectron) {
		return window.palot.git.diffStat(directory)
	}
	throw new Error("Git operations are only available in Electron mode")
}

/**
 * Commits all changes (staged + unstaged) with the given message.
 */
export async function gitCommitAll(directory: string, message: string): Promise<GitCommitResult> {
	if (isElectron) {
		return window.palot.git.commitAll(directory, message)
	}
	throw new Error("Git operations are only available in Electron mode")
}

/**
 * Pushes the current branch to the remote.
 */
export async function gitPush(directory: string, remote?: string): Promise<GitPushResult> {
	if (isElectron) {
		return window.palot.git.push(directory, remote)
	}
	throw new Error("Git operations are only available in Electron mode")
}

/**
 * Creates a new branch on the given directory.
 */
export async function gitCreateBranch(
	directory: string,
	branchName: string,
): Promise<GitCheckoutResult> {
	if (isElectron) {
		return window.palot.git.createBranch(directory, branchName)
	}
	throw new Error("Git operations are only available in Electron mode")
}

/**
 * Gets the remote URL for a repository (defaults to "origin").
 */
export async function getGitRemoteUrl(directory: string, remote?: string): Promise<string | null> {
	if (isElectron) {
		return window.palot.git.getRemoteUrl(directory, remote)
	}
	throw new Error("Git operations are only available in Electron mode")
}

/**
 * Applies uncommitted changes from a worktree to the local checkout as a patch.
 */
export async function gitApplyToLocal(
	worktreeDir: string,
	localDir: string,
): Promise<GitApplyResult> {
	if (isElectron) {
		return window.palot.git.applyToLocal(worktreeDir, localDir)
	}
	throw new Error("Git operations are only available in Electron mode")
}

/**
 * Applies a raw diff string to a local directory using `git apply`.
 * Used for remote worktree apply-to-local, where the diff is fetched
 * from the OpenCode session.diff API rather than from a local worktree.
 */
export async function gitApplyDiffText(
	localDir: string,
	diffText: string,
): Promise<GitApplyResult> {
	if (isElectron) {
		return window.palot.git.applyDiffText(localDir, diffText)
	}
	throw new Error("Git operations are only available in Electron mode")
}

// ============================================================
// Open in external app — Electron-only (main process via IPC)
// ============================================================

/**
 * Gets the list of available "Open in" targets (editors, terminals, file managers)
 * with their availability status and the user's preferred target.
 */
export async function fetchOpenInTargets(): Promise<OpenInTargetsResult> {
	if (isElectron) {
		return window.palot.openIn.getTargets()
	}
	throw new Error("Open-in targets are only available in Electron mode")
}

/**
 * Opens a directory in the specified target application.
 * Optionally persists the target as the user's preferred choice.
 */
export async function openInTarget(
	directory: string,
	targetId: string,
	persistPreferred?: boolean,
): Promise<void> {
	if (isElectron) {
		return window.palot.openIn.open(directory, targetId, persistPreferred)
	}
	throw new Error("Open-in targets are only available in Electron mode")
}

/**
 * Sets the user's preferred "Open in" target without opening anything.
 */
export async function setOpenInPreferred(targetId: string): Promise<{ success: boolean }> {
	if (isElectron) {
		return window.palot.openIn.setPreferred(targetId)
	}
	throw new Error("Open-in targets are only available in Electron mode")
}

// ============================================================
// Automations — Electron-only
// ============================================================

export async function fetchAutomations(): Promise<Automation[]> {
	if (isElectron) {
		return window.palot.automation.list()
	}
	throw new Error("Automations are only available in Electron mode")
}

export async function fetchAutomation(id: string): Promise<Automation | null> {
	if (isElectron) {
		return window.palot.automation.get(id)
	}
	throw new Error("Automations are only available in Electron mode")
}

export async function createAutomation(input: CreateAutomationInput): Promise<Automation> {
	if (isElectron) {
		return window.palot.automation.create(input)
	}
	throw new Error("Automations are only available in Electron mode")
}

export async function updateAutomation(input: UpdateAutomationInput): Promise<Automation | null> {
	if (isElectron) {
		return window.palot.automation.update(input)
	}
	throw new Error("Automations are only available in Electron mode")
}

export async function deleteAutomation(id: string): Promise<boolean> {
	if (isElectron) {
		return window.palot.automation.delete(id)
	}
	throw new Error("Automations are only available in Electron mode")
}

export async function runAutomationNow(id: string): Promise<boolean> {
	if (isElectron) {
		return window.palot.automation.runNow(id)
	}
	throw new Error("Automations are only available in Electron mode")
}

export async function fetchAutomationRuns(automationId?: string): Promise<AutomationRun[]> {
	if (isElectron) {
		return window.palot.automation.listRuns(automationId)
	}
	throw new Error("Automations are only available in Electron mode")
}

// ============================================================
// Agents — Electron-only (reads/writes .opencode/agents/ per project)
// ============================================================

export async function listAgents(projectPath?: string): Promise<import("../../shared/agents").ManagedAgent[]> {
	if (isElectron) {
		return window.palot.agents.list(projectPath)
	}
	if (!projectPath) {
		return []
	}
	const { fetchAgents } = await import("./palot-server")
	return fetchAgents(projectPath)
}

export async function getAgent(filename: string, projectPath?: string): Promise<import("../../shared/agents").ManagedAgent | null> {
	if (isElectron) {
		return window.palot.agents.get(filename, projectPath)
	}
	throw new Error("Agents are only available in Electron mode")
}

export async function writeAgent(filename: string, raw: string, projectPath?: string): Promise<string> {
	if (isElectron) {
		return window.palot.agents.write(filename, raw, projectPath)
	}
	throw new Error("Agents are only available in Electron mode")
}

export async function deleteAgent(filename: string, projectPath?: string): Promise<boolean> {
	if (isElectron) {
		return window.palot.agents.delete(filename, projectPath)
	}
	throw new Error("Agents are only available in Electron mode")
}

// ============================================================
// Knowledge Sources — Electron-only (reads .agents/knowledge/)
// ============================================================

export async function listKnowledgeSources(projectPath?: string): Promise<import("../../shared/knowledge").KnowledgeSource[]> {
	if (isElectron) {
		return window.palot.sourceKnowledge.list(projectPath)
	}
	return []
}

export async function getKnowledgeSource(filename: string, projectPath?: string): Promise<import("../../shared/knowledge").KnowledgeSource | null> {
	if (isElectron) {
		return window.palot.sourceKnowledge.get(filename, projectPath)
	}
	return null
}

// ============================================================
// Mem9 (persistent memory) — Electron-only
// ============================================================

export async function mem9Init(config?: { apiKey?: string; baseUrl?: string; agentId?: string }): Promise<boolean> {
	if (isElectron) return window.palot.mem9.init(config)
	return false
}

export async function mem9Status(): Promise<{ initialized: boolean; configured: boolean }> {
	if (isElectron) return window.palot.mem9.status()
	return { initialized: false, configured: false }
}

export async function mem9Store(input: {
	content: string
	source?: string
	tags?: string[]
	metadata?: Record<string, unknown>
}): Promise<import("../../main/mem9-service").Mem9Memory | null> {
	if (isElectron) return window.palot.mem9.store(input)
	return null
}

export async function mem9Search(params: {
	q?: string
	tags?: string
	source?: string
	limit?: number
	offset?: number
}): Promise<import("../../main/mem9-service").Mem9SearchResult> {
	if (isElectron) return window.palot.mem9.search(params)
	return { memories: [], total: 0, limit: params.limit ?? 10, offset: params.offset ?? 0 }
}

export async function mem9Get(id: string): Promise<import("../../main/mem9-service").Mem9Memory | null> {
	if (isElectron) return window.palot.mem9.get(id)
	return null
}

export async function mem9Delete(id: string): Promise<boolean> {
	if (isElectron) return window.palot.mem9.delete(id)
	return false
}

export async function mem9Recall(query: string, limit?: number): Promise<string | null> {
	if (isElectron) return window.palot.mem9.recall(query, limit)
	return null
}

export async function mem9EmbedKnowledge(projectPath: string): Promise<number> {
	if (isElectron) return window.palot.mem9.embedKnowledge(projectPath)
	return 0
}

export async function mem9EmbedBrain(projectPath: string): Promise<number> {
	if (isElectron) return window.palot.mem9.embedBrain(projectPath)
	return 0
}

export async function mem9EmbedAll(projectPath: string): Promise<number> {
	if (isElectron) return window.palot.mem9.embedAll(projectPath)
	return 0
}

// ============================================================
// Skills — Electron-only (reads/writes ~/.config/opencode/skills/)
// ============================================================

// ============================================================
// Brain — Electron-only (reads/writes .palot/brain/ per project)
// ============================================================

export async function listBrainFiles(projectPath?: string): Promise<string[]> {
	if (isElectron) return window.palot.brain.list(projectPath)
	throw new Error("Brain is only available in Electron mode")
}

export async function readBrainFile(slug: string, projectPath?: string): Promise<string | null> {
	if (isElectron) return window.palot.brain.read(slug, projectPath)
	throw new Error("Brain is only available in Electron mode")
}

export async function writeBrainFile(slug: string, content: string, projectPath?: string): Promise<void> {
	if (isElectron) return window.palot.brain.write(slug, content, projectPath)
	throw new Error("Brain is only available in Electron mode")
}

export async function appendBrainFile(slug: string, content: string, projectPath?: string): Promise<void> {
	if (isElectron) return window.palot.brain.append(slug, content, projectPath)
	throw new Error("Brain is only available in Electron mode")
}

export async function recordBrainEvent(
	slug: string,
	title: string,
	body: string,
	projectPath?: string,
): Promise<void> {
	if (isElectron) return window.palot.brain.recordEvent(slug, title, body, projectPath)
	throw new Error("Brain is only available in Electron mode")
}

export async function deleteBrainFile(slug: string, projectPath?: string): Promise<boolean> {
	if (isElectron) return window.palot.brain.delete(slug, projectPath)
	throw new Error("Brain is only available in Electron mode")
}

export async function searchBrainFiles(
	keyword: string,
	projectPath?: string,
): Promise<import("../../main/project-brain-service").BrainSearchResult[]> {
	if (isElectron) return window.palot.brain.search(keyword, projectPath)
	throw new Error("Brain is only available in Electron mode")
}

export async function getBrainContextSummary(projectPath: string, sessionId?: string): Promise<string> {
	if (isElectron) return window.palot.brain.contextSummary(projectPath, sessionId)
	throw new Error("Brain is only available in Electron mode")
}

// ============================================================
// Agent performance — Electron-only
// ============================================================

export async function listAgentPerformance(
	projectPath?: string,
): Promise<import("../../shared/agent-performance").AgentPerformanceLedger> {
	if (isElectron) return window.palot.agentPerformance.list(projectPath)
	throw new Error("Agent performance tracking is only available in Electron mode")
}

export async function recordAgentPerformance(
	projectPath: string,
	input: import("../../shared/agent-performance").AgentPerformanceInput,
): Promise<import("../../shared/agent-performance").AgentPerformanceLedger> {
	if (isElectron) return window.palot.agentPerformance.record(projectPath, input)
	throw new Error("Agent performance tracking is only available in Electron mode")
}

// ============================================================
// Model routing — Electron-only
// ============================================================

export async function routeModel(taskOrText: import("../../shared/tasks").BrainTask | string): Promise<string> {
	if (isElectron) return window.palot.tasks.routeModel(taskOrText)
	throw new Error("Model routing is only available in Electron mode")
}

export async function listSkills(): Promise<import("../../shared/skills").ManagedSkill[]> {
	if (isElectron) {
		return window.palot.skills.list()
	}
	throw new Error("Skills are only available in Electron mode")
}

export async function listAllSkills(): Promise<import("../../shared/skills").ManagedSkill[]> {
	if (isElectron) {
		return window.palot.skills.listAll()
	}
	throw new Error("Skills are only available in Electron mode")
}

export async function importSkillFromGitHub(
	url: string,
): Promise<import("../../shared/skills").SkillImportResult> {
	if (isElectron) {
		return window.palot.skills.importGitHub(url)
	}
	throw new Error("Skills are only available in Electron mode")
}

export async function writeSkill(filename: string, raw: string): Promise<string> {
	if (isElectron) {
		return window.palot.skills.write(filename, raw)
	}
	throw new Error("Skills are only available in Electron mode")
}

export async function deleteSkill(filename: string): Promise<boolean> {
	if (isElectron) {
		return window.palot.skills.delete(filename)
	}
	throw new Error("Skills are only available in Electron mode")
}

export async function archiveAutomationRun(runId: string): Promise<boolean> {
	if (isElectron) {
		return window.palot.automation.archiveRun(runId)
	}
	throw new Error("Automations are only available in Electron mode")
}

export async function acceptAutomationRun(runId: string): Promise<boolean> {
	if (isElectron) {
		return window.palot.automation.acceptRun(runId)
	}
	throw new Error("Automations are only available in Electron mode")
}

export async function markAutomationRunRead(runId: string): Promise<boolean> {
	if (isElectron) {
		return window.palot.automation.markRunRead(runId)
	}
	throw new Error("Automations are only available in Electron mode")
}

export async function previewAutomationSchedule(
	rrule: string,
	timezone: string,
): Promise<string[]> {
	if (isElectron) {
		return window.palot.automation.previewSchedule(rrule, timezone)
	}
	throw new Error("Automations are only available in Electron mode")
}

// ============================================================
// Knowledge graph — Electron-only
// ============================================================

export async function addKnowledge(
	projectPath: string,
	entry: Omit<import("../../main/knowledge-graph-service").KnowledgeEntry, "id" | "createdAt" | "updatedAt">,
): Promise<import("../../main/knowledge-graph-service").KnowledgeEntry> {
	if (isElectron) return window.palot.knowledge.add(projectPath, entry)
	throw new Error("Knowledge graph is only available in Electron mode")
}

export async function queryKnowledge(
	projectPath: string,
	options: import("../../main/knowledge-graph-service").KnowledgeQueryOptions,
): Promise<import("../../main/knowledge-graph-service").KnowledgeEntry[]> {
	if (isElectron) return window.palot.knowledge.query(projectPath, options)
	throw new Error("Knowledge graph is only available in Electron mode")
}

export async function removeKnowledge(projectPath: string, id: string): Promise<boolean> {
	if (isElectron) return window.palot.knowledge.remove(projectPath, id)
	throw new Error("Knowledge graph is only available in Electron mode")
}

export async function getKnowledgeContext(projectPath: string, forPrompt?: string): Promise<string> {
	if (isElectron) return window.palot.knowledge.context(projectPath, forPrompt)
	throw new Error("Knowledge graph is only available in Electron mode")
}

// ============================================================
// Semantic index — Electron-only
// ============================================================

export async function buildSemanticIndex(
	projectPath: string,
): Promise<import("../../main/semantic-index-service").SemanticIndex> {
	if (isElectron) return window.palot.semantic.build(projectPath)
	throw new Error("Semantic index is only available in Electron mode")
}

export async function searchSemantic(
	projectPath: string,
	query: string,
	limit?: number,
): Promise<import("../../main/semantic-index-service").SemanticSearchResult[]> {
	if (isElectron) return window.palot.semantic.search(projectPath, query, limit)
	throw new Error("Semantic index is only available in Electron mode")
}
