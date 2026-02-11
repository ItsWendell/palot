/**
 * cc2oc plan -- Dry-run showing what would be migrated.
 */

import type { MigrationCategory } from "@codedeck/cc2oc"
import { convert, scan, validate } from "@codedeck/cc2oc"
import { defineCommand } from "citty"
import consola from "consola"
import { printReport } from "../output/terminal"

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
		description: "Show what would be migrated (dry-run)",
	},
	args: {
		project: {
			type: "string",
			description: "Plan migration for a specific project",
		},
		only: {
			type: "string",
			description: "Comma-separated categories to include",
		},
		skip: {
			type: "string",
			description: "Comma-separated categories to skip",
		},
		"include-history": {
			type: "boolean",
			description: "Include session history in plan",
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
		consola.start("Scanning Claude Code configuration...")
		const scanResult = await scan({
			global: true,
			project: args.project || undefined,
			includeHistory: args["include-history"],
		})

		let categories: MigrationCategory[] | undefined
		if (args.only) {
			categories = args.only.split(",").map((s) => s.trim()) as MigrationCategory[]
		}
		if (args.skip) {
			const skipSet = new Set(args.skip.split(",").map((s) => s.trim()))
			const all: MigrationCategory[] = [
				"config",
				"mcp",
				"agents",
				"commands",
				"skills",
				"permissions",
				"rules",
				"hooks",
			]
			categories = all.filter((c) => !skipSet.has(c))
		}

		consola.start("Planning conversion...")
		const conversion = await convert(scanResult, {
			categories,
			includeHistory: args["include-history"],
		})

		const validation = validate(conversion)

		if (args.json) {
			const output = {
				report: conversion.report,
				validation: {
					valid: validation.valid,
					errors: validation.errors,
					warnings: validation.warnings,
				},
				files: {
					globalConfig: Object.keys(conversion.globalConfig).length > 0,
					projectConfigs: [...conversion.projectConfigs.keys()],
					agents: [...conversion.agents.keys()],
					commands: [...conversion.commands.keys()],
					rules: [...conversion.rules.keys()],
					hookPlugins: [...conversion.hookPlugins.keys()],
					sessions: conversion.sessions?.length ?? 0,
				},
			}
			consola.log(JSON.stringify(output, null, "\t"))
			return
		}

		consola.log("")
		consola.log("Migration Plan:")
		consola.log("═".repeat(60))

		printReport(conversion.report)

		if (!validation.valid) {
			consola.log("")
			consola.error("Validation issues found:")
			for (const err of validation.errors) {
				consola.log(`  ${err.path}: ${err.message}`)
			}
		}

		consola.log("")
		consola.log("Files that would be written:")

		const hasConfigs =
			Object.keys(conversion.globalConfig).length > 0 || conversion.projectConfigs.size > 0

		if (Object.keys(conversion.globalConfig).length > 0) {
			consola.log("  + ~/.config/opencode/opencode.json (global config)")
			if (args.verbose) {
				printJsonPreview(conversion.globalConfig)
			}
		}
		for (const [path, config] of conversion.projectConfigs) {
			consola.log(`  + ${path}/opencode.json (project config)`)
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
		for (const [path] of conversion.hookPlugins) {
			consola.log(`  + ${path}`)
		}

		consola.log("")
		if (!args.verbose && hasConfigs) {
			consola.info("Tip: use --verbose to preview file contents.")
		}
		consola.info("Run `cc2oc migrate` to apply these changes.")
	},
})
