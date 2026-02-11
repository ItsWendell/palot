/**
 * cc2oc validate -- Validate existing OpenCode configuration.
 */

import { convert, scan, validate } from "@codedeck/cc2oc"
import { defineCommand } from "citty"
import consola from "consola"

export default defineCommand({
	meta: {
		name: "validate",
		description: "Validate converted or existing OpenCode configuration",
	},
	args: {
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
		if (!args.json) consola.start("Scanning and converting for validation...")

		const scanResult = await scan({
			global: true,
			project: args.project || undefined,
		})

		const conversion = await convert(scanResult)
		const result = validate(conversion)

		if (args.json) {
			consola.log(
				JSON.stringify(
					{
						valid: result.valid,
						errors: result.errors,
						warnings: result.warnings,
					},
					null,
					"\t",
				),
			)
			return
		}

		if (result.valid) {
			consola.success("Validation passed -- no errors found.")
		} else {
			consola.error(`Validation failed with ${result.errors.length} error(s):`)
			for (const err of result.errors) {
				consola.log(`  ${err.path}: ${err.message}`)
				if (err.value !== undefined) {
					consola.log(`    Value: ${JSON.stringify(err.value)}`)
				}
			}
		}

		if (result.warnings.length > 0) {
			consola.warn(`Warnings (${result.warnings.length}):`)
			for (const warning of result.warnings) {
				consola.log(`  ${warning}`)
			}
		}

		if (!result.valid) {
			process.exit(1)
		}
	},
})
