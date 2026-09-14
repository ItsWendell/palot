import { createStore } from "jotai";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { includedProfileIDsAtom } from "../atoms/connections";
import { renderWithRouter } from "../test-utils/render-with-router";
import { palot } from "../services/palot";
import { ConnectionSettings } from "./connection-settings";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("enables and disables servers without switching the selected task or opening onboarding", async () => {
  vi.spyOn(palot, "listOpenCodeProfiles").mockResolvedValue({
    activeProfileID: "local",
    profiles: [
      { id: "local", kind: "local", name: "Local OpenCode" },
      {
        id: "remote",
        kind: "remote",
        name: "Remote",
        urls: ["https://remote.example"],
        credentialID: null,
        allowPlainHttp: false,
        lastConnectedAt: null,
        lastSuccessfulUrl: null,
      },
    ],
  });
  const switchProfile = vi.spyOn(palot, "switchOpenCodeProfile");
  const store = createStore();
  store.set(includedProfileIDsAtom, ["local"]);
  const { router } = renderWithRouter(<ConnectionSettings tab="profiles" />, store);
  const before = router.state.location.href;
  await userEvent.click(await screen.findByRole("switch", { name: "Enable Remote" }));
  expect(store.get(includedProfileIDsAtom)).toEqual(["local", "remote"]);
  await userEvent.click(screen.getByRole("switch", { name: "Enable Local OpenCode" }));
  expect(store.get(includedProfileIDsAtom)).toEqual(["remote"]);
  expect(switchProfile).not.toHaveBeenCalled();
  expect(router.state.location.href).toBe(before);
  expect(screen.queryByRole("button", { name: "Connect" })).toBeNull();
});
