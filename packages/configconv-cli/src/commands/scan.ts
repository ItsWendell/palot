/**
 * configconv scan -- Discover agent configuration files.
 *
 * Supports scanning Claude Code, OpenCode, and Cursor formats.
 * Defaults to Claude Code for backwards compatibility.
 */

import type { AgentFormat } from "@palot/configconv"
import { formatName, scan, scanCursor, scanOpenCode } from "@palot/configconv"
import { defineCommand } from "citty"
import consola from "consola"
import { printScanSummary } from "../output/terminal"

export default defineCommand({
	meta: {
		name: "scan",
		description: "Scan for agent configuration files",
	},
	args: {
		format: {
			type: "string",
			description: "Format to scan: claude-code, opencode, cursor (default: claude-code)",
			default: "claude-code",
		},
		project: {
			type: "string",
			description: "Scan a specific project path",
		},
		global: {
			type: "boolean",
			description: "Scan global config only",
			default: false,
		},
		"include-history": {
			type: "boolean",
			description: "Also scan chat session history (Claude Code, Cursor)",
			default: false,
		},
		since: {
			type: "string",
			description: "History cutoff date (ISO 8601, e.g. 2025-01-01)",
		},
		json: {
			type: "boolean",
			description: "Output as JSON",
			default: false,
		},
	},
	async run({ args }) {
		const format = args.format as AgentFormat

		if (!args.json) {
			consola.start(`Scanning ${formatName(format)} configuration...`)
		}

		switch (format) {
			case "claude-code": {
				const scanResult = await scan({
					global: true,
					project: args.project || undefined,
					includeHistory: args["include-history"],
					since: args.since ? new Date(args.since) : undefined,
				})

				if (args.json) {
					const output = {
						format: "claude-code",
						global: {
							hasSettings: !!scanResult.global.settings,
							hasUserState: !!scanResult.global.userState,
							skillCount: scanResult.global.skills.length,
						},
						projects: scanResult.projects.map((p) => ({
							path: p.path,
							mcpServers:
								Object.keys(p.mcpJson?.mcpServers ?? {}).length +
								Object.keys(p.projectMcpServers).length,
							agents: p.agents.length,
							commands: p.commands.length,
							skills: p.skills.length,
							hasClaudeMd: !!p.claudeMd,
							hasAgentsMd: !!p.agentsMd,
						})),
						history: scanResult.history
							? {
									sessions: scanResult.history.totalSessions,
									messages: scanResult.history.totalMessages,
								}
							: undefined,
					}
					consola.log(JSON.stringify(output, null, "\t"))
					return
				}

				printScanSummary({
					format: "claude-code",
					globalSettings: !!scanResult.global.settings,
					userState: !!scanResult.global.userState,
					globalSkills: scanResult.global.skills.length,
					projects: scanResult.projects.map((p) => ({
						path: p.path,
						mcp:
							Object.keys(p.mcpJson?.mcpServers ?? {}).length +
							Object.keys(p.projectMcpServers).length,
						agents: p.agents.length,
						commands: p.commands.length,
						skills: p.skills.length,
						claudeMd: !!p.claudeMd,
						agentsMd: !!p.agentsMd,
					})),
					history: scanResult.history
						? {
								sessions: scanResult.history.totalSessions,
								messages: scanResult.history.totalMessages,
							}
						: undefined,
				})
				break
			}
			case "cursor": {
				const scanResult = await scanCursor({
					global: true,
					project: args.project || undefined,
					includeHistory: args["include-history"],
					since: args.since ? new Date(args.since) : undefined,
				})

				if (args.json) {
					const output = {
						format: "cursor",
						global: {
							mcpServers: scanResult.global.mcpJson?.mcpServers
								? Object.keys(scanResult.global.mcpJson.mcpServers).length
								: 0,
							skillCount: scanResult.global.skills.length,
							commandCount: scanResult.global.commands.length,
							agentCount: scanResult.global.agents.length,
						},
						projects: scanResult.projects.map((p) => ({
							path: p.path,
							mcpServers: p.mcpJson?.mcpServers ? Object.keys(p.mcpJson.mcpServers).length : 0,
							rules: p.rules.length,
							agents: p.agents.length,
							commands: p.commands.length,
							skills: p.skills.length,
							hasLegacyRules: !!p.cursorRules,
						})),
						history: scanResult.history
							? {
									sessions: scanResult.history.totalSessions,
									messages: scanResult.history.totalMessages,
								}
							: undefined,
					}
					consola.log(JSON.stringify(output, null, "\t"))
					return
				}

				consola.log("")
				consola.log("Cursor Configuration Found:")
				consola.log("")
				const globalMcp = scanResult.global.mcpJson?.mcpServers
					? Object.keys(scanResult.global.mcpJson.mcpServers).length
					: 0
				if (globalMcp > 0 || scanResult.global.skills.length > 0) {
					consola.log("  Global:")
					if (globalMcp > 0) consola.log(`    MCP servers:  ${globalMcp}`)
					if (scanResult.global.skills.length > 0)
						consola.log(`    Skills:       ${scanResult.global.skills.length}`)
					if (scanResult.global.commands.length > 0)
						consola.log(`    Commands:     ${scanResult.global.commands.length}`)
					if (scanResult.global.agents.length > 0)
						consola.log(`    Agents:       ${scanResult.global.agents.length}`)
				}
				for (const p of scanResult.projects) {
					consola.log("")
					consola.log(`  Project: ${p.path}`)
					const pMcp = p.mcpJson?.mcpServers ? Object.keys(p.mcpJson.mcpServers).length : 0
					if (pMcp > 0) consola.log(`    MCP servers:  ${pMcp}`)
					if (p.rules.length > 0) consola.log(`    Rules:        ${p.rules.length}`)
					if (p.agents.length > 0) consola.log(`    Agents:       ${p.agents.length}`)
					if (p.commands.length > 0) consola.log(`    Commands:     ${p.commands.length}`)
					if (p.skills.length > 0) consola.log(`    Skills:       ${p.skills.length}`)
					if (p.cursorRules) consola.log("    .cursorrules: yes (legacy)")
				}

				if (scanResult.history) {
					consola.log("")
					consola.log(
						`  History: ${scanResult.history.totalSessions} sessions, ${scanResult.history.totalMessages} messages`,
					)
				}
				consola.log("")
				break
			}
			case "opencode": {
				const scanResult = await scanOpenCode({
					global: true,
					project: args.project || undefined,
				})

				if (args.json) {
					const output = {
						format: "opencode",
						global: {
							hasConfig: !!scanResult.global.config,
							skillCount: scanResult.global.skills.length,
							agentCount: scanResult.global.agents.length,
							commandCount: scanResult.global.commands.length,
						},
						projects: scanResult.projects.map((p) => ({
							path: p.path,
							hasConfig: !!p.config,
							mcpServers: p.config?.mcp ? Object.keys(p.config.mcp).length : 0,
							agents: p.agents?.length ?? 0,
							commands: p.commands?.length ?? 0,
							skills: p.skills?.length ?? 0,
							hasAgentsMd: !!p.agentsMd,
						})),
					}
					consola.log(JSON.stringify(output, null, "\t"))
					return
				}

				consola.log("")
				consola.log("OpenCode Configuration Found:")
				consola.log("")
				if (
					scanResult.global.config ||
					scanResult.global.skills.length > 0 ||
					scanResult.global.agents.length > 0
				) {
					consola.log("  Global:")
					if (scanResult.global.config) consola.log("    opencode.json: yes")
					if (scanResult.global.skills.length > 0)
						consola.log(`    Skills:        ${scanResult.global.skills.length}`)
					if (scanResult.global.agents.length > 0)
						consola.log(`    Agents:        ${scanResult.global.agents.length}`)
					if (scanResult.global.commands.length > 0)
						consola.log(`    Commands:      ${scanResult.global.commands.length}`)
				}
				for (const p of scanResult.projects) {
					consola.log("")
					consola.log(`  Project: ${p.path}`)
					if (p.config) consola.log("    opencode.json: yes")
					const pMcp = p.config?.mcp ? Object.keys(p.config.mcp).length : 0
					if (pMcp > 0) consola.log(`    MCP servers:   ${pMcp}`)
					if (p.agents && p.agents.length > 0) consola.log(`    Agents:        ${p.agents.length}`)
					if (p.commands && p.commands.length > 0)
						consola.log(`    Commands:      ${p.commands.length}`)
					if (p.skills && p.skills.length > 0) consola.log(`    Skills:        ${p.skills.length}`)
					if (p.agentsMd) consola.log("    AGENTS.md:     yes")
				}
				consola.log("")
				break
			}
			default: {
				consola.error(
					`Unknown format: "${format}". Supported formats: claude-code, opencode, cursor`,
				)
				process.exit(1)
			}
		}
	},
})
