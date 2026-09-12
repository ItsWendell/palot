import { describe, expect, it } from "vitest";
import type { FormValue } from "@opencode/client";
import type { PalotFormField } from "../../shared";
import { defaultFormAnswers, integrationFormValid, visibleAnswers } from "../lib/integration-form";

const fields: PalotFormField[] = [
  {
    key: "region",
    type: "string",
    title: "Region",
    description: null,
    required: true,
    when: [],
    format: null,
    minLength: null,
    maxLength: null,
    pattern: null,
    placeholder: null,
    defaultValue: "us",
    options: [],
    custom: false,
  },
  {
    key: "endpoint",
    type: "string",
    title: "Endpoint",
    description: null,
    required: true,
    when: [{ key: "region", op: "eq", value: "custom" }],
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
    options: [{ value: "read", label: "Read", description: null }],
    minItems: 1,
    maxItems: null,
    custom: false,
    defaultValue: ["read"],
  },
];

describe("integration forms", () => {
  it("loads declared defaults", () => {
    expect(defaultFormAnswers(fields)).toEqual({ region: "us", scopes: ["read"] });
  });

  it("forwards only answers for visible fields", () => {
    const answers: Record<string, FormValue> = {
      region: "us",
      endpoint: "https://hidden.example.com",
      scopes: ["read"],
    };

    expect(visibleAnswers(fields, answers)).toEqual({ region: "us", scopes: ["read"] });
  });

  it("requires conditional answers only while their field is visible", () => {
    expect(integrationFormValid(fields, { region: "us", scopes: ["read"] })).toBe(true);
    expect(integrationFormValid(fields, { region: "custom", scopes: ["read"] })).toBe(false);
    expect(
      integrationFormValid(fields, {
        region: "custom",
        endpoint: "https://api.example.com",
        scopes: ["read"],
      }),
    ).toBe(true);
  });
});
