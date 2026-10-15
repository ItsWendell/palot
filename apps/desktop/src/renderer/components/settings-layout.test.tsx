import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import {
  SettingsDisclosure,
  SettingsFacts,
  SettingsGroup,
  SettingsNotice,
  SettingsRow,
} from "./settings-layout";

afterEach(cleanup);

it("labels a row's control and renders its badge, actions, status and extra content", () => {
  render(
    <SettingsGroup>
      <SettingsRow
        title="Proxy"
        htmlFor="proxy-url"
        badge={<span>Beta</span>}
        description="Route requests through a proxy."
        status="Unreachable"
        tone="destructive"
        density="compact"
        align="start"
        control={<input id="proxy-url" />}
        actions={<button type="button">Reset</button>}
      >
        <p>Extra fields</p>
      </SettingsRow>
    </SettingsGroup>,
  );
  expect(screen.getByLabelText("Proxy").id).toBe("proxy-url");
  expect(screen.getByText("Beta")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Reset" })).toBeTruthy();
  expect(screen.getByText("Unreachable").className).toContain("text-destructive");
  expect(screen.getByText("Extra fields")).toBeTruthy();
});

it("keeps the original row contract", () => {
  render(
    <SettingsRow
      title="Sounds"
      description="Play cues"
      status="On"
      control={<button type="button">Edit</button>}
    />,
  );
  expect(screen.getByRole("heading", { name: "Sounds", level: 3 })).toBeTruthy();
  expect(screen.getByText("On").className).toContain("text-muted-foreground");
});

it("announces a notice with the banner's role", () => {
  render(<SettingsNotice status="warning" title="Restart required" inGroup />);
  expect(screen.getByRole("alert", { name: "Restart required" })).toBeTruthy();
});

it("lists facts as terms and definitions", () => {
  render(
    <SettingsFacts
      facts={[
        { label: "Version", value: "1.2.3", mono: true },
        { label: "Process", value: "4242" },
      ]}
    />,
  );
  const terms = screen.getAllByRole("term").map((term) => term.textContent);
  const definitions = screen.getAllByRole("definition").map((definition) => definition.textContent);
  expect(terms).toEqual(["Version", "Process"]);
  expect(definitions).toEqual(["1.2.3", "4242"]);
});

it("discloses advanced settings on demand", async () => {
  const user = userEvent.setup();
  render(
    <SettingsDisclosure title="Advanced" description="Rarely needed">
      <SettingsRow title="Debug logging" />
    </SettingsDisclosure>,
  );
  const trigger = screen.getByRole("button", { name: /Advanced/ });
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  await user.click(trigger);
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByRole("heading", { name: "Debug logging" })).toBeTruthy();
});
