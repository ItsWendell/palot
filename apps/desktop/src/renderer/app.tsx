import { RouterProvider } from "@tanstack/react-router";
import { X } from "lucide-react";
import { Button } from "./components/ui/button";
import { palot } from "./services/palot";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  WorkerPoolContextProvider,
  type WorkerInitializationRenderOptions,
  type WorkerPoolOptions,
} from "@pierre/diffs/react";
import { Provider as JotaiProvider } from "jotai";
import { TooltipProvider } from "./components/ui/tooltip";
import { Toaster } from "./components/ui/toast";
import { SurfaceBackdropFilters } from "./components/ui/surface-backdrop";
import { DEFAULT_APPEARANCE_PREFERENCES, effectiveCodeTheme } from "../shared";
import { AppearanceSync, PierreAppearanceSync } from "./components/appearance-sync";
import { useWindowChrome } from "./hooks/use-window-chrome";
import { useDesktopPresentation } from "./hooks/use-desktop-presentation";
import { rendererStore, router } from "./router";
import { rendererQueryClient } from "./lib/query-client";
import { useOpenCodeQueryEvents } from "./hooks/use-opencode-query-events";
import { useSessionActivity } from "./hooks/use-session-activity";

const diffWorkerPoolOptions = {
  poolSize: 2,
  totalASTLRUCacheSize: 50,
  workerFactory: () =>
    new Worker(new URL("@pierre/diffs/worker/worker.js", import.meta.url), { type: "module" }),
} satisfies WorkerPoolOptions;

const diffHighlighterOptions = {
  theme: {
    light: effectiveCodeTheme(DEFAULT_APPEARANCE_PREFERENCES, "light").name,
    dark: effectiveCodeTheme(DEFAULT_APPEARANCE_PREFERENCES, "dark").name,
  },
  lineDiffType: "word",
} satisfies WorkerInitializationRenderOptions;

export function App() {
  useWindowChrome();
  useDesktopPresentation();

  return (
    <QueryClientProvider client={rendererQueryClient}>
      <JotaiProvider store={rendererStore}>
        <WorkerPoolContextProvider
          poolOptions={diffWorkerPoolOptions}
          highlighterOptions={diffHighlighterOptions}
        >
          <TooltipProvider delay={150}>
            <SurfaceBackdropFilters />
            <OpenCodeQueryEvents />
            <AppearanceSync />
            <PierreAppearanceSync />
            <RouterProvider router={router} />
            {window.palot?.platform === "linux" ? (
              <div className="pointer-events-none fixed top-0 right-3 z-40 flex h-(--shell-header-height) items-center">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Close window"
                  title="Close window"
                  className="window-no-drag pointer-events-auto hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => void palot.closeWindow()}
                >
                  <X aria-hidden="true" />
                </Button>
              </div>
            ) : null}
            <Toaster />
          </TooltipProvider>
        </WorkerPoolContextProvider>
      </JotaiProvider>
    </QueryClientProvider>
  );
}

function OpenCodeQueryEvents() {
  useOpenCodeQueryEvents();
  useSessionActivity({ synchronize: true });
  return null;
}
