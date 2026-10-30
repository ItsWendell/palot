import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { palot } from "../../services/palot";
import { BrowserPermissionPrompt, BrowserSitePermissions } from "./browser-permissions";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const request = {
  id: "req_1",
  tabID: "tab_1" as never,
  origin: "http://localhost:3000",
  kinds: ["microphone" as const, "camera" as const],
};

describe("browser permissions", () => {
  it("names the site and devices, and sends the person's answer", async () => {
    const answer = vi.spyOn(palot, "browserPermission").mockResolvedValue();
    render(<BrowserPermissionPrompt bindingID="bind" request={request} onError={vi.fn()} />);
    expect(screen.getByText("localhost:3000 wants to use your microphone and camera")).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("button", { name: "Allow" }));
    expect(answer).toHaveBeenCalledWith("bind", {
      type: "decide",
      requestID: "req_1",
      decision: "allow",
    });
  });

  it("reports a failed answer", async () => {
    vi.spyOn(palot, "browserPermission").mockRejectedValue(new Error("no longer waiting"));
    const onError = vi.fn();
    render(<BrowserPermissionPrompt bindingID="bind" request={request} onError={onError} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Block" }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith("no longer waiting"));
  });

  it("shows a site's answers and resets them", async () => {
    const answer = vi.spyOn(palot, "browserPermission").mockResolvedValue();
    render(
      <BrowserSitePermissions
        bindingID="bind"
        grant={{ origin: "https://meet.example", microphone: "allow", camera: "block" }}
        onError={vi.fn()}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Site permissions for meet.example" }));
    expect(await screen.findByText("Microphone: Allowed")).toBeTruthy();
    expect(screen.getByText("Camera: Blocked")).toBeTruthy();
    await user.click(screen.getByRole("menuitem", { name: "Reset and reload page" }));
    expect(answer).toHaveBeenCalledWith("bind", { type: "revoke", origin: "https://meet.example" });
  });

  it("shows nothing for a site without answers", () => {
    const { container } = render(
      <BrowserSitePermissions bindingID="bind" grant={undefined} onError={vi.fn()} />,
    );
    expect(container.textContent).toBe("");
  });
});
