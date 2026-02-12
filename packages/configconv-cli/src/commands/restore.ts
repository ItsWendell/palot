/**
 * configconv restore -- Restore files from a pre-migration backup.
 */

import { deleteBackup, listBackups, restore } from "@palot/configconv"
import { defineCommand } from "citty"
import consola from "consola"
import { printBackupList, printRestoreResult } from "../output/terminal"

export default defineCommand({
	meta: {
		name: "restore",
		description: "Restore files from a pre-migration backup",
	},
	args: {
		list: {
			type: "boolean",
			description: "List available backups",
			default: false,
		},
		id: {
			type: "string",
			description: "Restore a specific backup by ID (timestamp)",
		},
		delete: {
			type: "string",
			description: "Delete a specific backup by ID",
		},
		json: {
			type: "boolean",
			description: "Output as JSON",
			default: false,
		},
	},
	async run({ args }) {
		// ─── Delete a backup ─────────────────────────────────────────
		if (args.delete) {
			try {
				await deleteBackup(args.delete)
				if (args.json) {
					consola.log(JSON.stringify({ deleted: args.delete }, null, "\t"))
				} else {
					consola.success(`Backup "${args.delete}" deleted.`)
				}
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err)
				if (args.json) {
					consola.log(JSON.stringify({ error: message }, null, "\t"))
				} else {
					consola.error(message)
				}
				process.exit(1)
			}
			return
		}

		// ─── List backups ────────────────────────────────────────────
		if (args.list) {
			const backups = await listBackups()

			if (args.json) {
				consola.log(
					JSON.stringify(
						backups.map((b) => ({
							id: b.id,
							createdAt: b.manifest.createdAt,
							description: b.manifest.description,
							files: b.manifest.files.length,
						})),
						null,
						"\t",
					),
				)
				return
			}

			printBackupList(backups)
			return
		}

		// ─── Restore ─────────────────────────────────────────────────
		const backupId = args.id || "latest"

		if (!args.json) {
			consola.start(
				`Restoring from backup${backupId === "latest" ? " (latest)" : ` "${backupId}"`}...`,
			)
		}

		try {
			const result = await restore(backupId)

			if (args.json) {
				consola.log(JSON.stringify(result, null, "\t"))
				return
			}

			consola.log("")
			printRestoreResult(result)

			if (result.errors.length === 0) {
				consola.log("")
				consola.success("Restore complete!")
			} else {
				consola.log("")
				consola.warn("Restore completed with errors.")
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err)
			if (args.json) {
				consola.log(JSON.stringify({ error: message }, null, "\t"))
			} else {
				consola.error(message)
			}
			process.exit(1)
		}
	},
})
