import { describe, expect, it } from "vitest";
import { SETTINGS_CATEGORIES, SETTINGS_NAV_ITEMS } from "../lib/settings-navigation";

describe("Settings categories", () => {
  it("renders every page the settings navigation links to", () => {
    // A navigation entry missing here opens an empty settings page.
    expect([...SETTINGS_CATEGORIES].toSorted()).toEqual(
      SETTINGS_NAV_ITEMS.map((item) => item.id).toSorted(),
    );
  });
});
