import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenCodeRuntimeStatus, PalotFormField, PalotIntegration } from "../../shared";
import { palot } from "../services/palot";
import { ProviderConnectionDialog } from "./provider-connection-dialog";

vi.mock("../hooks/use-settings-owner", () => ({ useSettingsOwner: () => null }));

vi.mock("../services/palot", () => ({
  palot: {
    connectIntegrationExternal: vi.fn(),
    connectIntegrationKey: vi.fn(),
    connectIntegrationOAuth: vi.fn(),
    connectIntegrationCommand: vi.fn(),
  },
}));

const owner = { connectionID: "server-a", connected: true } as OpenCodeRuntimeStatus;
const profile: PalotFormField = {
  key: "profile",
  type: "string",
  title: "Credential profile",
  description: null,
  required: true,
  when: [],
  format: null,
  minLength: null,
  maxLength: null,
  pattern: null,
  placeholder: null,
  defaultValue: null,
  options: [],
  custom: false,
};
const integration: PalotIntegration = {
  id: "vault",
  name: "Vault",
  methods: [
    {
      id: "profile",
      type: "external",
      label: "Credential profile",
      form: [
        {
          key: "instructions",
          type: "external",
          title: "Set up your profile",
          description: null,
          url: "https://example.com/setup",
        },
        profile,
        {
          key: "custom",
          type: "boolean",
          title: "Use custom endpoint",
          description: null,
          required: false,
          when: [],
          defaultValue: false,
        },
        {
          ...profile,
          key: "endpoint",
          title: "Endpoint",
          format: "uri",
          when: [{ key: "custom", op: "eq", value: true }],
        },
        { ...profile, key: "source", hidden: true, title: "Source", defaultValue: "vault" },
      ],
    },
  ],
  connections: [],
};

