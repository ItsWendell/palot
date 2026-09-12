import type { ComponentProps } from "react";
import sprite from "./provider-icons/sprite.svg";
import { iconNames, type IconName } from "./provider-icons/types";

const knownIcons = new Set<string>(iconNames);

export function ProviderIcon({ id, ...props }: ComponentProps<"svg"> & { id: string }) {
  const resolved: IconName = knownIcons.has(id) ? (id as IconName) : "synthetic";
  return (
    <svg aria-hidden={props["aria-label"] ? undefined : true} {...props}>
      <use href={`${sprite}#${resolved}`} />
    </svg>
  );
}
