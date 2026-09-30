import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider, createStore } from "jotai";
import { afterEach, expect, it, vi } from "vitest";
import {
  browserLocalLinksAtom,
  browserSearchEngineAtom,
  browserShowFullURLAtom,
  browserWebLinksAtom,
  experimentalBrowserAtom,
} from "../atoms/ui";
import { createRendererQueryClient } from "../lib/query-client";
import { Settings } from "./settings";

vi.mock("../hooks/use-connection-overview", () => ({
  useConnectionOverview: () => ({ connections: [] }),
}));
vi.mock("../hooks/use-navigation", () => ({
  usePalotNavigation: () => ({ closeSettings: vi.fn(), openSettings: vi.fn() }),
}));
vi.mock("../hooks/use-session-catalog", () => ({ useSelectedSession: () => null }));

afterEach(cleanup);

it("shows Browser access and updates its local preferences independently", async () => {
  const store = createStore();
  render(
    <QueryClientProvider client={createRendererQueryClient()}>
      <Provider store={store}>
        <Settings category="browser" />
      </Provider>
    </QueryClientProvider>,
  );

  const user = userEvent.setup();
  expect(screen.getByText(/can access sites reachable from that server/).textContent).toMatch(
    /localhost and private networks. Palot cannot require per-site approval yet/,
  );
  expect(screen.queryByRole("combobox", { name: "Configure server" })).toBeNull();
  expect(screen.getByText("Not available in Palot")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Clear data" }).hasAttribute("disabled")).toBe(true);

  await user.click(screen.getByRole("switch", { name: "Enable experimental browser" }));
  expect(store.get(experimentalBrowserAtom)).toBe(true);

  await user.click(screen.getByRole("combobox", { name: "Search engine" }));
  await user.click(screen.getByRole("option", { name: "DuckDuckGo" }));
  expect(store.get(browserSearchEngineAtom)).toBe("duckduckgo");

  await user.click(screen.getByRole("combobox", { name: "Web links" }));
  await user.click(screen.getByRole("option", { name: "Palot Browser" }));
  expect(store.get(browserWebLinksAtom)).toBe("browser");
  expect(store.get(browserLocalLinksAtom)).toBe("browser");

  await user.click(screen.getByRole("combobox", { name: "Local dev links" }));
  await user.click(screen.getByRole("option", { name: "External browser" }));
  expect(store.get(browserLocalLinksAtom)).toBe("external");
  expect(store.get(browserWebLinksAtom)).toBe("browser");

  await user.click(screen.getByRole("switch", { name: "Show full URL" }));
  expect(store.get(browserShowFullURLAtom)).toBe(true);
});
