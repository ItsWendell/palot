import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectSelect } from "./project-select";

afterEach(cleanup);

describe("ProjectSelect", () => {
  it("searches a long project list and selects the matching project", async () => {
    const onValueChange = vi.fn();
    render(
      <ProjectSelect
        projects={[
          {
            id: "palot",
            canonical: "/repo/palot",
            name: "Palot",
            sandboxes: [],
            vcs: null,
            updatedAt: 1,
          },
          {
            id: "other",
            canonical: "/repo/other",
            name: "Other",
            sandboxes: [],
            vcs: null,
            updatedAt: 1,
          },
        ]}
        value={null}
        onValueChange={onValueChange}
        ariaLabel="Project"
        allLabel="All projects"
      />,
    );

    await userEvent.click(screen.getByRole("combobox", { name: "Project" }));
    await userEvent.type(screen.getByPlaceholderText("Search projects…"), "Other");

    expect(screen.queryByText("Palot")).toBeNull();
    await userEvent.keyboard("{Enter}");
    expect(onValueChange).toHaveBeenCalledWith("other");
  });
});
