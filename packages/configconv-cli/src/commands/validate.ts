/**
 * configconv validate -- Validate converted configuration.
 *
 * Runs a scan + convert and checks for issues in the conversion output.
 */

import type { AgentFormat } from "@palot/configconv"
import { formatName, scanFormat, universalConvert } from "@palot/configconv"
import { defineCommand } from "citty"
import consola from "consola"

export default defineCommand({
	meta: {
		name: "validate",
		description: "Validate a conversion between formats (dry-run check)",
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
			description: "Validate a specific project",
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
		})

		if (!args.json) consola.start(`Validating ${fromName} -> ${toName} conversion...`)

		const conversion = universalConvert(scanResult, { to })

		const hasErrors = conversion.report.errors.length > 0
		const hasWarnings = conversion.report.warnings.length > 0

		if (args.json) {
			consola.log(
				JSON.stringify(
					{
						from,
						to,
						valid: !hasErrors,
						errors: conversion.report.errors,
						warnings: conversion.report.warnings,
						converted: conversion.report.converted.length,
						skipped: conversion.report.skipped.length,
					},
					null,
					"\t",
				),
			)
			if (hasErrors) process.exit(1)
			return
		}

		if (!hasErrors && !hasWarnings) {
			consola.success(`Validation passed -- ${fromName} -> ${toName} conversion has no issues.`)
			consola.log(`  ${conversion.report.converted.length} items would be converted`)
			if (conversion.report.skipped.length > 0) {
				consola.log(`  ${conversion.report.skipped.length} items would be skipped`)
			}
		} else {
			if (hasErrors) {
				consola.error(`Validation found ${conversion.report.errors.length} error(s):`)
				for (const error of conversion.report.errors) {
					consola.log(`  ${error}`)
				}
			}

			if (hasWarnings) {
				consola.warn(`Warnings (${conversion.report.warnings.length}):`)
				for (const warning of conversion.report.warnings) {
					consola.log(`  ${warning}`)
				}
			}

			if (conversion.report.manualActions.length > 0) {
				consola.box({
					title: "Manual Actions Required",
					message: conversion.report.manualActions.map((a, i) => `${i + 1}. ${a}`).join("\n"),
				})
			}

			if (hasErrors) process.exit(1)
		}
	},
})
