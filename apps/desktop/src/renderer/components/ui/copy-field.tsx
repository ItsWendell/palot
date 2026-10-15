// Adapted from Fluid Functionalism (MIT, github.com/mickadesign/fluid-functionalism @
// bf9ece46728035afef54feef6ac67e1f413cc0b0), registry/default/input-copy.tsx.
// Palot changes: `motion/react`, Palot's clipboard bridge and error toast, a conceal
// toggle for secrets, a separate copy button instead of a whole-row button, Palot tokens,
// no font-weight animation. See THIRD_PARTY_NOTICES.md.

import { motion } from "motion/react";
import { useId, useState, type ComponentProps, type ReactNode } from "react";
import { CheckIcon, CopyIcon, EyeIcon, EyeOffIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useClipboardCopy } from "@/hooks/use-clipboard-copy";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/cn";
import { spring } from "@/lib/springs";

export interface CopyFieldProps extends Omit<ComponentProps<"div">, "children" | "onCopy"> {
  /** The full value. It is copied verbatim and shown in the tooltip when truncated. */
  value: string;
  /** Visible label above the field. Also names the copy and reveal buttons. */
  label?: ReactNode;
  /** Plain-text name for the buttons when `label` is not a string (or absent). @default "value" */
  valueName?: string;
  /** Conceal the value until revealed. Copying still copies the real value. */
  secret?: boolean;
  /** Monospace value text, for ids, paths, tokens and commands. @default true */
  monospace?: boolean;
  disabled?: boolean;
  /** Called after a successful copy. */
  onCopy?: () => void;
}

const MASK = "•";

/**
 * A read-only value with a copy button and a copied state. Secrets start concealed with
 * a reveal toggle. Long values truncate and keep the full value in the tooltip.
 */
export function CopyField({
  value,
  label,
  valueName,
  secret = false,
  monospace = true,
  disabled = false,
  onCopy,
  className,
  ...props
}: CopyFieldProps) {
  const { copiedKey, copy } = useClipboardCopy();
  const [revealed, setRevealed] = useState(false);
  const labelId = useId();
  const copied = copiedKey !== null;
  const concealed = secret && !revealed;
  const name = valueName ?? (typeof label === "string" ? label : "value");

  return (
    <div
      data-slot="copy-field"
      data-disabled={disabled ? "" : undefined}
      className={cn("flex min-w-0 flex-col gap-1", disabled && "opacity-50", className)}
      {...props}
    >
      {label ? (
        <span id={labelId} className="text-meta text-muted-foreground">
          {label}
        </span>
      ) : null}
      <div
        role="group"
        aria-labelledby={label ? labelId : undefined}
        aria-label={label ? undefined : name}
        className="flex h-7 min-w-0 items-center gap-0.5 rounded-md border border-input bg-input/20 pr-0.5 pl-2 dark:bg-input/30"
      >
        <span
          data-slot="copy-field-value"
          title={concealed ? undefined : value}
          className={cn(
            "min-w-0 flex-1 truncate text-foreground",
            monospace ? "font-mono text-code-compact" : "text-compact",
            concealed ? "tracking-widest select-none" : "select-all",
          )}
        >
          {concealed ? (
            <>
              <span aria-hidden="true">{MASK.repeat(Math.min(Math.max(value.length, 8), 24))}</span>
              <span className="sr-only">Hidden</span>
            </>
          ) : (
            value
          )}
        </span>
        {secret ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={disabled}
            aria-pressed={revealed}
            aria-label={`Show ${name}`}
            onClick={() => setRevealed((current) => !current)}
            className="text-muted-foreground"
          >
            {revealed ? <EyeOffIcon aria-hidden="true" /> : <EyeIcon aria-hidden="true" />}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={disabled}
          aria-label={`Copy ${name}`}
          onClick={() => {
            void copy(value).then((ok) => {
              if (ok) onCopy?.();
            });
          }}
          className="text-muted-foreground"
        >
          <CopyGlyph copied={copied} />
        </Button>
        <span aria-live="polite" className="sr-only">
          {copied ? "Copied" : ""}
        </span>
      </div>
    </div>
  );
}

/**
 * Copy and check share one cell and crossfade, so the button never resizes. The arriving
 * glyph rides the fast tier, the leaving one its exit; reduced motion swaps in place.
 */
function CopyGlyph({ copied }: { copied: boolean }) {
  const reduceMotion = useReducedMotion();
  const shown = { opacity: 1, scale: 1, filter: "blur(0px)" };
  const hidden = reduceMotion
    ? { opacity: 0, scale: 1, filter: "blur(0px)" }
    : { opacity: 0, scale: 0.6, filter: "blur(4px)" };
  const arrive = reduceMotion
    ? { duration: 0 }
    : { duration: spring.fast.duration, ease: "easeOut" as const };
  const leave = reduceMotion ? { duration: 0 } : { ...spring.fast.exit, ease: "easeIn" as const };
  return (
    <span className="grid place-items-center *:col-start-1 *:row-start-1">
      <motion.span
        data-state={copied ? "hidden" : "shown"}
        initial={false}
        animate={copied ? hidden : shown}
        transition={copied ? leave : arrive}
        className="flex"
      >
        <CopyIcon aria-hidden="true" />
      </motion.span>
      <motion.span
        data-state={copied ? "shown" : "hidden"}
        initial={false}
        animate={copied ? shown : hidden}
        transition={copied ? arrive : leave}
        className="flex text-success"
      >
        <CheckIcon aria-hidden="true" />
      </motion.span>
    </span>
  );
}
