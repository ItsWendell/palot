/**
 * "Switching from another agent?": one prompt that asks an agent to bring someone's setup over
 * from the agent they used before. Palot detects nothing itself; the agent looks, proposes a
 * plan, waits for an OK, backs up what it changes and reports how to undo it.
 *
 * Palot tools named here must exist in `main/palot-tools/tools.ts` (`PALOT_TOOL_APPROVALS`).
 */

export type SwitchingSource =
  | "claude-code"
  | "codex"
  | "t3-code"
  | "pi"
  | "cursor"
  | "opencode-app"
  | "other";

export interface SwitchingSourceInfo {
  id: SwitchingSource;
  name: string;
  /** Where this agent usually keeps its setup. Hints for the agent, not guarantees. */
  hints: readonly string[];
}

export const SWITCHING_SOURCES: readonly SwitchingSourceInfo[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    hints: [
      "`~/.claude/settings.json` (and `settings.local.json`): permissions, hooks, model, env",
      "`~/.claude.json`: MCP servers, per-project settings and recent projects",
      "`~/.claude/CLAUDE.md`, `~/.claude/commands/`, `~/.claude/agents/`, `~/.claude/skills/`, `~/.claude/keybindings.json`",
      "In projects: `CLAUDE.md`, `.claude/` and `.mcp.json`",
    ],
  },
  {
    id: "codex",
    name: "Codex",
    hints: [
      "`~/.codex/config.toml`: model, approval and sandbox settings, profiles, `[mcp_servers]`",
      "`~/.codex/AGENTS.md`, `~/.codex/prompts/`, `~/.codex/skills/`, `~/.codex/rules/`",
      "`~/.codex/sessions/`: past sessions, which show the folders I worked in",
      "In projects: `AGENTS.md` and `.codex/`",
    ],
  },
  {
    id: "t3-code",
    name: "T3 Code",
    hints: [
      "T3 Code runs Codex or Claude Code underneath, so most agent setup lives in `~/.codex/` or `~/.claude/`",
      "`~/.t3/`: T3 Code's own settings, and under `userdata/` the projects and threads it knows",
    ],
  },
  {
    id: "pi",
    name: "Pi",
    hints: [
      "`~/.pi/agent/`: `settings.json`, `models.json`, `AGENTS.md`, `prompts/`, `skills/`, `extensions/`, `sessions/`",
      "`~/.pi/agent/auth.json` holds credentials: don't read values out of it",
      "In projects: `.pi/` and `AGENTS.md`",
    ],
  },
  {
    id: "cursor",
    name: "Cursor",
    hints: [
      "`~/.cursor/mcp.json`, `~/.cursor/commands/`, `~/.cursor/cli-config.json`",
      "Editor settings and keybindings: `~/.config/Cursor/User/` on Linux, `~/Library/Application Support/Cursor/User/` on macOS, `%APPDATA%\\Cursor\\User\\` on Windows",
      "In projects: `.cursor/rules/`, `.cursor/mcp.json`, `.cursorrules`",
    ],
  },
  {
    id: "opencode-app",
    name: "OpenCode app",
    hints: [
      "OpenCode's config (`~/.config/opencode/`) and sessions are already shared with Palot; don't copy them",
      "What may be left: the app's projects list and its own preferences in its app data folder",
    ],
  },
  {
    id: "other",
    name: "Other",
    hints: [
      "Ask me which agent I used if it isn't clear",
      "Common places: `~/.<agent>/`, `~/.config/<agent>/`, and in projects `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`, `.windsurfrules`",
    ],
  },
];

export function switchingSource(id: SwitchingSource): SwitchingSourceInfo {
  return SWITCHING_SOURCES.find((source) => source.id === id) ?? SWITCHING_SOURCES.at(-1)!;
}

/** "another agent" for Other, so titles and sentences read naturally. */
function agentName(id: SwitchingSource): string {
  return id === "other" ? "another agent" : switchingSource(id).name;
}

export function switchingTaskTitle(id: SwitchingSource): string {
  return `Switch from ${agentName(id)}`;
}

export function buildSwitchingPrompt(input: {
  source: SwitchingSource;
  /** The project folder the task runs in; omit for a task without a project. */
  directory?: string;
}): string {
  const source = switchingSource(input.source);
  const name = agentName(source.id);
  const where = input.directory
    ? `This task runs in \`${input.directory}\`. Include that project's own agent files, and put project-level changes in its \`.opencode/\` folder and \`AGENTS.md\`.`
    : "Start with my user-level setup. Project-level changes go in each project's `.opencode/` folder and `AGENTS.md`.";
  return `I'm switching to Palot (a desktop app for OpenCode) from ${name}. Help me bring over my setup. Work through these steps in order.

## 1. Look first, change nothing
Find what I have in ${name}: MCP servers, custom commands or prompts, subagents, skills, instructions files, permission allowlists, model preferences, hooks, recent projects, scheduled or automated tasks, and keybindings if they matter. Only read in this step.

${source.id === "other" ? "Where agents usually keep these" : `Where ${name} usually keeps these`}. They're hints, not guarantees: look and confirm.
${source.hints.map((hint) => `- ${hint}`).join("\n")}

${where}

## 2. Propose a plan and wait
Show me a short list grouped by where each item goes:
- OpenCode config: \`~/.config/opencode/opencode.json\` and the \`~/.config/opencode/\` folder (agents, commands, skills), or a project's \`.opencode/\`
- Instructions: \`AGENTS.md\` (\`~/.config/opencode/AGENTS.md\` for all projects, or the project's own)
- Palot: projects and scheduled tasks

Say what can't be carried over and why. Then stop and wait for my OK before changing anything.

## 3. Make the changes I approved
- Before changing a file, back it up next to it with a timestamp (for example \`opencode.json.20261124-1030.bak\`) and tell me where.
- Never put secrets (tokens, API keys, env values) in the chat or in a file in plain text. Reference an environment variable with OpenCode's \`{env:NAME}\` and tell me which variables to set.
- Projects: Palot can't add projects from a task. List the folders and I'll add them with Add project folder.
- Scheduled work: prefer listing it for me. For a job I confirm, check \`list_automations\` for a duplicate, create it with Palot's \`schedule_task\` tool, then pause it with \`update_automation\` unless I said it should run.
- Past sessions: don't import transcripts. If I ask about a specific one, summarise it into a prompt I can start a new task with.

## 4. Summarise
Finish with what changed (each file and its backup), what you skipped and why, and how to undo it (restore the backups).`;
}
