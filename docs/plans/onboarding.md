# Palot Onboarding Experience

## Overview

A multi-step, first-run onboarding flow that gates the main app experience until the user has a working environment. The onboarding should feel fast, polished, and respectful of the user's time. Every step earns the right to show the next one by delivering value or removing a blocker.

### Design Principles

1. **Progressive disclosure** -- show only what's relevant right now; don't front-load every feature.
2. **Quick time-to-value** -- the user should reach a working chat within 60 seconds if OpenCode is already installed.
3. **Graceful degradation** -- every step has a "skip" or "do this later" escape hatch. Nothing is mandatory except having a working OpenCode server.
4. **No blank slates** -- every screen shows enough context for the user to understand what's happening and why.
5. **Respect prior work** -- detect existing configs (Claude Code, OpenCode) and offer to build on them rather than starting fresh.
6. **Skippable on return** -- persisted completion state means returning users never see onboarding again (unless they reset it from settings).

---

## Architecture

### Insertion Point

The onboarding gates the main app at the `RootLayout` level. Before `useDiscovery()` fires and attempts to connect to the OpenCode server, the layout checks an `onboardingCompleteAtom` (persisted to localStorage). If incomplete, a full-page overlay renders instead of the sidebar + content area.

```
app.tsx
  -> RootLayout (root route component)
       -> if !onboardingComplete:
            <OnboardingOverlay />           # full-page, z-50, covers everything
       -> else:
            <AppSidebar /> + <Outlet />     # normal app
```

This follows the established pattern from SettingsPage (`fixed inset-0 z-50`).

### State Management

```typescript
// renderer/atoms/onboarding.ts

interface OnboardingState {
  completed: boolean
  completedAt: string | null           // ISO timestamp
  skippedSteps: string[]               // IDs of steps the user skipped
  migrationPerformed: boolean          // whether cc2oc migration was done
  opencodeVersion: string | null       // version detected during onboarding
}

const onboardingStateAtom = atomWithStorage<OnboardingState>(
  "palot:onboarding",
  {
    completed: false,
    completedAt: null,
    skippedSteps: [],
    migrationPerformed: false,
    opencodeVersion: null,
  }
)
```

### IPC Surface (New Handlers)

The onboarding flow needs several new main-process capabilities:

```typescript
// New IPC handlers in main/ipc-handlers.ts

"onboarding:check-opencode"     // -> { installed: boolean, version: string | null, path: string | null }
"onboarding:install-opencode"   // -> runs install script, streams progress
"onboarding:check-compatibility"// -> { compatible: boolean, minVersion: string, maxVersion: string, current: string }
"onboarding:detect-claude-code" // -> { found: boolean, globalSettings: bool, projects: string[], mcpServers: number, agents: number }
"onboarding:run-migration"      // -> runs cc2oc scan + convert + write, returns MigrationReport
"onboarding:dry-run-migration"  // -> runs cc2oc scan + convert (no write), returns preview
"onboarding:restore-backup"     // -> runs cc2oc restore
```

---

## Flow Design

The onboarding is a linear sequence of steps with a persistent progress indicator. Each step is a discrete screen with its own purpose, validation, and transitions.

```
[Welcome] -> [Environment Check] -> [Migration Offer] -> [Migration Preview] -> [Complete]
   1/5            2/5                    3/5                   4/5                  5/5
                   |                      |
                   v                      v
             [Install Helper]       [Skip Migration]
             (conditional)          (goes to Complete)
```

### Step Progress Bar

A minimal horizontal progress bar sits at the top of the onboarding overlay. It shows:
- Step dots (filled = completed, ring = current, empty = upcoming)
- Step count: "Step 2 of 5"
- No labels on the dots (too cluttered; the screen title is enough)

The progress bar uses the existing `Progress` component from `@palot/ui` or a custom dot-based indicator.

---

## Step 1: Welcome

**Purpose**: Orient the user. Explain what Palot is and what's about to happen.

### Layout

Full-page centered content. Palot logo/wordmark at top. Clean, minimal.

### Content

```
[Palot Wordmark]

Your AI-powered desktop companion for OpenCode.

Palot gives you a native desktop experience for managing
OpenCode sessions across all your projects, with real-time
streaming, native notifications, and multi-session support.

Let's get you set up. This takes about a minute.

[Get Started ->]
```

