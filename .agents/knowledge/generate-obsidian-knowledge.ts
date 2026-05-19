/**
 * Generate Obsidian API knowledge document from the installed npm package.
 *
 * Usage:
 *   bun run .agents/knowledge/generate-obsidian-knowledge.ts
 *
 * Reads the type definitions from node_modules/obsidian/obsidian.d.ts
 * and extracts class/interface/method signatures into a structured
 * markdown knowledge file stored in .agents/knowledge/.
 */

import * as fs from "node:fs"
import * as path from "node:path"

// Run from project root:  bun run .agents/knowledge/generate-obsidian-knowledge.ts
const ROOT = process.cwd()
const PACKAGE_TYPES = path.join(ROOT, "node_modules", "obsidian", "obsidian.d.ts")
const OUT_DIR = path.join(ROOT, ".agents", "knowledge")
const OUT_FILE = path.join(OUT_DIR, "obsidian-api.md")

// ----------------------------------------------------------------
// 1. Parse the .d.ts file — extract class/interface/function docs
// ----------------------------------------------------------------

interface ApiEntry {
	kind: "class" | "interface" | "type" | "function" | "const"
	name: string
	signature: string
	docComment: string
	methods: { name: string; signature: string; docComment: string }[]
}

function parseTypeDefinitions(content: string): ApiEntry[] {
	const entries: ApiEntry[] = []

	// Match `export ... class Foo ... { ... }` or `export ... interface Foo ... { ... }`
	// We use a multi-pass approach: find top-level exports and extract their bodies.

	const lines = content.split("\n")
	let i = 0

	while (i < lines.length) {
		const line = lines[i]

		// Collect doc comment block
		let docLines: string[] = []
		if (line.trimStart().startsWith("/**")) {
			docLines.push(line)
			i++
			while (i < lines.length && !lines[i].includes("*/")) {
				docLines.push(lines[i])
				i++
			}
			if (i < lines.length) docLines.push(lines[i]) // closing */
			i++
		}

		const docComment = docLines
			.map((l) => l.replace(/^\s*\*\/?/gm, "").trim())
			.filter(Boolean)
			.join(" ")

		const currentLine = lines[i]?.trimStart() ?? ""

		// Match: export abstract class Name ... or export class Name ... or export interface Name ...
		const classMatch = currentLine.match(
			/^export\s+(abstract\s+)?(class|interface)\s+(\w+)(.*?)\{?$/,
		)
		if (classMatch) {
			const kind = classMatch[2] as "class" | "interface"
			const name = classMatch[3]
			const declRest = (classMatch[4] ?? "").trim()
			const signature = `export ${classMatch[1] ?? ""}${kind} ${name}${declRest}`

			// Collect body — matching braces
			let bodyStart = currentLine.includes("{")
				? i
				: findLineWithOpeningBrace(lines, i + 1)
			if (bodyStart === -1) {
				i++
				continue
			}
			const body = extractBracedBlock(lines, bodyStart)
			const methods = extractMethods(body)

			entries.push({
				kind,
				name,
				signature,
				docComment,
				methods,
			})

			i = bodyStart + body.split("\n").length
			continue
		}

		// Match: export type Foo = ...
		const typeMatch = currentLine.match(/^export\s+type\s+(\w+)\s*=\s*/)
		if (typeMatch) {
			const name = typeMatch[1]
			// Collect the full type expression (might span multiline)
			let typeBody = currentLine
			let j = i + 1
			while (j < lines.length && !typeBody.endsWith(";") && !typeBody.endsWith("}")) {
				typeBody += "\n" + lines[j]
				j++
			}
			entries.push({ kind: "type", name, signature: typeBody, docComment, methods: [] })
			i = j
			continue
		}

		// Match: export function foo(...)
		const funcMatch = currentLine.match(/^export\s+(async\s+)?function\s+(\w+)/)
		if (funcMatch) {
			const name = funcMatch[2]
			// Collect until semicolon or opening brace
			let funcBody = currentLine
			let j = i + 1
			while (j < lines.length && !funcBody.endsWith(";") && !funcBody.includes("{") && !funcBody.endsWith(":")) {
				funcBody += "\n" + lines[j]
				j++
			}
			entries.push({ kind: "function", name, signature: funcBody, docComment, methods: [] })
			i = j
			continue
		}

		// Match: export const foo: ...
		const constMatch = currentLine.match(/^export\s+const\s+(\w+)\s*:/)
		if (constMatch) {
			const name = constMatch[1]
			let constBody = currentLine
			let j = i + 1
			while (j < lines.length && !constBody.endsWith(";")) {
				constBody += "\n" + lines[j]
				j++
			}
			entries.push({ kind: "const", name, signature: constBody, docComment, methods: [] })
			i = j
			continue
		}

		i++
	}

	return entries
}

function findLineWithOpeningBrace(lines: string[], start: number): number {
	for (let j = start; j < lines.length; j++) {
		if (lines[j].includes("{")) return j
	}
	return -1
}

function extractBracedBlock(lines: string[], start: number): string {
	let depth = 0
	let block = ""
	let opened = false
	for (let j = start; j < lines.length; j++) {
		const line = lines[j]
		block += line + "\n"
		for (const ch of line) {
			if (ch === "{") {
				depth++
				opened = true
			}
			if (ch === "}") depth--
		}
		if (opened && depth === 0) break
	}
	return block.trim()
}

function extractMethods(body: string): { name: string; signature: string; docComment: string }[] {
	const methods: { name: string; signature: string; docComment: string }[] = []
	const lines = body.split("\n")
	let i = 0

	while (i < lines.length) {
		const line = lines[i]

		// Doc comment
		let docLines: string[] = []
		if (line.trimStart().startsWith("/**")) {
			docLines.push(line)
			i++
			while (i < lines.length && !lines[i].includes("*/")) {
				docLines.push(lines[i])
				i++
			}
			if (i < lines.length) docLines.push(lines[i])
			i++
		}

		const docComment = docLines
			.map((l) => l.replace(/^\s*\*\/?/gm, "").trim())
			.filter(Boolean)
			.join(" ")

		const currentLine = lines[i]?.trimStart() ?? ""

		// Method: name(...): ...; or name(...): ... {
		// Exclude constructor, static/protected, get/set
		const methodMatch = currentLine.match(
			/^(public\s+)?(abstract\s+|static\s+|protected\s+)?(get\s+|set\s+)?(\w+)\s*\(/,
		)
		if (methodMatch && !currentLine.startsWith("private")) {
			const name = methodMatch[4]
			// Ignore if it's a property type alias, not a method
			if (name === "constructor" || name === "new") {
				i++
				continue
			}
			// Collect until semicolon or opening brace
			let sig = currentLine
			let j = i + 1
			while (j < lines.length && !sig.endsWith(";") && !sig.includes("{")) {
				sig += "\n" + lines[j]
				j++
			}
			methods.push({ name, signature: sig.trim().replace(/;$/, ""), docComment })
			i = j
			continue
		}
		i++
	}

	return methods
}

// ----------------------------------------------------------------
// 2. Generate markdown knowledge document
// ----------------------------------------------------------------

function classifyEntries(entries: ApiEntry[]) {
	const pluginApi = entries.filter((e) =>
		["Plugin", "PluginManifest", "PluginSettingTab", "SettingTab", "Component"].includes(e.name),
	)
	const workspaceApi = entries.filter((e) =>
		["Workspace", "WorkspaceLeaf", "WorkspaceItem", "WorkspaceParent", "WorkspaceSplit", "WorkspaceTabs", "WorkspaceSidedock", "WorkspaceFloating", "WorkspaceRoot", "WorkspaceWindow", "WorkspaceContainer", "WorkspaceMobileDrawer"].includes(e.name),
	)
	const editorApi = entries.filter((e) =>
		["Editor", "EditorPosition", "EditorRange", "EditorSelection", "EditorTransaction", "EditorScrollInfo", "MarkdownView", "MarkdownFileInfo", "MarkdownEditView", "MarkdownPreviewView", "MarkdownSubView"].includes(e.name),
	)
	const vaultApi = entries.filter((e) =>
		["Vault", "TFile", "TFolder", "TAbstractFile", "DataAdapter", "FileManager", "FileStats", "FileSystemAdapter", "CapacitorAdapter", "MetadataCache", "CachedMetadata", "FrontMatterCache", "ListedFiles"].includes(e.name),
	)
	const uiApi = entries.filter((e) =>
		["Modal", "Notice", "Menu", "MenuItem", "Setting", "DropdownComponent", "TextComponent", "TextAreaComponent", "ToggleComponent", "SliderComponent", "ButtonComponent", "ColorComponent", "ExtraButtonComponent", "SearchComponent", "SecretComponent", "SuggestModal", "FuzzySuggestModal", "ProgressBarComponent", "MomentFormatComponent", "TooltipOptions", "TooltipPlacement"].includes(e.name),
	)
	const commandApi = entries.filter((e) =>
		["Command", "Hotkey", "Keymap", "KeymapContext", "KeymapEventHandler", "Scope", "Platform", "Modifier"].includes(e.name),
	)
	const viewApi = entries.filter((e) =>
		["View", "ItemView", "FileView", "TextFileView", "EditableFileView", "ViewCreator", "ViewState", "ViewStateResult", "WorkspaceRibbon"].includes(e.name),
	)
	const basesApi = entries.filter((e) => e.name.startsWith("Bases") || e.name === "QueryController")
	const other = entries.filter(
		(e) =>
			!pluginApi.includes(e) &&
			!workspaceApi.includes(e) &&
			!editorApi.includes(e) &&
			!vaultApi.includes(e) &&
			!uiApi.includes(e) &&
			!commandApi.includes(e) &&
			!viewApi.includes(e) &&
			!basesApi.includes(e),
	)

	return { pluginApi, workspaceApi, editorApi, vaultApi, uiApi, commandApi, viewApi, basesApi, other }
}

function renderEntry(entry: ApiEntry, indent = ""): string {
	const lines: string[] = []
	if (entry.docComment) {
		lines.push(`${indent}> ${entry.docComment}`)
	}
	lines.push(`${indent}\`\`\`typescript`)
	lines.push(`${indent}${entry.signature}`)
	lines.push(`${indent}\`\`\``)
	if (entry.methods.length > 0) {
		lines.push("")
		for (const m of entry.methods.slice(0, 30)) {
			if (m.docComment) {
				lines.push(`${indent}_${m.docComment}_`)
			}
			lines.push(`${indent}- \`${m.name}${m.signature.includes("(") ? m.signature.slice(m.signature.indexOf("(")) : ""}\``)
		}
		if (entry.methods.length > 30) {
			lines.push(`${indent}- _... and ${entry.methods.length - 30} more methods_`)
		}
	}
	lines.push("")
	return lines.join("\n")
}

function renderCategory(title: string, entries: ApiEntry[]): string {
	if (entries.length === 0) return ""
	const lines: string[] = []
	lines.push(`## ${title}`)
	lines.push("")
	for (const entry of entries) {
		lines.push(`### ${entry.kind === "function" ? "function" : entry.kind === "const" ? "const" : ""} \`${entry.name}\``)
		lines.push("")
		lines.push(renderEntry(entry))
	}
	return lines.join("\n")
}

function generate(): void {
	if (!fs.existsSync(PACKAGE_TYPES)) {
		console.error(`obsidian types not found at ${PACKAGE_TYPES}`)
		console.error("Run: bun add obsidian@latest")
		process.exit(1)
	}

	const content = fs.readFileSync(PACKAGE_TYPES, "utf-8")
	const entries = parseTypeDefinitions(content)
	const categorized = classifyEntries(entries)

	const docLines: string[] = []
	docLines.push("# Obsidian API Reference")
	docLines.push("")
	docLines.push(
		"Automatically generated from the `obsidian` npm package. Covers the key API surfaces for plugin development.",
	)
	docLines.push("")
	docLines.push(
		"Use this reference when implementing Obsidian plugins. Focus on the `Plugin` class, `Workspace`, `Vault`, `Editor`, and UI components.",
	)
	docLines.push("")
	docLines.push("---")
	docLines.push("")

	// Plugin lifecycle
	docLines.push(renderCategory("Plugin Lifecycle", categorized.pluginApi))
	docLines.push("---")
	docLines.push("")

	// Workspace
	docLines.push(renderCategory("Workspace API", categorized.workspaceApi))
	docLines.push("---")
	docLines.push("")

	// Editor
	docLines.push(renderCategory("Editor API", categorized.editorApi))
	docLines.push("---")
	docLines.push("")

	// Vault & Files
	docLines.push(renderCategory("Vault & File System", categorized.vaultApi))
	docLines.push("---")
	docLines.push("")

	// Views
	docLines.push(renderCategory("Views", categorized.viewApi))
	docLines.push("---")
	docLines.push("")

	// Commands & Keybindings
	docLines.push(renderCategory("Commands & Keybindings", categorized.commandApi))
	docLines.push("---")
	docLines.push("")

	// UI Components
	docLines.push(renderCategory("UI Components", categorized.uiApi))
	docLines.push("---")
	docLines.push("")

	// Bases (if available)
	docLines.push(renderCategory("Bases API (v1.10.0+)", categorized.basesApi))

	// Utility functions
	docLines.push("## Utility Functions")
	docLines.push("")
	const utils = categorized.other.filter((e) => e.kind === "function")
	for (const entry of utils) {
		docLines.push(`### ${entry.name}`)
		docLines.push("")
		docLines.push(renderEntry(entry))
	}

	const result = docLines.join("\n")

	if (!fs.existsSync(OUT_DIR)) {
		fs.mkdirSync(OUT_DIR, { recursive: true })
	}
	fs.writeFileSync(OUT_FILE, result, "utf-8")
	console.log(`Generated ${OUT_FILE} (${(result.length / 1024).toFixed(0)} KB)`)
}

generate()
