#!/usr/bin/env bun
/**
 * cc2oc -- Claude Code to OpenCode migration CLI.
 *
 * Usage:
 *   cc2oc scan                Discover Claude Code configuration files
 *   cc2oc plan                Show what would be migrated (dry-run)
 *   cc2oc migrate             Migrate Claude Code config to OpenCode
 *   cc2oc validate            Validate converted OpenCode config
 *   cc2oc diff                Compare Claude Code and OpenCode configs
 */
import { defineCommand, runMain } from "citty"
import diffCommand from "./commands/diff"
import migrateCommand from "./commands/migrate"
import planCommand from "./commands/plan"
import scanCommand from "./commands/scan"
import validateCommand from "./commands/validate"

const main = defineCommand({
	meta: {
		name: "cc2oc",
		version: "0.1.0",
		description: "Migrate Claude Code configuration to OpenCode",
	},
	subCommands: {
		scan: scanCommand,
		plan: planCommand,
		migrate: migrateCommand,
		validate: validateCommand,
		diff: diffCommand,
	},
})

runMain(main)
