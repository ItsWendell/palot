/**
 * configconv migrate -- Convert configuration from one format to another.
 *
 * Supports all format pairs: Claude Code, OpenCode, Cursor.
 * Defaults to Claude Code -> OpenCode for backwards compatibility.
 */

import type { AgentFormat } from "@palot/configconv"
import {
	convertCursorHistory,
	formatName,
	scanFormat,
	universalConvert,
	universalWrite,
	writeHistorySessions,
} from "@palot/configconv"
import { defineCommand } from "citty"
import consola from "consola"

export default defineCommand({
	meta: {
		name: "migrate",
		description: "Convert configuration from one agent format to another",
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
			description: "Migrate a specific project path (default: all discovered projects)",
		},
		"include-history": {
			type: "boolean",
			description: "Include chat session history migration (Claude Code, Cursor)",
			default: false,
		},
		since: {
			type: "string",
			description: "History cutoff date (ISO 8601, e.g. 2025-01-01)",
		},
		"dry-run": {
			type: "boolean",
			description: "Simulate without writing files",
			default: false,
		},
		force: {
			type: "boolean",
			description: "Overwrite existing files",
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

		// ─── Scan ────────────────────────────────────────────────────
		if (!args.json) consola.start(`Scanning ${fromName} configuration...`)

		const scanResult = await scanFormat({
			format: from,
			global: true,
			project: args.project || undefined,
			includeHistory: args["include-history"],
			since: args.since ? new Date(args.since) : undefined,
		})

		// ─── Convert ─────────────────────────────────────────────────
		if (!args.json) consola.start(`Converting ${fromName} -> ${toName}...`)

		const conversion = universalConvert(scanResult, { to })

		// ─── Write ───────────────────────────────────────────────────
		const dryRun = args["dry-run"]
		if (!args.json) {
			if (dryRun) {
				consola.info("Dry-run mode -- no files will be written.")
			} else {
				consola.start("Writing files...")
			}
		}

		const mergeStrategy = (args["merge-strategy"] || "preserve-existing") as
			| "preserve-existing"
			| "overwrite"
			| "merge"

		const writeResult = await universalWrite(conversion, {
			dryRun,
			backup: args.backup,
			force: args.force,
			mergeStrategy,
		})

		// ─── History migration ────────────────────────────────────────
		let historyFilesWritten: string[] = []
		if (args["include-history"] && to === "opencode" && !dryRun) {
			if (from === "cursor" && scanResult.format === "cursor" && scanResult.data.history) {
				if (!args.json) consola.start("Converting chat history...")
				const { sessions } = convertCursorHistory(scanResult.data.history)
				if (sessions.length > 0) {
					historyFilesWritten = await writeHistorySessions(sessions)
					if (!args.json)
						consola.success(
							`Imported ${sessions.length} chat sessions (${historyFilesWritten.length} files)`,
						)
				} else if (!args.json) {
					consola.info("No chat sessions to import.")
				}
			} else if (
				from === "claude-code" &&
				scanResult.format === "claude-code" &&
				scanResult.data.history
			) {
				if (!args.json) consola.start("Converting chat history...")
				const { convertHistory } = await import("@palot/configconv/converter/history")
				const { sessions } = await convertHistory(scanResult.data.history)
				if (sessions.length > 0) {
					historyFilesWritten = await writeHistorySessions(sessions)
					if (!args.json)
						consola.success(
							`Imported ${sessions.length} chat sessions (${historyFilesWritten.length} files)`,
						)
				} else if (!args.json) {
					consola.info("No chat sessions to import.")
				}
			}
		}

		// ─── Output ──────────────────────────────────────────────────
		if (args.json) {
			consola.log(
				JSON.stringify(
					{
						from,
						to,
						report: conversion.report,
						writeResult: {
							filesWritten: [...writeResult.filesWritten, ...historyFilesWritten],
							filesSkipped: writeResult.filesSkipped,
							backupDir: writeResult.backupDir,
						},
						historyFilesWritten: historyFilesWritten.length,
						dryRun,
					},
					null,
					"\t",
				),
			)
			return
		}

		// Print conversion report
		if (conversion.report.converted.length > 0) {
			consola.log("")
			consola.success(`Converted (${conversion.report.converted.length}):`)
			for (const item of conversion.report.converted) {
				const details = item.details ? ` -- ${item.details}` : ""
				consola.log(`  [${item.category}] ${item.source} -> ${item.target}${details}`)
			}
		}

		if (conversion.report.skipped.length > 0) {
			consola.log("")
			consola.info(`Skipped (${conversion.report.skipped.length}):`)
			for (const item of conversion.report.skipped) {
				const details = item.details ? ` -- ${item.details}` : ""
				consola.log(`  [${item.category}] ${item.source}${details}`)
			}
		}

		if (conversion.report.warnings.length > 0) {
			consola.log("")
			consola.warn(`Warnings (${conversion.report.warnings.length}):`)
			for (const w of conversion.report.warnings) {
				consola.log(`  ${w}`)
			}
		}

		if (conversion.report.manualActions.length > 0) {
			consola.log("")
			consola.box({
				title: "Manual Actions Required",
				message: conversion.report.manualActions.map((a, i) => `${i + 1}. ${a}`).join("\n"),
			})
		}

		if (conversion.report.errors.length > 0) {
			consola.log("")
			consola.error(`Errors (${conversion.report.errors.length}):`)
			for (const e of conversion.report.errors) {
				consola.log(`  ${e}`)
			}
		}

		// Print write results
		consola.log("")
		if (writeResult.filesWritten.length > 0) {
			consola.success(`Files written (${writeResult.filesWritten.length}):`)
			for (const f of writeResult.filesWritten) {
				consola.log(`  + ${f}`)
			}
		}
		if (writeResult.filesSkipped.length > 0) {
			consola.info(`Files skipped (${writeResult.filesSkipped.length}):`)
			for (const f of writeResult.filesSkipped) {
				consola.log(`  ~ ${f}`)
			}
		}

		if (dryRun) {
			consola.log("")
			consola.info("This was a dry-run. Run without --dry-run to apply changes.")
		} else {
			consola.log("")
			consola.success(`Migration complete! (${fromName} -> ${toName})`)
			if (writeResult.backupDir) {
				consola.info(`Backup snapshot: ${writeResult.backupDir}`)
				consola.log("  Run `configconv restore` to revert if needed.")
			}
		}
	},
})
