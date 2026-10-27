import {
  Activity,
  Bell,
  BrainCircuit,
  Cable,
  FileCog,
  Gauge,
  Globe2,
  Keyboard,
  Palette,
  Server,
  ShieldCheck,
  Sparkles,
  Wrench,
  Mic,
} from "lucide-react";
import type { ComponentType } from "react";

export type SettingsCategory =
  | "project"
  | "general"
  | "browser"
  | "connections"
  | "appearance"
  | "notifications"
  | "voice"
  | "shortcuts"
  | "models"
  | "providers"
  | "tools"
  | "agents"
  | "permissions"
  | "config"
  | "diagnostics"
  | "about";

export interface SettingsNavItem {
  id: SettingsCategory;
  label: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  keywords: string;
  group: "Palot" | "OpenCode" | "System";
}

export const SETTINGS_NAV_ITEMS: SettingsNavItem[] = [
  {
    id: "project",
    label: "Project",
    description: "Project details and main checkout",
    icon: FileCog,
    keywords: "project name icon color canonical directory checkout worktree startup command",
    group: "OpenCode",
  },
  {
    id: "general",
    label: "General",
    description: "New tasks and timeline behavior",
    icon: Gauge,
    keywords:
      "default task worktree approval timeline tools compact links icons favicon duckduckgo privacy website",
    group: "Palot",
  },
  {
    id: "browser",
    label: "Browser",
    description: "Browser access, search, links, and address display",
    icon: Globe2,
    keywords:
      "experimental browser sites server localhost private network search engine google duckduckgo bing web links local dev links external full url address downloads history site permissions",
    group: "Palot",
  },
  {
    id: "appearance",
    label: "Appearance",
    description: "Theme and interface density",
    icon: Palette,
    keywords: "theme dark light system colors interface",
    group: "Palot",
  },
  {
    id: "notifications",
    label: "Notifications",
    description: "Native task alerts",
    icon: Bell,
    keywords: "notifications alerts macos completion permission question tray",
    group: "Palot",
  },
  {
    id: "voice",
    label: "Voice",
    description: "Voice chat with your tasks",
    icon: Mic,
    keywords:
      "voice chat talk speak microphone gpt-live realtime openai call shortcut overlay coordinator",
    group: "Palot",
  },
  {
    id: "shortcuts",
    label: "Keyboard shortcuts",
    description: "Every Palot keyboard shortcut",
    icon: Keyboard,
    keywords: "keyboard shortcuts keybindings hotkeys keys accelerators",
    group: "Palot",
  },
  {
    id: "connections",
    label: "Connections",
    description: "OpenCode profiles and web access",
    icon: Server,
    keywords: "server remote local pair connection url web tailscale service",
    group: "OpenCode",
  },
  {
    id: "models",
    label: "Models",
    description: "Default model and which models pickers show",
    icon: Sparkles,
    keywords:
      "model default override variant effort context output price cost visibility hide show picker order agent",
    group: "OpenCode",
  },
  {
    id: "providers",
    label: "Providers",
    description: "Provider connections and credentials",
    icon: Cable,
    keywords:
      "provider connect disconnect api key oauth account environment variable env credential integration source policy",
    group: "OpenCode",
  },
  {
    id: "tools",
    label: "Tools",
    description: "MCP, skills, commands, plugins",
    icon: Wrench,
    keywords: "mcp skill command plugin reference tool server",
    group: "OpenCode",
  },
  {
    id: "agents",
    label: "Agents",
    description: "Available primary and subagents",
    icon: BrainCircuit,
    keywords: "agent build plan explore general subagent permissions",
    group: "OpenCode",
  },
  {
    id: "permissions",
    label: "Permissions",
    description: "Saved project approvals",
    icon: ShieldCheck,
    keywords: "permissions allow always approval shell edit remove",
    group: "OpenCode",
  },
  {
    id: "config",
    label: "Configuration",
    description: "Discovered OpenCode sources",
    icon: FileCog,
    keywords: "config json jsonc source formatter lsp snapshots compaction warming",
    group: "OpenCode",
  },
  {
    id: "diagnostics",
    label: "Diagnostics",
    description: "Live performance and runtime signals",
    icon: Activity,
    keywords: "diagnostics performance cpu memory gpu frames react scan renderer processes",
    group: "System",
  },
  {
    id: "about",
    label: "About",
    description: "Palot and OpenCode service",
    icon: Server,
    keywords: "version pid binary service restart runtime",
    group: "System",
  },
];

/** Settings pages the settings route renders; every navigation entry needs one. */
export const SETTINGS_CATEGORIES = [
  "project",
  "general",
  "browser",
  "appearance",
  "notifications",
  "voice",
  "shortcuts",
  "connections",
  "models",
  "providers",
  "tools",
  "agents",
  "permissions",
  "config",
  "diagnostics",
  "about",
] as const satisfies readonly SettingsCategory[];
