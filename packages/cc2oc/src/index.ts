/**
 * @palot/cc2oc -- Claude Code to OpenCode migration library.
 *
 * Public API:
 *   scan()     -> ScanResult           (reads filesystem)
 *   convert()  -> ConversionResult     (pure transformation)
 *   validate() -> ValidationResult     (schema checks)
 *   write()    -> WriteResult          (writes to filesystem)
 *   diff()     -> DiffResult           (compares CC vs OC)
 *
 * Backup/restore:
 *   createBackup()  -> string | undefined  (snapshot before migration)
 *   listBackups()   -> BackupInfo[]        (available snapshots)
 *   restore()       -> RestoreResult       (revert migration)
 *   deleteBackup()  -> void                (remove a snapshot)
 */

export type { BackupFileEntry, BackupInfo, BackupManifest, RestoreResult } from "./backup"
// ─── Backup/restore ──────────────────────────────────────────────────
export { createBackup, deleteBackup, listBackups, restore } from "./backup"
export { convert } from "./converter"
export { convertAgents } from "./converter/agents"
export { convertCommands } from "./converter/commands"
export { convertConfig } from "./converter/config"
export { convertHistory } from "./converter/history"
export { convertHooks } from "./converter/hooks"
// ─── Individual converters for granular use ──────────────────────────
export { convertMcpServers, convertSingleMcpServer, mergeMcpSources } from "./converter/mcp"
export {
	detectProvider,
	isValidModelId,
	suggestSmallModel,
	translateModelId,
} from "./converter/model-id"
export { convertPermissions, mapToolName, parseToolPattern } from "./converter/permissions"
export { convertRules } from "./converter/rules"
export { verifySkills } from "./converter/skills"
export type { DiffItem, DiffResult } from "./differ"
export { diff } from "./differ"
// ─── High-level orchestration functions ──────────────────────────────
export { scan } from "./scanner"
// Claude Code types (maintained locally -- no SDK available)
export type {
	ClaudeAgentFrontmatter,
	ClaudeHooks,
	ClaudeMcpJson,
	ClaudeMcpServer,
	ClaudePermissions,
	ClaudeProjectSettings,
	ClaudeSettings,
	ClaudeUserState,
} from "./types/claude-code"
export type { ConversionResult, ConvertOptions, MigrationCategory } from "./types/conversion-result"
// Re-export OpenCode SDK types for consumer convenience
export type {
	OpenCodeAgentConfig,
	OpenCodeAgentFrontmatter,
	OpenCodeCommandFrontmatter,
	OpenCodeConfig,
	OpenCodeMcpLocal,
	OpenCodeMcpRemote,
	OpenCodePermission,
	OpenCodePermissionAction,
} from "./types/opencode"
export type { MigrationItem, MigrationReport } from "./types/report"
export { createEmptyReport, mergeReports } from "./types/report"
// ─── Types ───────────────────────────────────────────────────────────
export type {
	AgentFile,
	CommandFile,
	GlobalScanResult,
	HistoryScanResult,
	ProjectScanResult,
	ScanOptions,
	ScanResult,
	SkillInfo,
} from "./types/scan-result"
export type { ValidationError, ValidationResult } from "./validator"
export { validate } from "./validator"
export type { WriteOptions, WriteResult } from "./writer"
export { write } from "./writer"
export type { MergeStrategy } from "./writer/merge"
// ─── Writer utilities ────────────────────────────────────────────────
export { mergeConfigs } from "./writer/merge"
