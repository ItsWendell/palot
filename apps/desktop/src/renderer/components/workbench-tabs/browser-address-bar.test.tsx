import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserAddressBar } from "./browser-address-bar";

afterEach(cleanup);

const defaults = {
  url: "https://example.com:8443/path?q=test#section",
  searchEngine: "duckduckgo" as const,
  showFullURL: false,
  disabled: false,
  onNavigate: vi.fn(),
  onError: vi.fn(),
};

describe("browser address bar", () => {
  it("shows the host at rest and selects the full address when focused", async () => {
    render(<BrowserAddressBar {...defaults} />);
    const address = screen.getByRole<HTMLInputElement>("textbox", { name: "Browser address" });
    expect(address.value).toBe("example.com:8443");
    await userEvent.click(address);
    expect(address.value).toBe(defaults.url);
    expect(address.selectionStart).toBe(0);
    expect(address.selectionEnd).toBe(defaults.url.length);
  });

  it("keeps an edit through page updates and cancels to the current URL", async () => {
    const navigate = vi.fn();
    const { rerender } = render(<BrowserAddressBar {...defaults} onNavigate={navigate} />);
    const address = screen.getByRole<HTMLInputElement>("textbox", { name: "Browser address" });
    await userEvent.click(address);
    fireEvent.change(address, { target: { value: "unfinished search" } });
    rerender(
      <BrowserAddressBar {...defaults} url="https://next.example/path" onNavigate={navigate} />,
    );
    expect(address.value).toBe("unfinished search");
    await userEvent.keyboard("{Escape}");
    expect(address.value).toBe("next.example");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("only navigates on submit and rejects unsafe schemes", async () => {
    const navigate = vi.fn();
    const error = vi.fn();
    render(<BrowserAddressBar {...defaults} onNavigate={navigate} onError={error} />);
    const address = screen.getByRole("textbox", { name: "Browser address" });
    await userEvent.click(address);
    fireEvent.change(address, { target: { value: "test search" } });
    expect(navigate).not.toHaveBeenCalled();
    await userEvent.keyboard("{Enter}");
    expect(navigate).toHaveBeenCalledExactlyOnceWith("https://duckduckgo.com/?q=test+search");
    await userEvent.click(address);
    fireEvent.change(address, { target: { value: "javascript:alert(1)" } });
    await userEvent.keyboard("{Enter}");
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith("Unsupported browser URL scheme");
  });
});
