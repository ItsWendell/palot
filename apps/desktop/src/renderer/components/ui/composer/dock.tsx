import * as React from "react";

import { cn } from "@/lib/cn";

interface ComposerDockContextValue {
  /** The panel slot's id, so tabs can point at it with `aria-controls`. */
  panelId: string;
}

const ComposerDockContext = React.createContext<ComposerDockContextValue | null>(null);

function useComposerDock(): ComposerDockContextValue | null {
  return React.useContext(ComposerDockContext);
}

/**
 * The column that holds everything around the card: the notice line, the tabs on the top
 * edge, the card and the line below it. It owns the composer's width and is the
 * `@container/composer` its parts respond to.
 */
function ComposerDock({ className, children, ...props }: React.ComponentProps<"div">) {
  const panelId = React.useId();
  const context = React.useMemo(() => ({ panelId: `${panelId}-panel` }), [panelId]);
  return (
    <ComposerDockContext.Provider value={context}>
      <div
        data-slot="composer-dock"
        className={cn(
          "@container/composer relative mx-auto flex w-full max-w-[860px] min-w-0 shrink-0 flex-col",
          className,
        )}
        {...props}
      >
        {children}
      </div>
    </ComposerDockContext.Provider>
  );
}

/** Controlled when `value` is defined, otherwise keeps its own state from `defaultValue`. */
function useControllableState<T>(
  value: T | undefined,
  defaultValue: T,
  onChange?: (next: T) => void,
): [T, (next: T) => void] {
  const [own, setOwn] = React.useState(defaultValue);
  const controlled = value !== undefined;
  const current = controlled ? value : own;
  const onChangeRef = React.useRef(onChange);
  React.useEffect(() => {
    onChangeRef.current = onChange;
  });
  const set = React.useCallback(
    (next: T) => {
      if (!controlled) setOwn(next);
      onChangeRef.current?.(next);
    },
    [controlled],
  );
  return [current, set];
}

/** Clicking a control keeps the caret in the text field; keyboard focus still moves. */
function keepEditorFocus(event: React.MouseEvent) {
  if (event.button !== 0) return;
  if ((event.target as Element).closest("button, [role='button']")) event.preventDefault();
}

export { ComposerDock, keepEditorFocus, useComposerDock, useControllableState };
