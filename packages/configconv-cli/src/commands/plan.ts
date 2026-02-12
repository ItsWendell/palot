/**
 * configconv plan -- Dry-run showing what would be converted.
 *
 * Supports --from/--to for universal conversion planning.
 * Defaults to Claude Code -> OpenCode.
 */

import type { AgentFormat } from "@palot/configconv"
import { formatName, scanFormat, universalConvert } from "@palot/configconv"
import { defineCommand } from "citty"
import consola from "consola"

function printJsonPreview(obj: unknown): void {
	const json = JSON.stringify(obj, null, "  ")
	const lines = json.split("\n")
	for (const line of lines) {
		consola.log(`    ${line}`)
	}
	consola.log("")
}

export default defineCommand({
	meta: {
		name: "plan",
		description: "Show what would be converted (dry-run)",
	},
	args: {
		from: {
			type: "string",
			description: "Source format: claude-code, opencode, cursor (default: claude-code)",
			default: "claude-code",
		},
		to: {
			type: "string",
			description: "Target format: claude-code, opencode, cursor (default: opencode)",
			default: "opencode",
		},
		project: {
			type: "string",
			description: "Plan conversion for a specific project",
		},
		"include-history": {
			type: "boolean",
			description: "Include session history in plan (Claude Code only)",
			default: false,
		},
		verbose: {
			type: "boolean",
			description: "Show file content previews",
			default: false,
		},
		json: {
			type: "boolean",
			description: "Output as JSON",
			default: false,
		},
	},
	async run({ args }) {
		const from = args.from as AgentFormat
		const to = args.to as AgentFormat
		const fromName = formatName(from)
		const toName = formatName(to)

		if (from === to) {
			consola.error(`Source and target format are the same: ${fromName}`)
			process.exit(1)
		}

		if (!args.json) consola.start(`Scanning ${fromName} configuration...`)

		const scanResult = await scanFormat({
			format: from,
			global: true,
			project: args.project || undefined,
			includeHistory: args["include-history"],
		})

		if (!args.json) consola.start(`Planning ${fromName} -> ${toName} conversion...`)

		const conversion = universalConvert(scanResult, { to })

		if (args.json) {
			const output = {
				from,
				to,
				report: conversion.report,
				files: {
					globalConfig: Object.keys(conversion.globalConfig).length > 0,
					projectConfigs: [...conversion.projectConfigs.keys()],
					agents: [...conversion.agents.keys()],
					commands: [...conversion.commands.keys()],
					rules: [...conversion.rules.keys()],
					extraFiles: [...conversion.extraFiles.keys()],
				},
			}
			consola.log(JSON.stringify(output, null, "\t"))
			return
		}

		consola.log("")
		consola.log(`Conversion Plan: ${fromName} -> ${toName}`)
		consola.log("=".repeat(60))

		if (conversion.report.converted.length > 0) {
			consola.success(`Would convert (${conversion.report.converted.length}):`)
			for (const item of conversion.report.converted) {
				const details = item.details ? ` -- ${item.details}` : ""
				consola.log(`  [${item.category}] ${item.source} -> ${item.target}${details}`)
			}
		}

		if (conversion.report.skipped.length > 0) {
			consola.info(`Would skip (${conversion.report.skipped.length}):`)
			for (const item of conversion.report.skipped) {
				const details = item.details ? ` -- ${item.details}` : ""
				consola.log(`  [${item.category}] ${item.source}${details}`)
			}
		}

		if (conversion.report.warnings.length > 0) {
			consola.warn(`Warnings (${conversion.report.warnings.length}):`)
			for (const w of conversion.report.warnings) {
				consola.log(`  ${w}`)
			}
		}

		if (conversion.report.manualActions.length > 0) {
			consola.box({
				title: "Manual Actions Required",
				message: conversion.report.manualActions.map((a, i) => `${i + 1}. ${a}`).join("\n"),
			})
		}

		consola.log("")
		consola.log("Files that would be written:")

		const hasConfigs =
			Object.keys(conversion.globalConfig).length > 0 || conversion.projectConfigs.size > 0

		if (Object.keys(conversion.globalConfig).length > 0) {
			consola.log("  + (global config)")
			if (args.verbose) {
				printJsonPreview(conversion.globalConfig)
			}
		}
		for (const [path, config] of conversion.projectConfigs) {
			consola.log(`  + ${path} (project config)`)
			if (args.verbose) {
				printJsonPreview(config)
			}
		}
		for (const [path] of conversion.agents) {
			consola.log(`  + ${path}`)
		}
		for (const [path] of conversion.commands) {
			consola.log(`  + ${path}`)
		}
		for (const [path] of conversion.rules) {
			consola.log(`  + ${path}`)
		}
		for (const [path] of conversion.extraFiles) {
			consola.log(`  + ${path}`)
		}

		consola.log("")
		if (!args.verbose && hasConfigs) {
			consola.info("Tip: use --verbose to preview file contents.")
		}
		consola.info(`Run \`configconv migrate --from ${from} --to ${to}\` to apply these changes.`)
	},
})
