import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible";

import { cn } from "@/lib/cn";

function Collapsible({ ...props }: CollapsiblePrimitive.Root.Props) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />;
}

function CollapsibleTrigger({ ...props }: CollapsiblePrimitive.Trigger.Props) {
  return <CollapsiblePrimitive.Trigger data-slot="collapsible-trigger" {...props} />;
}

type CollapsibleContentProps = Omit<CollapsiblePrimitive.Panel.Props, "className"> & {
  className?: string;
  smooth?: boolean;
  animate?: boolean;
};

function CollapsibleContent({
  className,
  smooth = false,
  animate = true,
  children,
  ...props
}: CollapsibleContentProps) {
  return (
    <CollapsiblePrimitive.Panel
      data-slot="collapsible-content"
      className={cn(
        smooth && "box-border min-w-0 overflow-hidden data-open:overflow-visible",
        smooth &&
          animate &&
          "h-(--collapsible-panel-height) transition-[height,opacity] duration-200 ease-[cubic-bezier(0.2,0.8,0.2,1)] data-ending-style:h-0 data-ending-style:overflow-hidden data-ending-style:opacity-0 data-starting-style:h-0 data-starting-style:overflow-hidden data-starting-style:opacity-0 motion-reduce:transition-none",
        !smooth && className,
      )}
      {...props}
    >
      {smooth ? (
        <div data-slot="collapsible-content-inner" className={className}>
          {children}
        </div>
      ) : (
        children
      )}
    </CollapsiblePrimitive.Panel>
  );
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent };
