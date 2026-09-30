import type { Browser } from "@opencode/plugin-browser/rpc";
import { atom, useAtomValue } from "jotai";
import { createElement, useLayoutEffect, useState } from "react";
import type { PalotBrowserHost } from "../../shared/browser-contract";

export interface BrowserViewport {
  bindingID: string;
  tabID: Browser.TabID | undefined;
  visible: boolean;
  bounds?: { x: number; y: number; width: number; height: number };
}

export const browserViewportsAtom = atom<Record<string, BrowserViewport>>({});

function WebviewHost({ host, viewport }: { host: PalotBrowserHost; viewport?: BrowserViewport }) {
  const [bounds, setBounds] = useState({ x: 0, y: 0, width: 1000, height: 700 });
  useLayoutEffect(() => {
    if (viewport?.tabID === host.tabID && viewport.bounds) setBounds(viewport.bounds);
  }, [host.tabID, viewport]);
  const visible = viewport?.visible && viewport.tabID === host.tabID;
  const position = viewport?.tabID === host.tabID && viewport.bounds ? viewport.bounds : bounds;
  return createElement("webview", {
    partition: host.partition,
    src: "about:blank",
    allowpopups: "true",
    "data-browser-visible": visible ? "true" : "false",
    style: {
      position: "fixed",
      left: position.x,
      top: position.y,
      width: position.width,
      height: position.height,
      // Above the responsive workbench drawer (30), below chrome (40) and portals (50).
      zIndex: 31,
      visibility: visible ? "visible" : "hidden",
      pointerEvents: visible ? "auto" : "none",
    },
  });
}

/** Guest DOM ownership is independent of whether the workbench browser tab is mounted. */
export function BrowserWebviewHosts({
  scopeKey,
  bindingID,
  hosts,
}: {
  scopeKey: string;
  bindingID: string;
  hosts: PalotBrowserHost[];
}) {
  const viewport = useAtomValue(browserViewportsAtom)[scopeKey];
  return (
    <>
      {hosts.map((host) => (
        <WebviewHost
          key={host.leaseID}
          host={host}
          viewport={viewport?.bindingID === bindingID ? viewport : undefined}
        />
      ))}
    </>
  );
}
