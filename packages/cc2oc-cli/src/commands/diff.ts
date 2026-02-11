/**
 * cc2oc diff -- Compare Claude Code and OpenCode configurations.
 */

import { diff, scan } from "@codedeck/cc2oc"
import { defineCommand } from "citty"
import consola from "consola"
import { printDiff } from "../output/terminal"

export default defineCommand({
	meta: {
		name: "diff",
		description: "Compare Claude Code and OpenCode configurations",
	},
	args: {
		project: {
			type: "string",
			description: "Compare for a specific project",
		},
		json: {
			type: "boolean",
			description: "Output as JSON",
			default: false,
		},
	},
	async run({ args }) {
		if (!args.json) consola.start("Scanning Claude Code configuration...")

		const scanResult = await scan({
			global: true,
			project: args.project || undefined,
		})

		if (!args.json) consola.start("Comparing with OpenCode configuration...")

		const diffResult = await diff(scanResult)

		if (args.json) {
			consola.log(
				JSON.stringify(
					{
						onlyInClaudeCode: diffResult.onlyInClaudeCode,
						onlyInOpenCode: diffResult.onlyInOpenCode,
						different: diffResult.different,
						matching: diffResult.matching,
					},
					null,
					"\t",
				),
			)
			return
		}

		printDiff(diffResult)

		const total =
			diffResult.onlyInClaudeCode.length +
			diffResult.onlyInOpenCode.length +
			diffResult.different.length +
			diffResult.matching.length

		consola.log(`Total: ${total} items compared`)
		consola.log(`  ${diffResult.matching.length} matching`)
		consola.log(`  ${diffResult.onlyInClaudeCode.length} only in Claude Code`)
		consola.log(`  ${diffResult.onlyInOpenCode.length} only in OpenCode`)
		consola.log(`  ${diffResult.different.length} different`)

		if (diffResult.onlyInClaudeCode.length > 0) {
			consola.log("")
			consola.info("Run `cc2oc migrate` to migrate Claude Code items to OpenCode.")
		}
	},
})
