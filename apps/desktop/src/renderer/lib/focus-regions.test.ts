import { describe, expect, it } from "vitest";
import { orderFocusRegions, pickFocusRegion, type FocusRegionName } from "./focus-regions";

const all: FocusRegionName[] = ["sidebar", "transcript", "composer", "workbench"];

describe("pickFocusRegion", () => {
  it("moves forward in order and wraps", () => {
    expect(pickFocusRegion(all, "sidebar", "next")).toBe("transcript");
    expect(pickFocusRegion(all, "composer", "next")).toBe("workbench");
    expect(pickFocusRegion(all, "workbench", "next")).toBe("sidebar");
  });

  it("moves backward and wraps", () => {
    expect(pickFocusRegion(all, "transcript", "previous")).toBe("sidebar");
    expect(pickFocusRegion(all, "sidebar", "previous")).toBe("workbench");
  });

  it("starts at either end when focus is outside every region", () => {
    expect(pickFocusRegion(all, null, "next")).toBe("sidebar");
    expect(pickFocusRegion(all, null, "previous")).toBe("workbench");
  });

  it("skips regions that are not available", () => {
    const withoutWorkbench: FocusRegionName[] = ["sidebar", "transcript", "composer"];
    expect(pickFocusRegion(withoutWorkbench, "composer", "next")).toBe("sidebar");
    expect(pickFocusRegion(withoutWorkbench, "sidebar", "previous")).toBe("composer");
    // The current region dropped out (for example it collapsed): start from the end.
    expect(pickFocusRegion(withoutWorkbench, "workbench", "next")).toBe("sidebar");
    expect(pickFocusRegion([], "sidebar", "next")).toBeNull();
  });
});

describe("orderFocusRegions", () => {
  it("orders by region and keeps document order within a region", () => {
    const regions = [
      { name: "workbench", id: "right" },
      { name: "composer", id: "composer" },
      { name: "workbench", id: "bottom" },
      { name: "sidebar", id: "sidebar" },
    ] as const;
    expect(orderFocusRegions(regions, (region) => region.name).map(({ id }) => id)).toEqual([
      "sidebar",
      "composer",
      "right",
      "bottom",
    ]);
  });
});
