import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./accordion";

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.reducedMotion;
});

function Example() {
  return (
    <Accordion>
      <AccordionItem value="advanced">
        <AccordionTrigger>Advanced</AccordionTrigger>
        <AccordionContent>Proxy settings</AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

const panel = () => screen.getByText("Proxy settings").closest<HTMLElement>("[data-slot]")!;

it("opens and closes its panel, hiding it once the close finishes", async () => {
  const user = userEvent.setup();
  render(<Example />);
  const trigger = screen.getByRole("button", { name: "Advanced" });
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(panel().hidden).toBe(true);

  await user.click(trigger);
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  expect(panel().hidden).toBe(false);
  expect(panel().getAttribute("data-slot")).toBe("accordion-content");
  expect(trigger.getAttribute("aria-controls")).toBe(panel().id);

  await user.click(trigger);
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  await waitFor(() => expect(panel().hidden).toBe(true));
});

it("closes instantly under reduced motion", async () => {
  document.documentElement.dataset.reducedMotion = "true";
  const user = userEvent.setup();
  render(<Example />);
  const trigger = screen.getByRole("button", { name: "Advanced" });
  await user.click(trigger);
  expect(panel().hidden).toBe(false);
  await user.click(trigger);
  expect(panel().hidden).toBe(true);
});