function props(value = integration) {
  return {
    integration: value,
    owner,
    projectID: "project-1",
    location: { directory: "/repo", workspaceID: "workspace-1" },
    onOpenChange: vi.fn(),
    onComplete: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  vi.mocked(palot.connectIntegrationExternal).mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("external provider connection dialog", () => {
  it("renders and validates an external form, submitting defaults and only enabled answers", async () => {
    const user = userEvent.setup();
    const input = props();
    render(<ProviderConnectionDialog {...input} />);
    const submit = screen.getByRole("button", { name: "Add and use" });
    expect(submit.hasAttribute("disabled")).toBe(true);
    const instructions = screen.getByRole("link", { name: "Set up your profile" });
    expect(instructions.getAttribute("href")).toBe("https://example.com/setup");
    const acknowledgment = screen.getByRole("checkbox", {
      name: "I completed this step: Set up your profile",
    });
    expect(acknowledgment.getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByLabelText("API key")).toBeNull();
    expect(screen.queryByLabelText("Source")).toBeNull();
    expect(screen.queryByLabelText("Endpoint")).toBeNull();
    await user.type(screen.getByLabelText("Credential profile"), "work");
    expect(submit.hasAttribute("disabled")).toBe(true);
    instructions.addEventListener("click", (event) => event.preventDefault());
    await user.click(instructions);
    expect(acknowledgment.getAttribute("aria-checked")).toBe("false");
    expect(submit.hasAttribute("disabled")).toBe(true);
    await user.click(acknowledgment);
    expect(submit.hasAttribute("disabled")).toBe(false);
    await user.click(acknowledgment);
    expect(submit.hasAttribute("disabled")).toBe(true);
    await user.click(acknowledgment);
    await user.click(screen.getByRole("checkbox", { name: "Use custom endpoint" }));
    expect(submit.hasAttribute("disabled")).toBe(true);
    await user.type(screen.getByLabelText("Endpoint"), "https://vault.example.com");
    expect(submit.hasAttribute("disabled")).toBe(false);
    await user.type(screen.getByLabelText(/Credential label/), " Work ");
    await user.click(submit);
    expect(palot.connectIntegrationExternal).toHaveBeenCalledExactlyOnceWith({
      connectionID: "server-a",
      projectID: "project-1",
      directory: "/repo",
      workspaceID: "workspace-1",
      integrationID: "vault",
      methodID: "profile",
      label: "Work",
      answer: {
        instructions: true,
        profile: "work",
        source: "vault",
        custom: true,
        endpoint: "https://vault.example.com",
      },
    });
    expect(palot.connectIntegrationKey).not.toHaveBeenCalled();
    expect(palot.connectIntegrationOAuth).not.toHaveBeenCalled();
    expect(palot.connectIntegrationCommand).not.toHaveBeenCalled();
    expect(input.onComplete).toHaveBeenCalledOnce();
    expect(input.onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("requires acknowledgment for instructions that cannot be opened as an HTTP link", async () => {
    const user = userEvent.setup();
    render(
      <ProviderConnectionDialog
        {...props({
          ...integration,
          methods: [
            {
              id: "setup",
              type: "external",
              label: "Local setup",
              form: [
                {
                  key: "instructions",
                  type: "external",
                  title: "Configure your profile",
                  description: null,
                  url: "file:///setup.txt",
                },
              ],
            },
          ],
        })}
      />,
    );
    const submit = screen.getByRole("button", { name: "Add and use" });
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("file:///setup.txt")).toBeTruthy();
    expect(submit.hasAttribute("disabled")).toBe(true);
    await user.click(
      screen.getByRole("checkbox", { name: "I completed this step: Configure your profile" }),
    );
    expect(submit.hasAttribute("disabled")).toBe(false);
    await user.click(submit);
    expect(palot.connectIntegrationExternal).toHaveBeenCalledWith(
      expect.objectContaining({ methodID: "setup", answer: { instructions: true } }),
    );
  });

  it("connects an external method without a form and without requiring an API key", async () => {
    const user = userEvent.setup();
    const input = props({
      ...integration,
      methods: [{ id: "default", type: "external", label: "Default profile", form: [] }],
    });
    render(<ProviderConnectionDialog {...input} />);
    await user.click(screen.getByRole("button", { name: "Add and use" }));
    expect(palot.connectIntegrationExternal).toHaveBeenCalledWith(
      expect.objectContaining({ methodID: "default", answer: {} }),
    );
  });

  it("shows an honest unsupported-method fallback without a credential submit action", () => {
    render(
      <ProviderConnectionDialog
        {...props({
          ...integration,
          methods: [
            {
              id: "device",
              type: "unsupported",
              methodType: "device",
              label: "Device sign-in",
              form: [],
            },
          ],
        })}
      />,
    );
    expect(screen.getByRole("status").textContent).toContain(
      "Palot does not support the Device sign-in connection method (device)",
    );
    expect(screen.queryByRole("button", { name: "Add and use" })).toBeNull();
    expect(screen.queryByLabelText("API key")).toBeNull();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(palot.connectIntegrationCommand).not.toHaveBeenCalled();
  });

  it.each(["owner", "integration"])(
    "does not carry external form answers into another %s",
    async (target) => {
      const user = userEvent.setup();
      const input = props();
      const view = render(<ProviderConnectionDialog {...input} />);
      await user.type(screen.getByLabelText("Credential profile"), "work");
      await user.click(
        screen.getByRole("checkbox", { name: "I completed this step: Set up your profile" }),
      );
      expect(screen.getByRole("button", { name: "Add and use" }).hasAttribute("disabled")).toBe(
        false,
      );
      if (target === "owner")
        view.rerender(
          <ProviderConnectionDialog {...input} owner={{ ...owner, connectionID: "server-b" }} />,
        );
      else
        view.rerender(
          <ProviderConnectionDialog
            {...input}
            integration={{ ...integration, id: "other", name: "Other" }}
          />,
        );
      expect((screen.getByLabelText("Credential profile") as HTMLInputElement).value).toBe("");
      expect(
        screen
          .getByRole("checkbox", { name: "I completed this step: Set up your profile" })
          .getAttribute("aria-checked"),
      ).toBe("false");
      expect(screen.getByRole("button", { name: "Add and use" }).hasAttribute("disabled")).toBe(
        true,
      );
      expect(palot.connectIntegrationExternal).not.toHaveBeenCalled();
    },
  );

  it("prefers a supported method but lets users inspect an unsupported alternative", async () => {
    const user = userEvent.setup();
    render(
      <ProviderConnectionDialog
        {...props({
          ...integration,
          methods: [
            {
              id: "device",
              type: "unsupported",
              methodType: "device",
              label: "Device sign-in",
              form: [],
            },
            ...integration.methods,
          ],
        })}
      />,
    );
    expect(screen.getByLabelText("Credential profile")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Device sign-in/ }));
    expect(screen.getByRole("status").textContent).toContain("Connect it in OpenCode instead.");
    expect(screen.queryByRole("button", { name: "Add and use" })).toBeNull();
  });

  it.each(["cancel", "change owner", "change integration"])(
    "ignores a late external connection after %s",
    async (action) => {
      const user = userEvent.setup();
      const pending = Promise.withResolvers<void>();
      vi.mocked(palot.connectIntegrationExternal).mockReturnValue(pending.promise);
      const input = props({
        ...integration,
        methods: [{ id: "default", type: "external", label: "Default", form: [] }],
      });
      const view = render(<ProviderConnectionDialog {...input} />);
      await user.click(screen.getByRole("button", { name: "Add and use" }));
      expect(palot.connectIntegrationExternal).toHaveBeenCalledOnce();
      if (action === "cancel") await user.click(screen.getByRole("button", { name: "Cancel" }));
      else if (action === "change owner")
        view.rerender(
          <ProviderConnectionDialog {...input} owner={{ ...owner, connectionID: "server-b" }} />,
        );
      else
        view.rerender(
          <ProviderConnectionDialog
            {...input}
            integration={{ ...input.integration, id: "other", name: "Other" }}
          />,
        );
      await act(async () => {
        pending.resolve();
        await pending.promise;
      });
      expect(input.onComplete).not.toHaveBeenCalled();
      expect(input.onOpenChange).toHaveBeenCalledTimes(action === "cancel" ? 1 : 0);
    },
  );
});