### Behavior

- Single CTA button: "Get Started"
- No skip (this screen IS the skip check -- if they got here, they need onboarding)
- Animate in with a gentle fade + slight upward translate (Framer Motion, 300ms)
- The wordmark uses the existing `<PalotWordmark />` component

### Design Notes

- Keep the copy short. Three lines max for the description.
- Don't list features exhaustively. The user will discover them.
- The tone is confident but not hyperbolic. No "amazing" or "revolutionary."

---

## Step 2: Environment Check

**Purpose**: Verify that OpenCode is installed and compatible. This is the critical gate.

### Layout

Centered card with a checklist-style UI. Each check item has a status indicator (spinner -> checkmark/cross).

### Check Sequence (runs automatically on mount)

```
1. Locating OpenCode CLI...          [spinner -> checkmark/cross]
2. Checking version compatibility... [spinner -> checkmark/cross]  (only if #1 passes)
3. Testing server connectivity...    [spinner -> checkmark/cross]  (only if #2 passes)
```

### Implementation

The checks run sequentially in the main process:

```typescript
// Step 1: Find the binary
// Reuse the PATH augmentation logic from opencode-manager.ts
// Try: ~/.opencode/bin/opencode, then $PATH lookup via `which opencode`
// Return: { found: boolean, path: string, version: string }

// Step 2: Version check
// Run `opencode version` (or `opencode --version`), parse semver
// Compare against a compatibility range defined in the Palot package:
//   apps/desktop/src/main/compatibility.ts
//   export const OPENCODE_COMPAT = { min: "0.1.80", max: "0.3.x" }
// Return: { compatible: boolean, version: string, range: string }

// Step 3: Quick server ping
// Spawn `opencode serve` briefly, hit /session, then kill
// Or just do a lightweight version handshake
// This confirms the binary actually works, not just exists
```

### States & UI

**All checks pass:**
```
[checkmark] OpenCode v0.2.14 found at ~/.opencode/bin/opencode
[checkmark] Version compatible with Palot v1.2.0
[checkmark] Server responding correctly

Everything looks good!

[Continue ->]
```

**OpenCode not found:**
```
[cross] OpenCode CLI not found

Palot needs the OpenCode CLI to function.
You can install it with a single command:

  curl -fsSL https://opencode.ai/install | bash

[Install for me]  [I'll install manually]

Or visit https://opencode.ai for other install methods
(npm, bun, brew, paru).
```

The "Install for me" button runs the curl install script in the main process via a spawned shell, streaming output to a terminal-style log area within the card. After completion, it re-runs the check sequence.

The "I'll install manually" button shows a condensed instruction set and a "Re-check" button the user can click after installing.

**OpenCode found but incompatible version:**
```
[checkmark] OpenCode v0.1.50 found
[warning]   Version not compatible with Palot v1.2.0
            (requires >= 0.1.80)

Your OpenCode version is too old for this version of Palot.
Some features may not work correctly, or the server may
fail to start.

You can update OpenCode:

  curl -fsSL https://opencode.ai/install | bash

[Update for me]  [Continue anyway]  [I'll update manually]
```

"Continue anyway" sets a `skippedSteps` entry and proceeds with a warning badge visible in the status bar throughout the app session.

**Server won't start (binary exists but crashes):**
```
[checkmark] OpenCode v0.2.14 found
[checkmark] Version compatible
[cross]     Server failed to start

The OpenCode server couldn't start. This might be a
configuration issue or port conflict.

Error: <stderr output from spawn>

[Retry]  [Skip and troubleshoot later]

Common fixes:
- Check if port 4101 is already in use
- Try running `opencode serve` in your terminal for more details
```

### Design Notes

- The checklist runs automatically. No user action needed for the happy path.
- Each item animates in as the previous one completes (staggered, ~200ms between).
- Use the `Spinner` component for in-progress, `CheckCircle2` / `XCircle` from lucide-react for results.
- The "Install for me" terminal output area uses a monospace font with a dark background, like a mini terminal embed. Scrollable, max-height ~200px.

---

## Step 3: Claude Code Migration Offer

**Purpose**: Detect existing Claude Code configuration and offer migration via cc2oc.

### Pre-condition

