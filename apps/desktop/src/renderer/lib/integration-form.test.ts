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
  it("requires explicit external acknowledgments and retains them in submitted answers", () => {
    const profile = fields.find((field) => field.type === "string")!;
    const source = fields.find((field) => field.type === "boolean")!;
    const form: PalotFormField[] = [
      {
        key: "instructions",
        type: "external",
        title: "Set up a profile",
        description: null,
        url: "https://example.com/setup",
      },
      { ...profile, key: "profile", when: [], format: null },
      { ...source, key: "source", hidden: true, defaultValue: true },
    ];
    const defaults = defaultFormAnswers(form);
    expect(defaults).toEqual({ source: true });
    expect(integrationFormValid(form, defaults)).toBe(false);
    const answers = {
      ...defaults,
      profile: "work",
      unknown: "ignored",
    };
    for (const instructions of [undefined, false, "true", 1]) {
      const unacknowledged = instructions === undefined ? answers : { ...answers, instructions };
      expect(integrationFormValid(form, unacknowledged)).toBe(false);
      expect(visibleAnswers(form, unacknowledged)).toEqual({ source: true, profile: "work" });
    }
    expect(integrationFormValid(form, { ...defaults, instructions: true })).toBe(false);
    expect(integrationFormValid(form, { ...answers, instructions: true })).toBe(true);
    expect(visibleAnswers(form, { ...answers, instructions: true })).toEqual({
      source: true,
      profile: "work",
      instructions: true,
    });
    expect(visibleAnswers(form, answers)).toEqual({ source: true, profile: "work" });
  });

  it("requires each external step even when the form has no input fields", () => {
    const form: PalotFormField[] = [
      {
        key: "setup",
        type: "external",
        url: "https://example.com/setup",
        title: null,
        description: null,
      },
      {
        key: "verify",
        type: "external",
        url: "https://example.com/verify",
        title: null,
        description: null,
      },
    ];
    expect(defaultFormAnswers(form)).toEqual({});
    expect(integrationFormValid(form, {})).toBe(false);
    expect(integrationFormValid(form, { setup: true })).toBe(false);
    expect(integrationFormValid(form, { setup: true, verify: true })).toBe(true);
    expect(integrationFormValid(form, { setup: false, verify: true })).toBe(false);
    expect(visibleAnswers(form, { setup: true, verify: true })).toEqual({
      setup: true,
      verify: true,
    });
  });

  it("hides authentication fields while retaining defaults and supplied values", () => {
    const field = fields.find((item) => item.type === "boolean")!;
    const hidden: PalotFormField[] = [{ ...field, hidden: true, required: true }];
    const defaults = defaultFormAnswers(hidden);
    expect(formFieldVisible(hidden[0]!, defaults)).toBe(false);
    expect(integrationFormValid(hidden, {})).toBe(true);
    expect(visibleAnswers(hidden, defaults)).toEqual({ enterprise: false });
    expect(visibleAnswers(hidden, { enterprise: true })).toEqual({ enterprise: true });
  });

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
