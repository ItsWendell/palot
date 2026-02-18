#!/usr/bin/env bun
/**
 * configconv -- Universal agent configuration converter.
 *
 * Converts between Claude Code, OpenCode, and Cursor formats.
 *
 * Usage:
 *   configconv scan                Discover agent configuration files
 *   configconv plan                Show what would be converted (dry-run)
 *   configconv migrate             Convert configuration from one format to another
 *   configconv validate            Validate converted configuration
 *   configconv diff                Compare configurations across formats
 *   configconv restore             Restore files from a pre-migration backup
 */
import { defineCommand, runMain } from "citty"
import diffCommand from "./commands/diff"
import migrateCommand from "./commands/migrate"
import planCommand from "./commands/plan"
import restoreCommand from "./commands/restore"
import scanCommand from "./commands/scan"
import validateCommand from "./commands/validate"

const main = defineCommand({
	meta: {
		name: "configconv",
		version: "0.1.0",
		description: "Convert agent configuration between Claude Code, OpenCode, and Cursor formats",
	},
	subCommands: {
		scan: scanCommand,
		plan: planCommand,
		migrate: migrateCommand,
		validate: validateCommand,
		diff: diffCommand,
		restore: restoreCommand,
	},
})

runMain(main)