This step only appears if Claude Code artifacts are detected. If nothing is found, skip directly to Step 5 (Complete).

### Detection (runs on mount)

```typescript
import { scan } from "@palot/cc2oc"

// Run in main process via IPC
const scanResult = await scan({ global: true })

// Determine what exists:
// - Global settings (~/.Claude/settings.json)
// - User state (~/.claude.json)
// - MCP servers (across all projects)
// - Agents (.claude/agents/*.md in known projects)
// - Commands (.claude/commands/*.md)
// - Rules (CLAUDE.md)
// - Hooks (settings.json hooks section)
```

### Layout

Centered card with a summary of what was found and what can be migrated.

### Content

```
[Migrate from Claude Code]

We detected an existing Claude Code setup on this machine.
Palot can migrate your configuration to OpenCode format.

Found:
  [checkmark] Global settings & model preferences
  [checkmark] 4 MCP server configurations
  [checkmark] 3 custom agents
  [checkmark] 2 custom commands
  [checkmark] Project rules (CLAUDE.md)
  [  ]        Session history (optional, may be slow)

What gets migrated:
- Model IDs translated (e.g. "sonnet" -> "anthropic/claude-sonnet-4-5")
- MCP servers converted to OpenCode format
- Agent frontmatter adapted (tools -> permissions)
- Rules copied as AGENTS.md
- Hooks converted to TypeScript plugin stubs

A backup is created before any changes. You can undo at any time.

[Preview Changes]  [Skip Migration]
```

### Behavior

- Each found item shows a checkbox (pre-checked). Users can uncheck categories they don't want to migrate.
- "Session history" is unchecked by default with a note: "(may take a while for large histories)"
- "Preview Changes" goes to Step 4 (dry-run preview)
- "Skip Migration" jumps to Step 5 (Complete)
- If scan finds nothing, this entire step is skipped automatically

### Design Notes

- The found items use the `Checkbox` component from `@palot/ui`
- Show count of items per category (e.g., "4 MCP server configurations" not just "MCP servers")
- The "What gets migrated" section is collapsible (expanded by default) using `Accordion`
- Keep the tone factual. Don't oversell the migration. Be clear about what "plugin stubs" means (they need manual finishing).

---

## Step 4: Migration Preview & Execute

**Purpose**: Show the user exactly what will change, then execute with their confirmation.

### Pre-condition

Only reached if user clicked "Preview Changes" in Step 3.

### Layout

Split layout: left side shows a tree of files that will be created/modified, right side shows a diff preview of the selected file.

### Content

```
[Migration Preview]

The following files will be created or modified:

  [tree view]
  ~/.config/opencode/
    opencode.json              [NEW]    +42 lines
  ~/project-a/
    opencode.json              [NEW]    +18 lines
    .opencode/
      agents/
        reviewer.md            [NEW]    +24 lines
        architect.md           [NEW]    +31 lines
      commands/
        deploy.md              [NEW]    +12 lines
  ~/project-b/
    AGENTS.md                  [NEW]    +8 lines

  [diff preview panel]
  Shows the content of the selected file with syntax highlighting

Warnings:
  [warning] Hook "pre-commit-check" converted to plugin stub --
            manual implementation required
  [warning] MCP server "custom-db" uses localhost URL --
            verify it's accessible

A backup will be saved to ~/.config/opencode/backups/

[Apply Migration]  [Back]  [Skip]
```

### Implementation

```typescript
// Run in main process via IPC
import { scan, convert, validate } from "@palot/cc2oc"

const scanResult = await scan({ global: true, project: projectPaths })
const conversion = await convert(scanResult, {
  categories: selectedCategories, // from Step 3 checkboxes
})
const validation = validate(conversion)

// Send to renderer:
// - conversion.report (migrated, skipped, warnings, manualActions, errors)
// - File tree derived from conversion.globalConfig, projectConfigs, agents, commands, rules, hookPlugins
// - File contents for diff preview
```

### Behavior

- "Apply Migration" calls `write(conversion, { backup: true, mergeStrategy: "preserve-existing" })`
- Shows a brief progress indicator during write
- On success: shows a success summary with counts, then auto-advances to Step 5 after 2 seconds (or user clicks "Continue")
- On failure: shows error, offers "Retry" or "Skip"
- "Back" returns to Step 3 (preserves selections)

