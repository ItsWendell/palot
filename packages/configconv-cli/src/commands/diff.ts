/**
 * configconv diff -- Compare configurations across two formats.
 *
 * Scans both source and target formats and shows what exists
 * in one but not the other. Useful for seeing what a migration would change.
 */

import type { AgentFormat, CanonicalScanResult } from "@palot/configconv"
import { formatName, scanFormat, toCanonical } from "@palot/configconv"
import { defineCommand } from "citty"
import consola from "consola"

interface DiffSummary {
	onlyInSource: Array<{ category: string; key: string; details?: string }>
	onlyInTarget: Array<{ category: string; key: string; details?: string }>
	inBoth: Array<{ category: string; key: string; details?: string }>
}

export default defineCommand({
	meta: {
		name: "diff",
		description: "Compare configurations between two formats",
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
			description: "Compare for a specific project",
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

		// Scan both formats
		if (!args.json) consola.start(`Scanning ${fromName} configuration...`)
		const sourceScan = await scanFormat({
			format: from,
			global: true,
			project: args.project || undefined,
		})

		if (!args.json) consola.start(`Scanning ${toName} configuration...`)
		const targetScan = await scanFormat({
			format: to,
			global: true,
			project: args.project || undefined,
		})

		// Convert both to canonical for comparison
		const sourceCanonical = toCanonical(sourceScan)
		const targetCanonical = toCanonical(targetScan)

		const diff = compareCanonical(sourceCanonical, targetCanonical)

		if (args.json) {
			consola.log(
				JSON.stringify(
					{
						from,
						to,
						onlyInSource: diff.onlyInSource,
						onlyInTarget: diff.onlyInTarget,
						inBoth: diff.inBoth,
					},
					null,
					"\t",
				),
			)
			return
		}

		consola.log("")
		consola.log(`Comparison: ${fromName} vs ${toName}`)
		consola.log("=".repeat(60))

		if (diff.onlyInSource.length > 0) {
			consola.log("")
			consola.warn(`Only in ${fromName} (${diff.onlyInSource.length}):`)
			for (const item of diff.onlyInSource) {
				const details = item.details ? ` -- ${item.details}` : ""
				consola.log(`  + [${item.category}] ${item.key}${details}`)
			}
		}

		if (diff.onlyInTarget.length > 0) {
			consola.log("")
			consola.info(`Only in ${toName} (${diff.onlyInTarget.length}):`)
			for (const item of diff.onlyInTarget) {
				const details = item.details ? ` -- ${item.details}` : ""
				consola.log(`  - [${item.category}] ${item.key}${details}`)
			}
		}

		if (diff.inBoth.length > 0) {
			consola.log("")
			consola.success(`In both (${diff.inBoth.length}):`)
			for (const item of diff.inBoth) {
				const details = item.details ? ` -- ${item.details}` : ""
				consola.log(`  = [${item.category}] ${item.key}${details}`)
			}
		}

		const total = diff.onlyInSource.length + diff.onlyInTarget.length + diff.inBoth.length
		consola.log("")
		consola.log(`Total: ${total} items compared`)
		consola.log(`  ${diff.inBoth.length} in both`)
		consola.log(`  ${diff.onlyInSource.length} only in ${fromName}`)
		consola.log(`  ${diff.onlyInTarget.length} only in ${toName}`)

		if (diff.onlyInSource.length > 0) {
			consola.log("")
			consola.info(
				`Run \`configconv migrate --from ${from} --to ${to}\` to migrate ${fromName} items to ${toName}.`,
			)
		}
	},
})

/**
 * Compare two canonical scan results by looking at MCP servers,
 * agents, commands, rules, and skills by name.
 */
function compareCanonical(source: CanonicalScanResult, target: CanonicalScanResult): DiffSummary {
	const diff: DiffSummary = {
		onlyInSource: [],
		onlyInTarget: [],
		inBoth: [],
	}

	// Compare global model
	if (source.global.model && !target.global.model) {
		diff.onlyInSource.push({ category: "config", key: "model", details: source.global.model })
	} else if (!source.global.model && target.global.model) {
		diff.onlyInTarget.push({ category: "config", key: "model", details: target.global.model })
	} else if (source.global.model && target.global.model) {
		diff.inBoth.push({
			category: "config",
			key: "model",
			details: `${source.global.model} / ${target.global.model}`,
		})
	}

	// Compare global MCP servers
	compareSets(
		new Set(Object.keys(source.global.mcpServers)),
		new Set(Object.keys(target.global.mcpServers)),
		"mcp",
		"global",
		diff,
	)

	// Compare global agents
	compareSets(
		new Set(source.global.agents.map((a) => a.name)),
		new Set(target.global.agents.map((a) => a.name)),
		"agents",
		"global",
		diff,
	)

	// Compare global commands
	compareSets(
		new Set(source.global.commands.map((c) => c.name)),
		new Set(target.global.commands.map((c) => c.name)),
		"commands",
		"global",
		diff,
	)

	// Compare global skills
	compareSets(
		new Set(source.global.skills.map((s) => s.name)),
		new Set(target.global.skills.map((s) => s.name)),
		"skills",
		"global",
		diff,
	)

	// Compare per-project items
	const allProjectPaths = new Set([
		...source.projects.map((p) => p.path),
		...target.projects.map((p) => p.path),
	])

	for (const projectPath of allProjectPaths) {
		const sourceProject = source.projects.find((p) => p.path === projectPath)
		const targetProject = target.projects.find((p) => p.path === projectPath)

		if (sourceProject && !targetProject) {
			diff.onlyInSource.push({
				category: "project",
				key: projectPath,
				details: "Entire project",
			})
			continue
		}
		if (!sourceProject && targetProject) {
			diff.onlyInTarget.push({
				category: "project",
				key: projectPath,
				details: "Entire project",
			})
			continue
		}
		if (!sourceProject || !targetProject) continue

		// Compare project MCP servers
		compareSets(
			new Set(Object.keys(sourceProject.mcpServers)),
			new Set(Object.keys(targetProject.mcpServers)),
			"mcp",
			projectPath,
			diff,
		)

		// Compare project agents
		compareSets(
			new Set(sourceProject.agents.map((a) => a.name)),
			new Set(targetProject.agents.map((a) => a.name)),
			"agents",
			projectPath,
			diff,
		)

		// Compare project commands
		compareSets(
			new Set(sourceProject.commands.map((c) => c.name)),
			new Set(targetProject.commands.map((c) => c.name)),
			"commands",
			projectPath,
			diff,
		)
	}

	return diff
}

function compareSets(
	sourceSet: Set<string>,
	targetSet: Set<string>,
	category: string,
	context: string,
	diff: DiffSummary,
): void {
	for (const name of sourceSet) {
		if (targetSet.has(name)) {
			diff.inBoth.push({ category, key: name, details: context })
		} else {
			diff.onlyInSource.push({ category, key: name, details: context })
		}
	}
	for (const name of targetSet) {
		if (!sourceSet.has(name)) {
			diff.onlyInTarget.push({ category, key: name, details: context })
		}
	}
}
