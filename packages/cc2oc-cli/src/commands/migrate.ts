/**
 * cc2oc migrate -- Full migration from Claude Code to OpenCode.
 */

import type { MergeStrategy, MigrationCategory } from "@palot/cc2oc"
import { convert, scan, validate, write } from "@palot/cc2oc"
import { defineCommand } from "citty"
import consola from "consola"
import { printReport, printWriteResult } from "../output/terminal"

export default defineCommand({
	meta: {
		name: "migrate",
		description: "Migrate Claude Code configuration to OpenCode",
	},
	args: {
		project: {
			type: "string",
			description: "Migrate a specific project path (default: cwd)",
		},
		global: {
			type: "boolean",
			description: "Migrate global config only",
			default: false,
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
			description: "Include session history migration",
			default: false,
		},
		since: {
			type: "string",
			description: "History cutoff date (ISO 8601)",
		},
		"dry-run": {
			type: "boolean",
			description: "Simulate without writing files",
			default: false,
		},
		force: {
			type: "boolean",
			description: "Overwrite existing OpenCode files",
			default: false,
		},
		backup: {
			type: "boolean",
			description: "Backup existing files before overwriting",
			default: true,
		},
		"merge-strategy": {
			type: "string",
			description: "How to merge with existing config: preserve-existing, overwrite, merge",
			default: "preserve-existing",
		},
		verbose: {
			type: "boolean",
			description: "Detailed output",
			default: false,
		},
		json: {
			type: "boolean",
			description: "Output as JSON",
			default: false,
		},
	},
	async run({ args }) {
		// ─── Scan ────────────────────────────────────────────────────
		if (!args.json) consola.start("Scanning Claude Code configuration...")

		const scanResult = await scan({
			global: true,
			project: args.project || undefined,
			includeHistory: args["include-history"],
			since: args.since ? new Date(args.since) : undefined,
		})

		// ─── Convert ─────────────────────────────────────────────────
		if (!args.json) consola.start("Converting configuration...")

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

		const conversion = await convert(scanResult, {
			categories,
			includeHistory: args["include-history"],
		})

		// ─── Validate ────────────────────────────────────────────────
		if (!args.json) consola.start("Validating output...")

		const validation = validate(conversion)
		if (!validation.valid) {
			if (!args.json) {
				consola.error("Validation errors found:")
				for (const err of validation.errors) {
					consola.log(`  ${err.path}: ${err.message}`)
				}
				consola.log("")
				consola.info("Fix the issues above or use --force to skip validation.")
			}
			if (!args.force) {
				if (args.json) {
					consola.log(
						JSON.stringify({ error: "validation_failed", errors: validation.errors }, null, "\t"),
					)
				}
				process.exit(1)
			}
		}

		// ─── Write ───────────────────────────────────────────────────
		const dryRun = args["dry-run"]
		if (!args.json) {
			if (dryRun) {
				consola.info("Dry-run mode -- no files will be written.")
			} else {
				consola.start("Writing files...")
			}
		}

		const writeResult = await write(conversion, {
			dryRun,
			backup: args.backup,
			force: args.force,
			mergeStrategy: (args["merge-strategy"] as MergeStrategy) || "preserve-existing",
		})

		// ─── Output ──────────────────────────────────────────────────
		if (args.json) {
			consola.log(
				JSON.stringify(
					{
						report: conversion.report,
						validation: { valid: validation.valid, errors: validation.errors },
						writeResult,
						dryRun,
					},
					null,
					"\t",
				),
			)
			return
		}

		consola.log("")
		printReport(conversion.report)
		consola.log("")
		printWriteResult(writeResult)

		if (dryRun) {
			consola.log("")
			consola.info("This was a dry-run. Run without --dry-run to apply changes.")
		} else {
			consola.log("")
			consola.success("Migration complete!")
			if (writeResult.backupDir) {
				consola.info("To undo, run: cc2oc restore")
			}
		}
	},
})
