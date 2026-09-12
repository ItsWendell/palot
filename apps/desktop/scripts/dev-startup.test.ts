import { describe, expect, it } from "vitest";
import { devWindowStartupEnvironment } from "./dev-startup";

describe("devWindowStartupEnvironment", () => {
  it("starts the development window hidden by default", () => {
    expect(devWindowStartupEnvironment([])).toEqual({
      PALOT_START_HIDDEN: "1",
      PALOT_START_INACTIVE: "0",
    });
  });

  it("allows visible UI testing without taking focus", () => {
    expect(devWindowStartupEnvironment(["--visible"])).toEqual({
      PALOT_START_HIDDEN: "0",
      PALOT_START_INACTIVE: "1",
    });
  });

  it("allows an explicit foreground launch", () => {
    expect(devWindowStartupEnvironment(["--focus"])).toEqual({
      PALOT_START_HIDDEN: "0",
      PALOT_START_INACTIVE: "0",
    });
  });
});
