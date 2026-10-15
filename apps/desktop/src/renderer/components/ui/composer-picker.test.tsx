import { useState } from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { showErrorToast } from "@/lib/toast-error";
import {
  ComposerPicker,
  type ComposerPickerProps,
  type ComposerPickerSection,
} from "./composer-picker";

vi.mock("@/lib/toast-error", () => ({ showErrorToast: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.mocked(showErrorToast).mockClear();
});

const SECTIONS: ComposerPickerSection<string>[] = [
  {
    key: "favorites",
    heading: "Favorites",
    hideWhenSearching: true,
    options: [{ key: "gpt-5.1", value: "gpt-5.1", label: "GPT-5.1" }],
  },
  {
    key: "openai",
    heading: "OpenAI",
    options: [
      { key: "gpt-5.1", value: "gpt-5.1", label: "GPT-5.1", keywords: ["openai/gpt-5.1"] },
      {
        key: "o3",
        value: "o3",
        label: "o3",
        disabled: true,
        disabledReason: "Needs a newer plan",
      },
    ],
  },
  {
    key: "anthropic",
    heading: "Anthropic",
    collapsible: true,
    options: [{ key: "sonnet", value: "sonnet", label: "Claude Sonnet 4.5" }],
  },
];

function setup(props: Partial<ComposerPickerProps<string>> = {}) {
  const onSelect = vi.fn<(option: { value: string }) => unknown>().mockResolvedValue(undefined);
  const complete = vi.fn();
  function Harness() {
    const [open, setOpen] = useState(false);
    const [selected, setSelected] = useState("gpt-5.1");
    return (
      <>
        <textarea aria-label="Message" />
        <ComposerPicker<string>
          label={selected}
          ariaLabel={`Model: ${selected}`}
          open={open}
          onOpenChange={setOpen}
          title="Model"
          listLabel="Models"
          search={{ label: "Choose model", placeholder: "Search models" }}
          sections={SECTIONS}
          selectedKey={selected}
          errorTitle="Could not switch models"
          onSelect={async (option) => {
            await onSelect(option);
            setSelected(option.value);
          }}
          onSelectionComplete={() => {
            complete();
            screen.getByRole("textbox", { name: "Message" }).focus();
          }}
          {...props}
        />
      </>
    );
  }
  render(<Harness />);
  return { onSelect, complete };
}

const optionNames = () => screen.getAllByRole("option").map((option) => option.textContent);

describe("ComposerPicker", () => {
  it("groups rows under labelled sections and marks the current row", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Model: gpt-5.1" }));
    const list = await screen.findByRole("listbox", { name: "Models" });
    expect(within(list).getByRole("group", { name: "Favorites" })).toBeTruthy();
    expect(within(list).getByRole("group", { name: "OpenAI" })).toBeTruthy();
    expect(optionNames()).toEqual([
      "GPT-5.1",
      "GPT-5.1",
      "o3Needs a newer plan",
      "Claude Sonnet 4.5",
    ]);
    const current = screen
      .getAllByRole("option")
      .filter((option) => option.getAttribute("aria-selected") === "true");
    expect(current).toHaveLength(2);
  });

  it("searches without punctuation or spacing and hides shortcut sections", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Model: gpt-5.1" }));
    await userEvent.type(await screen.findByRole("combobox", { name: "Choose model" }), "gpt51");
    expect(screen.queryByRole("group", { name: "Favorites" })).toBeNull();
    expect(optionNames()).toEqual(["GPT-5.1"]);
    await userEvent.clear(screen.getByRole("combobox", { name: "Choose model" }));
    await userEvent.type(screen.getByRole("combobox", { name: "Choose model" }), "sonnet 4 5");
    expect(optionNames()).toEqual(["Claude Sonnet 4.5"]);
    await userEvent.clear(screen.getByRole("combobox", { name: "Choose model" }));
    await userEvent.type(screen.getByRole("combobox", { name: "Choose model" }), "nothing");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByRole("status").textContent).toBe("No matches");
  });

  it("selects with the keyboard, closes, and hands focus back", async () => {
    const { onSelect, complete } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Model: gpt-5.1" }));
    const search = await screen.findByRole("combobox", { name: "Choose model" });
    await waitFor(() => expect(document.activeElement).toBe(search));
    await userEvent.type(search, "claude");
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(onSelect).toHaveBeenCalledOnce());
    expect(onSelect.mock.calls[0]![0].value).toBe("sonnet");
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    expect(complete).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Model: sonnet" })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Message" }));
  });

  it("explains disabled rows and never selects them", async () => {
    const { onSelect } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Model: gpt-5.1" }));
    const disabled = await screen.findByRole("option", { name: /^o3/ });
    expect(disabled.getAttribute("aria-disabled")).toBe("true");
    expect(disabled.getAttribute("aria-description")).toBe("Needs a newer plan");
    await userEvent.click(disabled);
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole("listbox", { name: "Models" })).toBeTruthy();
  });

  it("shows the pending row, keeps the popup open on failure, and reports one toast", async () => {
    const failure = Promise.withResolvers<void>();
    const { complete } = setup({
      onSelect: () => failure.promise,
    });
    await userEvent.click(screen.getByRole("button", { name: "Model: gpt-5.1" }));
    await userEvent.click(await screen.findByRole("option", { name: "Claude Sonnet 4.5" }));
    await waitFor(() =>
      expect(screen.getByRole("listbox", { name: "Models" }).getAttribute("aria-busy")).toBe(
        "true",
      ),
    );
    expect(
      screen.getAllByRole("option").every((option) => option.getAttribute("aria-disabled")),
    ).toBe(true);
    failure.reject(new Error("Server unavailable"));
    await waitFor(() =>
      expect(showErrorToast).toHaveBeenCalledExactlyOnceWith(
        "Could not switch models",
        expect.objectContaining({ message: "Server unavailable" }),
      ),
    );
    expect(complete).not.toHaveBeenCalled();
    expect(screen.getByRole("listbox", { name: "Models" }).hasAttribute("aria-busy")).toBe(false);
  });

  it("collapses sections from their heading until a query is typed", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Model: gpt-5.1" }));
    await userEvent.click(await screen.findByRole("button", { name: "Anthropic" }));
    expect(screen.queryByRole("option", { name: "Claude Sonnet 4.5" })).toBeNull();
    await userEvent.type(screen.getByRole("combobox", { name: "Choose model" }), "claude");
    expect(screen.getByRole("option", { name: "Claude Sonnet 4.5" })).toBeTruthy();
  });

  it("navigates short lists without a search field and lets callers take over a choice", async () => {
    const confirm = vi.fn((option: { value: string }) => option.value === "o3");
    const { onSelect } = setup({
      search: undefined,
      sections: [
        {
          key: "presets",
          options: [
            { key: "gpt-5.1", value: "gpt-5.1", label: "GPT-5.1" },
            { key: "o3", value: "o3", label: "o3" },
          ],
        },
      ],
      confirm,
    });
    await userEvent.click(screen.getByRole("button", { name: "Model: gpt-5.1" }));
    const target = await screen.findByRole("combobox", { name: "Models" });
    await waitFor(() => expect(document.activeElement).toBe(target));
    await userEvent.keyboard("{ArrowDown}{Enter}");
    await waitFor(() => expect(confirm).toHaveBeenCalledOnce());
    expect(onSelect).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
  });

  it("renders the highlighted row's details and footer actions", async () => {
    const manage = vi.fn();
    setup({
      renderDetail: (option) => <p>Details for {option?.label ?? "nothing"}</p>,
      actions: [{ key: "manage", label: "Manage models…", onSelect: manage }],
    });
    await userEvent.click(screen.getByRole("button", { name: "Model: gpt-5.1" }));
    const details = await screen.findByRole("complementary", { name: "Details" });
    expect(details.textContent).toBe("Details for GPT-5.1");
    await userEvent.type(screen.getByRole("combobox", { name: "Choose model" }), "claude");
    await waitFor(() => expect(details.textContent).toBe("Details for Claude Sonnet 4.5"));
    await userEvent.click(screen.getByRole("button", { name: "Manage models…" }));
    expect(manage).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
  });
});
