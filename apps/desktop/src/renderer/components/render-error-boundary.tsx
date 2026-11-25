import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from "react";
import { Button } from "./ui/button";

export function RenderErrorRecovery({ error, details }: { error: unknown; details?: string }) {
  const [copyStatus, setCopyStatus] = useState("");
  const message = error instanceof Error ? error.message : String(error);
  const report = [error instanceof Error ? (error.stack ?? message) : message, details]
    .filter(Boolean)
    .join("\n\n");
  return (
    <section
      role="alert"
      className="flex h-full min-h-0 flex-1 flex-col items-center justify-center gap-4 bg-background p-6 text-foreground"
    >
      <h1 className="text-page-title font-semibold">Something went wrong</h1>
      <p className="max-w-xl break-words text-sm text-muted-foreground">{message}</p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button onClick={() => window.location.reload()}>Reload view</Button>
        <Button
          variant="outline"
          onClick={() =>
            void navigator.clipboard.writeText(report).then(
              () => setCopyStatus("Details copied"),
              () => setCopyStatus("Could not copy details"),
            )
          }
        >
          Copy details
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            window.location.hash = "/settings/diagnostics";
            // Also works when the router itself is what failed.
            window.location.reload();
          }}
        >
          Open diagnostics
        </Button>
      </div>
      <p role="status" className="text-meta text-muted-foreground">
        {copyStatus}
      </p>
    </section>
  );
}

interface RenderErrorBoundaryState {
  failed: boolean;
  error: unknown;
  details?: string;
  resetKey?: string;
}

/**
 * Shows a recovery screen when a descendant fails to render. A change of `resetKey` (the route
 * a workspace shows) clears a failure. It does not remount healthy children: the location
 * changes before the router renders the next route, so remounting would rebuild the previous one.
 */
export class RenderErrorBoundary extends Component<
  { children: ReactNode; resetKey?: string },
  RenderErrorBoundaryState
> {
  override state: RenderErrorBoundaryState = {
    failed: false,
    error: null,
    resetKey: this.props.resetKey,
  };
  static getDerivedStateFromProps(
    props: { resetKey?: string },
    state: RenderErrorBoundaryState,
  ): Partial<RenderErrorBoundaryState> | null {
    if (props.resetKey === state.resetKey) return null;
    return state.failed
      ? { failed: false, error: null, details: undefined, resetKey: props.resetKey }
      : { resetKey: props.resetKey };
  }
  static getDerivedStateFromError(error: unknown) {
    return { failed: true, error };
  }
  override componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("[renderer] Render failed", error, info.componentStack);
    this.setState({ details: info.componentStack ?? undefined });
  }
  override render() {
    return this.state.failed ? (
      <RenderErrorRecovery error={this.state.error} details={this.state.details} />
    ) : (
      this.props.children
    );
  }
}

/** Compiled out of normal builds; exercises a real descendant render failure. */
export function E2ERenderFailure() {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!__PALOT_E2E__) return;
    const fail = () => setFailed(true);
    window.addEventListener("palot:e2e-render-error", fail);
    return () => window.removeEventListener("palot:e2e-render-error", fail);
  }, []);
  if (failed) throw new Error("E2E workspace render failure");
  return null;
}
