import {
  Activity,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Bell,
  BrainCircuit,
  Cable,
  ChevronUp,
  Clock,
  FileCog,
  Folder,
  Info,
  Inbox,
  PanelBottom,
  PanelLeft,
  PanelRight,
  Palette,
  Plus,
  RefreshCw,
  Search,
  Server,
  Settings,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, useSyncExternalStore, type ComponentProps } from "react";
import { cn } from "@/lib/cn";

const APP_ICONS = {
  add: { fallback: Plus, symbol: "plus" },
  agents: { fallback: BrainCircuit, symbol: "brain.head.profile" },
  appearance: { fallback: Palette, symbol: "paintpalette" },
  back: { fallback: ArrowLeft, symbol: "chevron.left" },
  close: { fallback: X, symbol: "xmark" },
  config: { fallback: FileCog, symbol: "doc.badge.gearshape" },
  diagnostics: { fallback: Activity, symbol: "waveform.path.ecg" },
  folder: { fallback: Folder, symbol: "folder" },
  forward: { fallback: ArrowRight, symbol: "chevron.right" },
  inbox: { fallback: Inbox, symbol: "tray" },
  info: { fallback: Info, symbol: "info.circle" },
  models: { fallback: Sparkles, symbol: "sparkles" },
  notifications: { fallback: Bell, symbol: "bell" },
  panelBottom: { fallback: PanelBottom, symbol: "rectangle.bottomhalf.inset.filled" },
  permissions: { fallback: ShieldCheck, symbol: "checkmark.shield" },
  providers: { fallback: Cable, symbol: "cable.connector" },
  refresh: { fallback: RefreshCw, symbol: "arrow.clockwise" },
  scheduled: { fallback: Clock, symbol: "clock" },
  search: { fallback: Search, symbol: "magnifyingglass" },
  servers: { fallback: Server, symbol: "server.rack" },
  settings: { fallback: Settings, symbol: "gearshape" },
  sidebarLeading: { fallback: PanelLeft, symbol: "sidebar.left" },
  sidebarTrailing: { fallback: PanelRight, symbol: "sidebar.right" },
  tools: { fallback: Wrench, symbol: "wrench.and.screwdriver" },
  usage: { fallback: BarChart3, symbol: "chart.bar" },
  warning: { fallback: TriangleAlert, symbol: "exclamationmark.triangle" },
  chevronUp: { fallback: ChevronUp, symbol: "chevron.up" },
} as const satisfies Record<string, { fallback: LucideIcon; symbol: string }>;

export type AppIconName = keyof typeof APP_ICONS;
type AppIconProps = Pick<
  ComponentProps<"span">,
  "className" | "aria-hidden" | "aria-label" | "title"
> & { name: AppIconName };

const symbolCache = new Map<string, Promise<string | null>>();

function nativeSymbol(name: string): Promise<string | null> {
  const cached = symbolCache.get(name);
  if (cached) return cached;
  const request =
    window.palot
      ?.nativeSymbol({ name, pointSize: 16, weight: "medium", scale: "medium" })
      .catch(() => null) ?? Promise.resolve(null);
  symbolCache.set(name, request);
  return request;
}

function subscribeToAppearance(listener: () => void): () => void {
  if (typeof document === "undefined") return () => undefined;
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-platform", "data-theme"],
  });
  return () => observer.disconnect();
}

function usesNativeSymbols(): boolean {
  if (typeof document === "undefined" || typeof window === "undefined") return false;
  return window.palot?.platform === "darwin" && document.documentElement.dataset.theme === "macos";
}

export function AppIcon({ name, className, ...props }: AppIconProps) {
  const native = useSyncExternalStore(subscribeToAppearance, usesNativeSymbols, () => false);
  const definition = APP_ICONS[name];
  const [dataURL, setDataURL] = useState<string | null>(null);

  useEffect(() => {
    if (!native) return;
    let active = true;
    void nativeSymbol(definition.symbol).then((value) => {
      if (active) setDataURL(value);
    });
    return () => {
      active = false;
    };
  }, [definition.symbol, native]);

  if (native && dataURL) {
    return (
      <span
        data-icon="native"
        data-native-symbol={definition.symbol}
        className={cn("inline-block size-4 shrink-0", className)}
        style={{
          WebkitMaskImage: `url(${JSON.stringify(dataURL)})`,
          maskImage: `url(${JSON.stringify(dataURL)})`,
        }}
        {...props}
      />
    );
  }

  const Fallback = definition.fallback;
  return <Fallback data-icon="fallback" className={className} {...props} />;
}
