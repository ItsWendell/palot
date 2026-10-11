import { cn } from "@/lib/cn";
import { formatShortcut, shortcutTokens, type ShortcutKeys } from "@/lib/keyboard-shortcuts";

function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex h-5 w-fit min-w-5 items-center justify-center gap-1 rounded-xs bg-muted px-1 font-sans text-micro font-medium text-muted-foreground select-none in-data-[slot=tooltip-content]:bg-background/20 in-data-[slot=tooltip-content]:text-background dark:in-data-[slot=tooltip-content]:bg-background/10 [&_svg:not([class*='size-'])]:size-3",
        className,
      )}
      {...props}
    />
  );
}

function KbdGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <kbd
      data-slot="kbd-group"
      className={cn("inline-flex items-center gap-1", className)}
      {...props}
    />
  );
}

/** Renders a shortcut as one key cap per key, labelled for the current platform. */
function ShortcutKbd({
  keys,
  platform,
  className,
  keyClassName,
}: {
  keys: ShortcutKeys;
  platform?: string;
  className?: string;
  keyClassName?: string;
}) {
  return (
    <KbdGroup className={className}>
      <span className="sr-only">{formatShortcut(keys, platform)}</span>
      {shortcutTokens(keys, platform).map((token, index) => (
        <Kbd key={`${index}:${token}`} className={keyClassName} aria-hidden="true">
          {token}
        </Kbd>
      ))}
    </KbdGroup>
  );
}

export { Kbd, KbdGroup, ShortcutKbd };