### Post-Migration Success State

```
[checkmark] Migration complete!

  7 files created
  0 files modified
  1 backup saved

  2 items need manual attention:
    - Hook plugin stub needs implementation
    - Verify MCP server "custom-db" connectivity

You can review and undo the migration from
Settings > Migration at any time.

[Continue to Palot ->]
```

### Design Notes

- The file tree uses indentation + folder/file icons, not a full tree widget. Keep it simple.
- Diff preview uses a monospace font with green/red line highlighting (additions/removals). Since most files are NEW, this is mostly green.
- Warnings use the `Badge` component with `variant="outline"` and a yellow/amber accent.
- The "manual attention" items link to relevant documentation or settings if possible.

---

## Step 5: Complete / Ready

**Purpose**: Celebrate completion and orient the user toward their first action.

### Layout

Centered, minimal. Similar to Step 1 but with a completion feel.

### Content (with migration)

```
[checkmark icon, animated]

You're all set.

Palot is connected to OpenCode v0.2.14 and your
Claude Code configuration has been migrated.

Quick tips:
  Cmd+K      Command palette
  Cmd+N      New session
  Cmd+,      Settings

[Start Building ->]
```

### Content (without migration / fresh install)

```
[checkmark icon, animated]

You're all set.

Palot is connected to OpenCode v0.2.14.

Quick tips:
  Cmd+K      Command palette
  Cmd+N      New session
  Cmd+,      Settings

[Start Building ->]
```

### Behavior

- "Start Building" sets `onboardingComplete: true` in the atom, which unmounts the overlay and reveals the main app
- The main app's `useDiscovery()` hook fires naturally at this point
- Keyboard shortcuts display adapts to platform (Cmd on macOS, Ctrl on Windows/Linux)
- The checkmark icon animates in (scale from 0 -> 1 with spring easing)

---

## Animations & Transitions

All step transitions use Framer Motion (`motion/react`) with `AnimatePresence`:

```typescript
// Shared transition config
const stepTransition = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -12 },
  transition: { duration: 0.25, ease: "easeOut" },
}
```

- Steps slide up slightly as they enter, slide up slightly as they exit (consistent direction)
- Progress dots fill with a brief scale pulse on completion
- Check items in Step 2 stagger in as they complete
- The success checkmark in Step 5 uses a spring animation with slight overshoot

---

## Component Structure

```
renderer/components/onboarding/
  onboarding-overlay.tsx          # Full-page overlay container + step routing
  onboarding-progress.tsx         # Top progress bar / dot indicator
  steps/
    welcome-step.tsx              # Step 1
    environment-check-step.tsx    # Step 2 (includes install helper)
    migration-offer-step.tsx      # Step 3
    migration-preview-step.tsx    # Step 4
    complete-step.tsx             # Step 5
  components/
    install-terminal.tsx          # Mini terminal output for install script
    migration-file-tree.tsx       # File tree for migration preview
    migration-diff-preview.tsx    # Diff viewer for migration preview
    check-item.tsx                # Animated checklist item (spinner -> icon)

renderer/atoms/onboarding.ts     # Onboarding state atom

main/onboarding-handlers.ts      # IPC handlers for onboarding operations
main/compatibility.ts            # OpenCode version compatibility range
```

---

## Edge Cases

### User has OpenCode running already (adopted server)

Step 2 should detect this via the existing `detectExistingServer()` logic in `opencode-manager.ts`. If a server is already running on port 4101, skip the "server start" check and just verify version compatibility by hitting the server's version endpoint.

### User reinstalls Palot (already onboarded)

