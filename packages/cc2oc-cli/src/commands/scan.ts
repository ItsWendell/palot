/**
 * cc2oc scan -- Discover Claude Code configuration files.
 */

import { scan } from "@palot/cc2oc"
import { defineCommand } from "citty"
import consola from "consola"
import { printScanSummary } from "../output/terminal"

export default defineCommand({
	meta: {
		name: "scan",
		description: "Scan for Claude Code configuration files",
	},
	args: {
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
			description: "Also scan session history",
			default: false,
		},
		json: {
			type: "boolean",
			description: "Output as JSON",
			default: false,
		},
	},
	async run({ args }) {
		const scanResult = await scan({
			global: true,
			project: args.project || undefined,
			includeHistory: args["include-history"],
		})

		if (args.json) {
			// JSON output for scripting
			const output = {
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

		// Pretty output
		printScanSummary({
			globalSettings: !!scanResult.global.settings,
			userState: !!scanResult.global.userState,
			globalSkills: scanResult.global.skills.length,
			projects: scanResult.projects.map((p) => ({
				path: p.path,
				mcp:
					Object.keys(p.mcpJson?.mcpServers ?? {}).length + Object.keys(p.projectMcpServers).length,
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
	},
})
