import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PermissionSavedInfo } from "@opencode/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { palot } from "../../services/palot";
import { SavedPermissionRow } from "./saved-permission-row";

const owner = vi.hoisted(() => ({ value: { connectionID: "server-a", version: "2.2.7" } }));
vi.mock("../../hooks/use-settings-owner", () => ({ useSettingsOwner: () => owner.value }));

const permission = {
  id: "per_1",
  projectID: "project-1",
  action: "shell",
  resource: "git status *",
  time: { created: 0, updated: 0 },
} as unknown as PermissionSavedInfo;

function renderRow(onChanged = vi.fn(async () => {})) {
  render(
    <SavedPermissionRow
      permission={permission}
      location={{ directory: "/repo" }}
      onChanged={onChanged}
    />,
  );
  return onChanged;
}

const editButton = () =>
  screen.getByRole("button", { name: "Edit saved approval for git status *" });
const resourceField = () => screen.getByRole("textbox", { name: "Resource" });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  owner.value = { connectionID: "server-a", version: "2.2.7" };
});

describe("SavedPermissionRow", () => {
  it("saves a changed resource with Enter and returns focus to Edit", async () => {
    const user = userEvent.setup();
    const update = vi
      .spyOn(palot, "updateSavedPermission")
      .mockResolvedValue({ status: "updated", permission });
    const onChanged = renderRow();

    await user.click(editButton());
    expect(document.activeElement).toBe(resourceField());
    const save = screen.getByRole("button", { name: "Save" });
    expect(save.hasAttribute("disabled")).toBe(true);

    await user.clear(resourceField());
    expect(save.hasAttribute("disabled")).toBe(true);
    await user.type(resourceField(), "git *");
    expect(screen.getByText(/^Was/).textContent).toBe("Was shell git status * → now shell git *");
    expect(save.hasAttribute("disabled")).toBe(false);

    await user.keyboard("{Enter}");

    await waitFor(() => expect(document.activeElement).toBe(editButton()));
    expect(update).toHaveBeenCalledWith({
      connectionID: "server-a",
      id: "per_1",
      projectID: "project-1",
      directory: "/repo",
      resource: "git *",
    });
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it("cancels with Escape without saving", async () => {
    const user = userEvent.setup();
    const update = vi.spyOn(palot, "updateSavedPermission");
    renderRow();

    await user.click(editButton());
    await user.type(resourceField(), " --short");
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("textbox")).toBeNull();
    expect(document.activeElement).toBe(editButton());
    expect(update).not.toHaveBeenCalled();
  });

  it("cancels with the Cancel button", async () => {
    const user = userEvent.setup();
    renderRow();

    await user.click(editButton());
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("textbox")).toBeNull();
    expect(document.activeElement).toBe(editButton());
  });

  it("keeps the edit open and explains a conflict inline", async () => {
    const user = userEvent.setup();
    vi.spyOn(palot, "updateSavedPermission").mockResolvedValue({ status: "conflict" });
    const onChanged = renderRow();

    await user.click(editButton());
    await user.clear(resourceField());
    await user.type(resourceField(), "git *");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect((await screen.findByRole("alert")).textContent).toBe("A rule for this already exists.");
    expect((resourceField() as HTMLInputElement).value).toBe("git *");
    expect(onChanged).not.toHaveBeenCalled();

    await user.type(resourceField(), "x");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("hides Edit on an OpenCode server older than 2.1.0", () => {
    owner.value = { connectionID: "server-a", version: "2.0.24" };
    renderRow();

    expect(screen.queryByRole("button", { name: /^Edit saved approval/ })).toBeNull();
    screen.getByRole("button", { name: "Remove saved approval for git status *" });
  });
});
