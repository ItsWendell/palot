import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Questionnaire, QuestionnaireChoice, QuestionnaireChoices, QuestionnaireItem } from "./questionnaire";

afterEach(() => {
  cleanup();
  document.getSelection()?.removeAllRanges();
});

function renderChoices() {
  render(
    <Questionnaire>
      <QuestionnaireItem name="deploy">
        <QuestionnaireChoices>
          <QuestionnaireChoice value="staging">Deploy to staging-eu-west-1</QuestionnaireChoice>
          <QuestionnaireChoice value="production">Deploy to production</QuestionnaireChoice>
        </QuestionnaireChoices>
      </QuestionnaireItem>
    </Questionnaire>,
  );
  return screen.getByRole("radio", { name: "Deploy to staging-eu-west-1" });
}

describe("QuestionnaireChoice", () => {
  it("chooses an option when its text is clicked", () => {
    const radio = renderChoices();
    fireEvent.click(screen.getByText("Deploy to staging-eu-west-1"));
    expect((radio as HTMLInputElement).checked).toBe(true);
  });

  it("lets option text be selected without choosing it", () => {
    const radio = renderChoices();
    const text = screen.getByText("Deploy to staging-eu-west-1");
    document.getSelection()?.selectAllChildren(text);
    fireEvent.click(text);
    expect((radio as HTMLInputElement).checked).toBe(false);
  });
});
