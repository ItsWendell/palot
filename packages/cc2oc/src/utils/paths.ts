/**
 * Path resolution utilities for Claude Code and OpenCode config locations.
 * Handles platform differences and XDG base directories.
 */
import { homedir } from "node:os"
import { join } from "node:path"

const home = homedir()

// ─── Claude Code Paths ───────────────────────────────────────────────

/** ~/.Claude/settings.json */
export function ccSettingsPath(): string {
	return join(home, ".Claude", "settings.json")
}

/** ~/.claude.json */
export function ccUserStatePath(): string {
	return join(home, ".claude.json")
}

/** ~/.Claude/skills/ */
export function ccGlobalSkillsDir(): string {
	return join(home, ".Claude", "skills")
}

/** ~/.agents/skills/ (shared between CC and OC) */
export function sharedAgentsSkillsDir(): string {
	return join(home, ".agents", "skills")
}

/** ~/.claude/CLAUDE.md (global rules -- note lowercase .claude) */
export function ccGlobalClaudeMdPath(): string {
	return join(home, ".claude", "CLAUDE.md")
}

/** ~/.Claude/history.jsonl */
export function ccHistoryPath(): string {
	return join(home, ".Claude", "history.jsonl")
}

/** ~/.Claude/projects/ */
export function ccProjectsDir(): string {
	return join(home, ".Claude", "projects")
}

/**
 * Mangle a project path to the Claude Code directory name format.
 * /Users/foo/project -> -Users-foo-project
 */
export function ccManglePath(projectPath: string): string {
	return projectPath.replace(/\//g, "-")
}

/** Get the session storage directory for a project */
export function ccProjectSessionDir(projectPath: string): string {
	return join(ccProjectsDir(), ccManglePath(projectPath))
}

/** Project-level .claude/settings.local.json */
export function ccProjectSettingsPath(projectPath: string): string {
	return join(projectPath, ".claude", "settings.local.json")
}

/** Project-level .mcp.json */
export function ccProjectMcpJsonPath(projectPath: string): string {
	return join(projectPath, ".mcp.json")
}

/** Project-level .claude/agents/ */
export function ccProjectAgentsDir(projectPath: string): string {
	return join(projectPath, ".claude", "agents")
}

/** Project-level .claude/commands/ */
export function ccProjectCommandsDir(projectPath: string): string {
	return join(projectPath, ".claude", "commands")
}

/** Project-level .claude/skills/ */
export function ccProjectSkillsDir(projectPath: string): string {
	return join(projectPath, ".claude", "skills")
}

/** CLAUDE.md at project root */
export function ccProjectClaudeMdPath(projectPath: string): string {
	return join(projectPath, "CLAUDE.md")
}

/** AGENTS.md at project root */
export function projectAgentsMdPath(projectPath: string): string {
	return join(projectPath, "AGENTS.md")
}

// ─── OpenCode Paths ──────────────────────────────────────────────────

/** ~/.config/opencode/opencode.json */
export function ocGlobalConfigPath(): string {
	const xdgConfig = process.env.XDG_CONFIG_HOME || join(home, ".config")
	return join(xdgConfig, "opencode", "opencode.json")
}

/** ~/.config/opencode/ */
export function ocGlobalConfigDir(): string {
	const xdgConfig = process.env.XDG_CONFIG_HOME || join(home, ".config")
	return join(xdgConfig, "opencode")
}

/** ~/.config/opencode/backups/ */
export function ocBackupsDir(): string {
	return join(ocGlobalConfigDir(), "backups")
}

/** ~/.config/opencode/AGENTS.md */
export function ocGlobalAgentsMdPath(): string {
	return join(ocGlobalConfigDir(), "AGENTS.md")
}

/** ~/.config/opencode/skills/ */
export function ocGlobalSkillsDir(): string {
	return join(ocGlobalConfigDir(), "skills")
}

/** ~/.config/opencode/commands/ */
export function ocGlobalCommandsDir(): string {
	return join(ocGlobalConfigDir(), "commands")
}

/** ~/.config/opencode/agents/ */
export function ocGlobalAgentsDir(): string {
	return join(ocGlobalConfigDir(), "agents")
}

/** ~/.config/opencode/plugins/ */
export function ocGlobalPluginsDir(): string {
	return join(ocGlobalConfigDir(), "plugins")
}

/** ~/.local/share/opencode/ */
export function ocDataDir(): string {
	const xdgData = process.env.XDG_DATA_HOME || join(home, ".local", "share")
	return join(xdgData, "opencode")
}

/** ~/.local/share/opencode/storage/ */
export function ocStorageDir(): string {
	return join(ocDataDir(), "storage")
}

/** ~/.local/state/opencode/ */
export function ocStateDir(): string {
	const xdgState = process.env.XDG_STATE_HOME || join(home, ".local", "state")
	return join(xdgState, "opencode")
}

/** ~/.local/state/opencode/prompt-history.jsonl */
export function ocPromptHistoryPath(): string {
	return join(ocStateDir(), "prompt-history.jsonl")
}

/** Project-level opencode.json */
export function ocProjectConfigPath(projectPath: string): string {
	return join(projectPath, "opencode.json")
}

/** Project-level .opencode/agents/ */
export function ocProjectAgentsDir(projectPath: string): string {
	return join(projectPath, ".opencode", "agents")
}

/** Project-level .opencode/commands/ */
export function ocProjectCommandsDir(projectPath: string): string {
	return join(projectPath, ".opencode", "commands")
}

/** Project-level .opencode/skills/ */
export function ocProjectSkillsDir(projectPath: string): string {
	return join(projectPath, ".opencode", "skills")
}

/** Project-level .opencode/plugins/ */
export function ocProjectPluginsDir(projectPath: string): string {
	return join(projectPath, ".opencode", "plugins")
}

/** Project-level AGENTS.md */
export function ocProjectAgentsMdPath(projectPath: string): string {
	return join(projectPath, "AGENTS.md")
}
