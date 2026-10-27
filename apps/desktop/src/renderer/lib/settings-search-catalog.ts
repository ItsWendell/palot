import type { SettingsCategory } from "./settings-navigation";

export interface SettingsSearchEntry {
  route:
    | `/settings/${SettingsCategory}`
    | "/settings/connections/local-service"
    | "/settings/connections/web-access";
  title: string;
  keywords: readonly string[];
}

function page(
  route: SettingsSearchEntry["route"],
  rows: readonly (readonly [title: string, keywords: string])[],
): SettingsSearchEntry[] {
  return rows.map(([title, keywords]) => ({ route, title, keywords: [keywords] }));
}

// Hand-maintained alongside the settings rows. These navigate to pages, not individual rows.
export const SETTINGS_SEARCH_CATALOG: readonly SettingsSearchEntry[] = [
  ...page("/settings/general", [
    ["Default workspace", "new task checkout worktree"],
    ["Approvals for new tasks", "full access permissions ask approve defaults"],
    ["New worktree starting point", "repository default current branch"],
    ["Messages while running", "steer queue delivery"],
    ["Automatically send blocking work to background", "steering foreground"],
    ["Context meter", "tokens window composer"],
    ["Suggest compacting before sending", "compaction summarize prompt cache"],
    ["Default shell", "terminal command login"],
    ["Default sidebar", "inbox projects navigation"],
    ["Auto-settle idle tasks", "auto settle automatic inactivity inbox settled"],
    ["Settle idle chats after", "chat auto settle automatic inactivity inbox settled no project"],
    ["Launch at login", "startup schedules autostart"],
    ["Prevent sleep during runs", "awake scheduled automation"],
    ["Palot tools for agents", "schedule follow-ups triage pin snooze archive"],
    ["Ask before agents schedule tasks", "approval permission automation without asking"],
    ["Website icons in links", "favicon duckduckgo privacy"],
    ["Likely cache busts", "prompt cache warning timeline"],
    ["Timeline activity", "tools focused balanced detailed projection"],
    ["Reasoning summaries", "thinking timeline"],
    ["Current activity", "expanded tool group"],
  ]),
  ...page("/settings/browser", [
    ["Enable browser", "experimental plugin localhost private network"],
    ["Search engine", "google duckduckgo bing address bar"],
    ["Web links", "external browser public website"],
    ["Local dev links", "localhost development browser"],
    ["Show full URL", "address bar"],
    ["Clear task browser data", "cache cookies downloads history site permissions"],
  ]),
  ...page("/settings/appearance", [
    ["Theme", "colors dark light system"],
    ["Contrast", "accessibility"],
    ["Code theme", "syntax highlighting diff"],
    ["Color mode", "dark light system"],
    ["Always show scrollbars", "scrolling"],
    ["Window background opacity", "transparency glass"],
    ["Surface tint", "translucency glass"],
    ["Main content opacity", "transparency"],
    ["Native glass tint", "liquid glass"],
    ["Native glass variant", "liquid glass"],
    ["Window material", "glass vibrancy"],
    ["Sidebar material", "glass vibrancy"],
    ["Interface font", "typography text size"],
    ["Follow desktop monospace font", "system terminal typography"],
    ["Monospace font", "code typography"],
    ["Terminal font size", "typography"],
  ]),
  ...page("/settings/notifications", [
    ["Delivery check", "native alerts permission"],
    ["Turn completion notifications", "finished task alerts"],
    ["Permission notifications", "approval alerts"],
    ["Question notifications", "input alerts"],
    ["Sounds", "notification audio volume preview"],
  ]),
  ...page("/settings/voice", [
    ["Voice", "voice chat talk speak realtime"],
    ["Microphone", "voice audio input device"],
    ["Greeting", "voice call introduction"],
    ["Floating controls", "voice overlay"],
    ["System-wide shortcut", "voice hotkey keyboard"],
    ["Plugin location", "voice coordinator"],
  ]),
  ...page("/settings/connections", [["Servers", "profiles remote local connection"]]),
  ...page("/settings/connections/local-service", [
    ["Shared OpenCode service", "server binary runtime restart"],
    ["OpenCode release", "stable beta update version"],
  ]),
  ...page("/settings/connections/web-access", [
    ["This computer", "web access network address localhost"],
    ["Tailscale", "proxy reverse proxy network web access"],
  ]),
  ...page("/settings/models", [
    ["OpenCode default", "default model server"],
    ["Palot override for this project", "default model"],
    ["Default effort", "reasoning variant model"],
    ["Agent models", "primary subagent model"],
    ["Models in pickers", "visibility hidden shown order"],
  ]),
  ...page("/settings/providers", [
    ["Connected providers", "api key oauth account credentials disconnect"],
    ["Add a provider", "connect authentication"],
    ["Custom integration catalog", "advanced provider sources"],
  ]),
  ...page("/settings/tools", [
    ["Plugins", "server tui rpc desktop gui updates"],
    ["MCP servers", "tools authentication"],
    ["MCP resources", "context catalog"],
    ["Skills", "agent instructions"],
    ["Commands", "slash command"],
    ["References", "directories repository"],
    ["Web search providers", "search engine"],
  ]),
  ...page("/settings/permissions", [
    ["Saved approvals", "always allow permissions remove"],
    ["Permission rules", "configured policy ask deny allow"],
  ]),
  ...page("/settings/config", [
    ["Reload configuration", "refresh config json jsonc"],
    ["Configuration sources", "files discovery"],
    ["Formatters", "format on edit"],
    ["Language servers", "lsp diagnostics"],
    ["Feature status", "experimental snapshots compaction warming"],
  ]),
  ...page("/settings/diagnostics", [
    ["Diagnostic overlay", "performance cpu memory fps frames"],
    ["React Scan", "renders performance instrumentation"],
    ["Heap snapshots", "memory debugging recovery"],
  ]),
];
