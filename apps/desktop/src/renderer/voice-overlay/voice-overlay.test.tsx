import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IDLE_VOICE_CALL_SNAPSHOT, type PalotVoiceOverlayApi } from "../../shared/voice-contract";
import { syncOverlayReducedMotion } from "./overlay-reduced-motion";
import { VoiceOverlay } from "./voice-overlay";

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.reducedMotion;
});

function overlayApi(reduced: boolean) {
  let push: ((reduced: boolean) => void) | null = null;
  const api: PalotVoiceOverlayApi = {
    platform: "linux",
    ready: vi.fn(async () => ({ ...IDLE_VOICE_CALL_SNAPSHOT, phase: "active" as const })),
    command: vi.fn(async () => undefined),
    onState: () => () => undefined,
    onLevels: () => () => undefined,
    reducedMotion: vi.fn(async () => reduced),
    onReducedMotion: (listener) => {
      push = listener;
      return () => {
        push = null;
      };
    },
  };
  return { api, push: (value: boolean) => push?.(value) };
}

describe("voice overlay reduced motion", () => {
  it("sets the root attribute from main's value and follows later changes", async () => {
    const root = document.createElement("div");
    const { api, push } = overlayApi(true);
    const stop = syncOverlayReducedMotion(api, root);
    await waitFor(() => expect(root.dataset.reducedMotion).toBe("true"));
    push(false);
    expect(root.dataset.reducedMotion).toBe("false");
    stop();
    push(true);
    expect(root.dataset.reducedMotion).toBe("false");
  });

  it("stops scaling the orb with audio levels when Palot's signal asks for reduced motion", async () => {
    const { api, push } = overlayApi(false);
    syncOverlayReducedMotion(api);
    render(<VoiceOverlay api={api} />);
    const orb = (await screen.findByRole("img")).parentElement!;
    await waitFor(() => expect(document.documentElement.dataset.reducedMotion).toBe("false"));
    expect(orb.style.transform).toBe("scale(1)");
    act(() => push(true));
    await waitFor(() => expect(orb.style.transform).toBe(""));
  });
});