The `onboardingComplete` flag is in localStorage, which persists across app updates (but not uninstall/reinstall on some platforms). For reinstalls, the user goes through onboarding again, but Steps 2-4 should be fast since OpenCode is already installed and migration may have already been done (cc2oc's `mergeStrategy: "preserve-existing"` handles this gracefully).

### Multiple projects with mixed Claude Code configs

The cc2oc scanner discovers all projects from `~/.Claude/projects/`. Step 3 shows a summary across all projects. Step 4 shows per-project file trees. The user can't selectively exclude individual projects in the onboarding flow (too complex), but they can uncheck entire categories.

### User clicks "Install for me" but install fails

Show the error output in the terminal area. Offer "Retry" and "I'll install manually" as fallbacks. Common failure modes:
- No internet: "Could not reach opencode.ai. Check your internet connection."
- Permission denied: "Installation requires write access to ~/.opencode/. Try running the install command manually with appropriate permissions."
- curl not available: Show alternative install methods (npm, bun, brew).

### Onboarding interrupted (app closed mid-flow)

The step number is NOT persisted. On next launch, onboarding restarts from Step 1. This is intentional: the checks in Step 2 need to re-run anyway, and Steps 1 and 3 are fast to click through. Persisting partial state adds complexity without meaningful UX benefit.

### User wants to re-run onboarding

Add a "Re-run Setup" option in Settings > General. This resets the `onboardingComplete` flag and the next app launch shows onboarding again.

### User wants to undo migration

Add a "Migration" section in Settings that shows:
- Whether migration was performed and when
- A "Restore Backup" button that calls `cc2oc.restore("latest")`
- A "Re-run Migration" button for incremental sync (uses `cc2oc.diff()`)

---

## Compatibility Matrix

Define a compatibility range that Palot checks against:

```typescript
// main/compatibility.ts

export const OPENCODE_COMPAT = {
  // Minimum version required for core functionality
  min: "0.1.80",
  // Maximum tested version (warn but don't block above this)
  recommended: "0.2.x",
  // Hard block (known breaking changes)
  blocked: [] as string[],  // e.g., ["0.3.0-alpha.1"]
}
```

This file is updated with each Palot release. The check logic:

1. Below `min`: **Block** with update prompt
2. Between `min` and `recommended`: **Pass** silently
3. Above `recommended`: **Warn** ("Palot hasn't been tested with this version, some features may not work")
4. In `blocked`: **Block** with specific explanation

---

## Settings Integration

After onboarding, the Settings page gets a new "Setup" or "Environment" section:

```
Setup
  OpenCode CLI
    Version: v0.2.14                    [Check for updates]
    Path: ~/.opencode/bin/opencode
    Status: Compatible

  Claude Code Migration
    Last migrated: 2026-01-15 14:32     [Re-run Migration]
    Backup available: yes               [Restore Backup]

  Onboarding
    Completed: 2026-01-15 14:30         [Re-run Setup]
```

---

## Implementation Phases

### Phase 1: Core Flow (MVP)
- Onboarding overlay + step container
- Step 1 (Welcome)
- Step 2 (Environment check: detect + version check, no auto-install yet)
- Step 5 (Complete)
- Onboarding state atom + localStorage persistence
- Compatibility matrix
- Skip/gate logic in RootLayout

### Phase 2: Install Helper
- "Install for me" with terminal output streaming
- "Update for me" for outdated versions
- Retry logic and error handling
- Platform-specific install paths (curl for macOS/Linux, manual for Windows)

### Phase 3: Claude Code Migration
- cc2oc IPC handlers (scan, convert, validate, write, restore)
- Step 3 (Migration offer with detection + category checkboxes)
- Step 4 (Preview with file tree + diff viewer)
- Backup/restore integration
- Settings page migration section

### Phase 4: Polish
- Framer Motion transitions between steps
- Animated check items
- Spring animation on completion
- Re-run onboarding from settings
- Incremental migration sync (cc2oc diff)
- Telemetry events for onboarding funnel analysis

---

## Open Questions

1. **Windows install**: The curl one-liner doesn't work on Windows. Should we detect platform and show PowerShell / winget / scoop / npm alternatives? Or just show "Install manually" on Windows?

2. **OpenCode version endpoint**: Does `opencode serve` expose a `/version` or similar endpoint? If not, we need to call `opencode version` (or `opencode --version`) as a separate process before starting the server. Need to verify the exact CLI flag.

3. **Onboarding for browser mode**: The `dev:web` browser mode doesn't have access to IPC. Should the onboarding be Electron-only, or should we build a server-side equivalent for the Hono backend?

4. **Migration granularity**: Should we allow per-project opt-in/opt-out in the migration step, or is per-category (config, MCP, agents, etc.) sufficient for onboarding? Per-project could be a Settings-page feature for later.

5. **Telemetry**: Should onboarding steps be tracked for analytics? If so, what's the consent model? (Palot doesn't currently have telemetry.)
