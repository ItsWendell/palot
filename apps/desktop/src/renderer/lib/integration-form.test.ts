import { describe, expect, it } from "vitest";
import type { PalotFormField } from "../../shared";
import {
  defaultFormAnswers,
  formFieldVisible,
  integrationFormValid,
  visibleAnswers,
} from "./integration-form";

const fields: PalotFormField[] = [
  {
    key: "enterprise",
    type: "boolean",
    title: "Enterprise",
    description: null,
    required: false,
    when: [],
    defaultValue: false,
  },
  {
    key: "host",
    type: "string",
    title: "Host",
    description: null,
    required: true,
    when: [{ key: "enterprise", op: "eq", value: true }],
    format: "uri",
    minLength: null,
    maxLength: null,
    pattern: null,
    placeholder: null,
    defaultValue: null,
    options: [],
    custom: false,
  },
  {
    key: "scopes",
    type: "multiselect",
    title: "Scopes",
    description: null,
    required: true,
    when: [],
    options: [{ value: "repo", label: "Repo", description: null }],
    minItems: 1,
    maxItems: 2,
    custom: false,
    defaultValue: ["repo"],
  },
];

describe("integration forms", () => {
  it("applies defaults and omits hidden answers", () => {
    const answers = { ...defaultFormAnswers(fields), host: "https://github.example.com" };

    expect(formFieldVisible(fields[1]!, answers)).toBe(false);
    expect(visibleAnswers(fields, answers)).toEqual({ enterprise: false, scopes: ["repo"] });
  });

  it("validates conditional fields and declared constraints", () => {
    expect(
      integrationFormValid(fields, {
        enterprise: true,
        host: "not a url",
        scopes: ["repo"],
      }),
    ).toBe(false);
    expect(
      integrationFormValid(fields, {
        enterprise: true,
        host: "https://github.example.com",
        scopes: ["repo"],
      }),
    ).toBe(true);
    expect(
      integrationFormValid(fields, {
        enterprise: false,
        scopes: ["unknown"],
      }),
    ).toBe(false);
  });
});
