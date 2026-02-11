# Tool Architecture: `cc2oc`

> Implementation plan for the Claude Code to OpenCode migration tool, built as a dual-package in the Codedeck monorepo for reuse as both a standalone CLI and an importable library.

## Design Decision: Dual-Package in Monorepo

The tool is split into two workspace packages inside the Codedeck monorepo:

| Package | Name | Purpose |
|---------|------|---------|
| `packages/cc2oc` | `@codedeck/cc2oc` | **Pure library** -- all scanning, conversion, validation logic. Zero CLI dependencies. |
| `packages/cc2oc-cli` | `cc2oc` | **Thin CLI wrapper** -- uses `citty` for argument parsing, imports everything from `@codedeck/cc2oc`. Published to npm as `cc2oc`. |

### Why This Split

1. **Codedeck reuse** -- `apps/desktop` imports `@codedeck/cc2oc` directly via `workspace:*` for in-app migration UX (e.g., an import wizard that detects Claude Code configs and offers one-click migration)
2. **No CLI bloat in library consumers** -- `@codedeck/cc2oc` has only data-processing deps (zod, yaml, jsonc-parser). No `citty`, `consola`, or terminal formatting.
3. **Follows existing patterns** -- mirrors how `@codedeck/ui` (library) is consumed by `@codedeck/desktop` (app). Same `workspace:*` linking, same source-level imports.
4. **Independent publishing** -- the CLI can be published to npm as `cc2oc` for standalone use (`npx cc2oc migrate`), while the library stays private within the monorepo.

---

## Technology Choice

### Runtime: Bun
- Codedeck monorepo already uses Bun workspaces
- Native TypeScript execution (no build step for development)
- Fast file system APIs

