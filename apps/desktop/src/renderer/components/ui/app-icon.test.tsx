import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PalotApi } from "../../../shared";
import { AppIcon } from "./app-icon";

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-theme");
});

describe("AppIcon", () => {
  it("keeps the Lucide fallback outside the macOS theme", () => {
    Object.defineProperty(window, "palot", {
      configurable: true,
      value: { platform: "darwin" } as PalotApi,
    });

    const { container } = render(<AppIcon name="search" aria-hidden="true" />);

    expect(container.querySelector('[data-icon="fallback"]')).not.toBeNull();
  });

  it("loads an SF Symbol when the macOS theme is active", async () => {
    const nativeSymbol = vi.fn().mockResolvedValue("data:image/png;base64,c3ltYm9s");
    Object.defineProperty(window, "palot", {
      configurable: true,
      value: { platform: "darwin", nativeSymbol } as unknown as PalotApi,
    });
    document.documentElement.dataset.theme = "macos";

    const { container } = render(<AppIcon name="search" aria-hidden="true" />);

    await waitFor(() => {
      expect(container.querySelector('[data-native-symbol="magnifyingglass"]')).not.toBeNull();
    });
    expect(nativeSymbol).toHaveBeenCalledWith({
      name: "magnifyingglass",
      pointSize: 16,
      weight: "medium",
      scale: "medium",
    });
  });
});
