import type { Browser } from "@opencode/plugin-browser/rpc";

/** Browser tools stay owned by the OpenCode server; this bridge only hosts its native tabs. */
export interface PalotBrowserRegistration {
  sessionID: string;
  profileID: string;
  connectionID: string;
}

/** A user-selected element. References are valid only in this live document. */
export interface PalotBrowserSelection {
  tabID: string;
  url: string;
  generation: number;
  element: {
    label: string;
    selector: string;
    ref?: string;
    text?: string;
    role?: string;
    name?: string;
  };
  preview?: string;
}

export interface PalotBrowserComment extends PalotBrowserSelection {
  id: string;
  comment: string;
  /** A draft-only lease, never reusable after a renderer reload. */
  bindingID?: string;
}

export type PalotBrowserEvent =
  | { bindingID: string; type: "hosts"; hosts: PalotBrowserHost[] }
  | {
      bindingID: string;
      type: "state";
      state: Browser.State | null;
      popupTabIDs?: Browser.TabID[];
      error?: string;
    }
  | { bindingID: string; type: "focus"; tabID: Browser.TabID }
  | { bindingID: string; type: "placement"; tabID: Browser.TabID; pane: "right" | "bottom" }
  | {
      bindingID: string;
      type: "inspect";
      tabID: Browser.TabID;
      active: boolean;
      selection?: PalotBrowserSelection;
    }
  | { bindingID: string; type: "preview"; path: string };

/** One-use guest attachment lease. URLs and network credentials remain main-owned. */
export interface PalotBrowserHost {
  tabID: Browser.TabID;
  leaseID: string;
  partition: string;
}

export interface PalotBrowserLayout {
  bindingID: string;
  tabID: Browser.TabID;
  visible: boolean;
  bounds?: { x: number; y: number; width: number; height: number };
  background?: string;
  radius?: number;
}

/** Local UI controls cannot invoke an agent's inspect, script, upload or capture operations. */
export type PalotBrowserUserCommand = Extract<
  Browser.Action,
  {
    type:
      | "tabs.open"
      | "tabs.focus"
      | "tabs.close"
      | "navigate"
      | "back"
      | "forward"
      | "reload"
      | "stop";
  }
>;

/** Local presentation controls, never sent to the agent's browser RPC. */
export type PalotBrowserPageControl =
  | { type: "find"; query: string; forward?: boolean; next?: boolean }
  | { type: "find.stop" }
  | { type: "zoom"; direction: -1 | 0 | 1 }
  | { type: "inspect"; enabled: boolean };