### Language: TypeScript
- Matches the entire monorepo
- Zod for schema validation (matching OpenCode's own approach)
- Strict mode, ESM, `moduleResolution: "bundler"`

### Linting: Root Biome config
- Inherited automatically (tabs, double quotes, no semicolons, trailing commas)

---

## Package Structure

### `packages/cc2oc` -- Pure Library

```
packages/cc2oc/
├── src/
│   ├── index.ts                # Public API barrel export
│   ├── scanner/
│   │   ├── index.ts            # scan() -- orchestrates all scanners
│   │   ├── claude-config.ts    # Scan ~/.Claude/ and ~/.claude.json
│   │   ├── project-config.ts   # Scan .claude/ in projects
│   │   └── types.ts            # Scanner input/output types
│   ├── converter/
│   │   ├── index.ts            # convert() -- orchestrates all converters
│   │   ├── config.ts           # Global settings conversion
│   │   ├── mcp.ts              # MCP server format conversion
│   │   ├── agents.ts           # Agent definition conversion
│   │   ├── commands.ts         # Command file conversion
│   │   ├── skills.ts           # Skill compatibility verification
│   │   ├── permissions.ts      # Permission system mapping
│   │   ├── rules.ts            # CLAUDE.md -> AGENTS.md
│   │   ├── history.ts          # Session history conversion
│   │   ├── hooks.ts            # CC hooks -> OC plugin stub generation
│   │   └── model-id.ts         # Model ID translation table
│   ├── writer/
│   │   ├── index.ts            # write() -- writes conversion results to disk
│   │   └── merge.ts            # Deep merge with existing OC config
│   ├── validator/
│   │   ├── index.ts            # validate() -- schema compliance check
│   │   └── schema.ts           # OpenCode config Zod schema (subset)
│   ├── differ/
│   │   └── index.ts            # diff() -- compare CC vs OC configs
│   ├── types/
│   │   ├── claude-code.ts      # Claude Code config type definitions
│   │   ├── opencode.ts         # OpenCode config type definitions
│   │   ├── scan-result.ts      # Scanner output types
│   │   ├── conversion-result.ts # Converter output types
│   │   └── report.ts           # Migration report types
│   └── utils/
│       ├── paths.ts            # CC/OC path resolution (XDG, platform-aware)
│       ├── yaml.ts             # YAML frontmatter parsing (lenient, CC-compat)
│       ├── json.ts             # JSONC reading
│       └── fs.ts               # File existence checks, safe reads
├── test/
│   ├── fixtures/               # Sanitized sample CC configs
│   │   ├── settings.json
│   │   ├── claude.json
│   │   ├── mcp.json
│   │   ├── agents/
│   │   │   ├── code-reviewer.md
│   │   │   └── security-auditor.md
│   │   └── commands/
│   │       └── deploy.md
│   ├── scanner/
│   │   └── claude-config.test.ts
│   ├── converter/
│   │   ├── mcp.test.ts
│   │   ├── agents.test.ts
│   │   ├── permissions.test.ts
│   │   ├── config.test.ts
│   │   └── model-id.test.ts
│   ├── writer/
│   │   └── merge.test.ts
│   └── integration/
│       └── full-migration.test.ts
├── package.json
└── tsconfig.json
```

**`package.json`:**
```json
{
  "name": "@codedeck/cc2oc",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./scanner": "./src/scanner/index.ts",
    "./converter": "./src/converter/index.ts",
    "./converter/*": "./src/converter/*.ts",
    "./writer": "./src/writer/index.ts",
    "./validator": "./src/validator/index.ts",
    "./differ": "./src/differ/index.ts",
    "./types": "./src/types/index.ts",
    "./types/*": "./src/types/*.ts",
    "./utils/*": "./src/utils/*.ts"
  },
  "scripts": {
    "check-types": "tsgo --noEmit",
    "test": "bun test",
    "lint": "biome check .",
    "clean": "rm -rf node_modules .turbo"
  },
  "dependencies": {
    "zod": "^4.0.0",
    "yaml": "^2.0.0",
    "jsonc-parser": "^3.0.0"
  },
  "devDependencies": {
    "bun-types": "latest",
    "typescript": "^5.8.0"
  }
}
```

**Public API (`src/index.ts`):**
```typescript
// High-level orchestration functions
export { scan } from "./scanner"
export { convert } from "./converter"
export { write } from "./writer"
export { validate } from "./validator"
export { diff } from "./differ"

// Individual converters for granular use
export { convertMcpServers } from "./converter/mcp"
export { convertAgent } from "./converter/agents"
export { convertPermissions } from "./converter/permissions"
export { translateModelId } from "./converter/model-id"

// Types
export type * from "./types/scan-result"
export type * from "./types/conversion-result"
export type * from "./types/report"
export type * from "./types/claude-code"
export type * from "./types/opencode"
```

### `packages/cc2oc-cli` -- CLI Wrapper

```
packages/cc2oc-cli/
├── src/
│   ├── index.ts              # Entry point (bin)
│   ├── commands/
│   │   ├── scan.ts           # cc2oc scan
│   │   ├── plan.ts           # cc2oc plan (dry-run)
│   │   ├── migrate.ts        # cc2oc migrate
│   │   ├── validate.ts       # cc2oc validate
│   │   └── diff.ts           # cc2oc diff
│   └── output/
│       ├── terminal.ts       # Terminal formatting (colors, tables)
│       └── report.ts         # Report rendering
├── package.json
└── tsconfig.json
```

**`package.json`:**
```json
{
  "name": "cc2oc",
  "version": "0.1.0",
  "private": false,
  "type": "module",
  "bin": {
    "cc2oc": "./src/index.ts"
  },
  "scripts": {
    "check-types": "tsgo --noEmit",
    "lint": "biome check .",
    "clean": "rm -rf node_modules .turbo"
  },
  "dependencies": {
    "@codedeck/cc2oc": "workspace:*",
    "citty": "^0.2.0",
    "consola": "^3.0.0"
  },
  "devDependencies": {
    "bun-types": "latest",
    "typescript": "^5.8.0"
  }
}
```

The CLI is a thin layer: parse args with `citty`, call library functions, format output with `consola`.

---

## How Codedeck Consumes the Library

### In `apps/desktop/package.json`:
```json
{
  "dependencies": {
    "@codedeck/cc2oc": "workspace:*"
  }
}
```

### Usage in Codedeck (renderer or main process):

```typescript
// Example: Import wizard component in the desktop app
import { scan, convert, validate } from "@codedeck/cc2oc"
import { convertMcpServers } from "@codedeck/cc2oc/converter/mcp"
import type { ScanResult, ConversionResult } from "@codedeck/cc2oc/types"

// Scan for Claude Code configs
const scanResult: ScanResult = await scan({
  global: true,
  project: "/Users/foo/my-project",
})

// Show user what was found, let them select what to migrate
// ...UI code...

// Convert selected items
const conversionResult: ConversionResult = await convert(scanResult, {
  categories: ["config", "mcp", "agents"],
  includeHistory: false,
})

// Validate before writing
const validation = await validate(conversionResult)
if (validation.errors.length > 0) {
  // Show errors in UI
}

// Write to disk (or let the user review first)
await write(conversionResult, {
  dryRun: false,
  backup: true,
  mergeStrategy: "preserve-existing",
})
```

### In Electron main process (for filesystem access):

Since the library does file I/O (scanning `~/.Claude/`, writing to `~/.config/opencode/`), it needs to run in the **main process** in Electron mode. The pattern follows existing Codedeck conventions:

1. Library functions called in main process via IPC handler
2. Renderer sends IPC request -> main process runs scan/convert/write -> result sent back
3. Renderer displays results in a migration wizard UI

```typescript
// main/ipc/migration.ts
import { scan, convert, write } from "@codedeck/cc2oc"

ipcMain.handle("cc2oc:scan", async () => {
  return await scan({ global: true })
})

ipcMain.handle("cc2oc:migrate", async (_, options) => {
  const scanResult = await scan(options)
  const converted = await convert(scanResult, options)
  return await write(converted, options)
})
```

---

## Data Flow

### Library Pipeline (no I/O opinion -- pure data in, data out)

```
scan(options)          -> ScanResult           (reads filesystem, returns structured data)
    │
    v
convert(scanResult)    -> ConversionResult     (pure transformation, no I/O)
    │
    v
validate(conversion)   -> ValidationResult     (pure checks against schema)
    │
    v
write(conversion)      -> WriteResult          (writes to filesystem)
    │
    v
diff(scanResult)       -> DiffResult           (compares CC vs current OC)
```

The key design principle: **`convert()` is pure** -- it takes data and returns data. No filesystem access. This makes it testable, usable in any context (CLI, Electron main process, web worker), and composable.

Only `scan()` and `write()` touch the filesystem. The CLI and Codedeck can both swap in their own I/O layer if needed (e.g., Codedeck could scan via IPC instead of direct fs access).

### Optional: Dependency Injection for I/O

For maximum flexibility, `scan()` and `write()` can accept an I/O adapter:

```typescript
interface FsAdapter {
  readFile(path: string): Promise<string>
  writeFile(path: string, content: string): Promise<void>
  exists(path: string): Promise<boolean>
  readDir(path: string): Promise<string[]>
  glob(pattern: string, cwd: string): Promise<string[]>
}

// Default: uses Bun/Node fs directly
export async function scan(options: ScanOptions, fs?: FsAdapter): Promise<ScanResult>

// Codedeck could pass an IPC-backed adapter
const ipcFs: FsAdapter = {
  readFile: (p) => ipcRenderer.invoke("fs:readFile", p),
  // ...
}
const result = await scan(options, ipcFs)
```

This is optional complexity -- start without it and add if Codedeck's renderer actually needs to call scan directly.

---

## Key Types

```typescript
// --- Scanner Types ---

interface ScanOptions {
  global?: boolean                    // Scan global CC config
  project?: string                    // Scan specific project path
  includeHistory?: boolean            // Scan session history
  since?: Date                        // History cutoff date
}

interface ScanResult {
  global: {
    settings?: ClaudeSettings         // ~/.Claude/settings.json
    userState?: ClaudeUserState       // ~/.claude.json
    skills: SkillInfo[]               // ~/.Claude/skills/
  }
  projects: ProjectScanResult[]
  history?: HistoryScanResult
}

interface ProjectScanResult {
  path: string
  settingsLocal?: ClaudeProjectSettings
  mcpJson?: McpJsonConfig
  agents: AgentFile[]
  commands: CommandFile[]
  skills: SkillInfo[]
  claudeMd?: string
  agentsMd?: string
  projectMcpServers: Record<string, McpServerConfig>
}

// --- Converter Types ---

interface ConvertOptions {
  categories?: MigrationCategory[]    // Which categories to convert
  includeHistory?: boolean
  modelOverrides?: Record<string, string>  // Manual model ID mappings
}

type MigrationCategory =
  | "config" | "mcp" | "agents" | "commands"
  | "skills" | "permissions" | "rules" | "history"

interface ConversionResult {
  globalConfig: Partial<OpenCodeConfig>
  projectConfigs: Map<string, Partial<OpenCodeConfig>>
  agents: Map<string, string>              // target path -> converted markdown content
  commands: Map<string, string>            // target path -> converted markdown content
  rules: Map<string, string>              // target path -> AGENTS.md content
  sessions?: ConvertedSession[]            // optional history
  report: MigrationReport
}

// --- Writer Types ---

interface WriteOptions {
  dryRun?: boolean
  backup?: boolean
  force?: boolean                          // Overwrite existing files
  mergeStrategy?: "preserve-existing" | "overwrite" | "merge"
}

interface WriteResult {
  filesWritten: string[]
  filesSkipped: string[]
  backupPaths: string[]
}

// --- Report Types ---

interface MigrationReport {
  migrated: MigrationItem[]
  skipped: MigrationItem[]
  warnings: string[]
  manualActions: string[]                  // Things the user must do manually
  errors: string[]
}

interface MigrationItem {
  category: MigrationCategory
  source: string                           // CC file path or description
  target: string                           // OC file path or description
  details?: string
}
```

---

## CLI Commands

### `cc2oc scan`
```
$ cc2oc scan

Claude Code Configuration Found:
  Global:
    ~/.Claude/settings.json         (model, permissions, env)
    ~/.claude.json                   (3 projects with MCP configs)
    ~/.Claude/skills/                (9 skills via symlinks)

  Project: /Users/foo/my-project
    .claude/settings.local.json     (permission overrides)
    .claude/agents/                  (3 agents)
    .claude/commands/                (2 commands)
    .mcp.json                        (2 MCP servers)
    CLAUDE.md                        (project rules)

  History:
    42 sessions across 3 projects (use --include-history to migrate)
```

### `cc2oc plan`
Dry-run showing what would be migrated. Calls `scan()` + `convert()` but not `write()`.

### `cc2oc migrate [options]`
Full migration. Calls `scan()` + `convert()` + `validate()` + `write()`.

```
Options:
  --project <path>        Migrate specific project (default: cwd)
  --global                Migrate global config only
  --only <categories>     Comma-separated category filter
  --skip <categories>     Skip specific categories
  --include-history       Include session history (default: off)
  --since <date>          History cutoff date
  --dry-run               Same as `plan`
  --force                 Overwrite existing OC files
  --backup                Backup existing OC config before writing
  --verbose               Detailed output
```

### `cc2oc validate`
Validates existing OC config against schema. Calls `validate()` on current OC config.

### `cc2oc diff`
Shows differences between CC and OC configs. Calls `scan()` + `diff()`.

---

## Merge Strategy

When writing to an existing OpenCode config:

| Data Type | Default Behavior | With `--force` |
|-----------|-----------------|----------------|
| Scalar (model, theme) | Keep existing OC value | Overwrite with CC value |
| MCP servers | Add new, skip existing | Overwrite all |
| Permissions | Deep merge, more restrictive wins | Replace entirely |
| Agent files | Skip if exists | Overwrite |
| Command files | Skip if exists | Overwrite |
| Instructions array | Append new entries | Replace entirely |

---

## Testing Strategy

### Unit Tests (per converter module)
- Model ID translation table (all known models)
- MCP format conversion (local, SSE, HTTP, no-type, disabled)
- Permission mapping (bypass mode, allow/deny lists, patterns)
- Agent frontmatter conversion (with/without tools, model inherit)
- Command format conversion
- Config merge logic

### Integration Tests
- Full scan -> convert -> validate pipeline with fixture directory
- Merge with pre-existing OC config
- Dry-run produces zero side effects
- Round-trip: convert CC config -> validate against OC schema

### Fixtures
Sanitized copies of real CC configs:
- Minimal (just model)
- Full (all features: MCP, agents, commands, hooks, permissions)
- Multi-project (3+ projects in `~/.claude.json`)
- Edge cases (disabled MCP, regex patterns in permissions, SSE+HTTP mix)

---

## Monorepo Integration

### Turborepo Tasks
Both packages use standard task names -- no changes to `turbo.json` needed:
- `check-types` -- runs `tsgo --noEmit`
- `test` -- runs `bun test`
- `lint` -- runs `biome check .`
- `clean` -- removes build artifacts

### Changesets
Add both packages to the `linked` array in `.changeset/config.json` so they version together with the rest of the monorepo.

### Dependency Graph
```
@codedeck/desktop ──> @codedeck/cc2oc (library)
                  ──> @codedeck/ui

cc2oc (CLI)       ──> @codedeck/cc2oc (library)
```

No circular dependencies. The CLI has no relationship with the desktop app or UI package.

---

## Publishing Strategy

| Package | Published? | Registry | Notes |
|---------|-----------|----------|-------|
| `@codedeck/cc2oc` | No (private) | -- | Consumed only within monorepo via `workspace:*` |
| `cc2oc` | Yes (public) | npm | Standalone CLI, `npx cc2oc migrate` |

For publishing the CLI:
- `cc2oc` `package.json` has `"private": false`
- The `bin` field points to `./src/index.ts` (Bun can run TS directly)
- For Node.js compat: add a build step that bundles to a single JS file via `bun build --target=node`
- Alternatively: ship as Bun-only and document `bunx cc2oc` as the primary install method

---

## Implementation Timeline

### Week 1: Scaffolding + Scanner + Core Converters
- [ ] Create `packages/cc2oc` and `packages/cc2oc-cli` scaffolding
- [ ] Path resolution utilities (XDG, platform-aware)
- [ ] Claude Code scanner (all 28+ file locations)
- [ ] Model ID translation table
- [ ] Global config converter
- [ ] MCP server converter (all 4 rules)

### Week 2: Remaining Converters + Writer
- [ ] Permission mapper
- [ ] Agent definition converter
- [ ] Command file converter
- [ ] Skills verifier
- [ ] Rules file handler (CLAUDE.md -> AGENTS.md)
- [ ] Config writer with merge strategy
- [ ] Schema validator

### Week 3: CLI + Testing
- [ ] CLI commands (scan, plan, migrate, validate, diff)
- [ ] Terminal output formatting
- [ ] Unit tests for all converters
- [ ] Integration tests with fixtures
- [ ] Edge case handling

### Week 4: Codedeck Integration + Polish
- [ ] IPC handlers in `apps/desktop` main process
- [ ] Migration wizard UI in renderer (if desired)
- [ ] Session history converter (opt-in, P2)
- [ ] Hook -> plugin stub generation
- [ ] Documentation
- [ ] npm publish preparation

---

## Dependencies

### `@codedeck/cc2oc` (library -- minimal)
```json
{
  "dependencies": {
    "zod": "^4.0.0",
    "yaml": "^2.0.0",
    "jsonc-parser": "^3.0.0"
  }
}
```

### `cc2oc` (CLI -- adds terminal tooling)
```json
{
  "dependencies": {
    "@codedeck/cc2oc": "workspace:*",
    "citty": "^0.2.0",
    "consola": "^3.0.0"
  }
}
```
