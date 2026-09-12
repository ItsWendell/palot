import type { FormValue } from "@opencode/client";
import type { PalotFormField } from "../../shared";

export function defaultFormAnswers(fields: PalotFormField[]): Record<string, FormValue> {
  return Object.fromEntries(
    fields.flatMap((field) => {
      if (field.type === "external") return [];
      const value = field.defaultValue;
      return value === null ? [] : [[field.key, value]];
    }),
  );
}

export function formFieldVisible(
  field: PalotFormField,
  answers: Record<string, FormValue>,
): boolean {
  if (field.type === "external") return true;
  return field.when.every((condition) => {
    const matches = answers[condition.key] === condition.value;
    return condition.op === "eq" ? matches : !matches;
  });
}

export function visibleAnswers(
  fields: PalotFormField[],
  answers: Record<string, FormValue>,
): Record<string, FormValue> {
  return Object.fromEntries(
    fields.flatMap((field) => {
      if (field.type === "external" || !formFieldVisible(field, answers)) return [];
      const value = answers[field.key];
      return value === undefined ? [] : [[field.key, value]];
    }),
  );
}

export function integrationFormValid(
  fields: PalotFormField[],
  answers: Record<string, FormValue>,
): boolean {
  return fields.every((field) => {
    if (field.type === "external" || !formFieldVisible(field, answers)) return true;
    const value = answers[field.key];
    if (value === undefined || value === null) return !field.required;
    if (field.type === "string") {
      const text = typeof value === "string" ? value : "";
      if (field.required && !text.trim()) return false;
      if (!text && !field.required) return true;
      if (field.minLength !== null && text.length < field.minLength) return false;
      if (field.maxLength !== null && text.length > field.maxLength) return false;
      if (
        field.options.length > 0 &&
        !field.custom &&
        !field.options.some((item) => item.value === text)
      ) {
        return false;
      }
      if (field.format === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return false;
      if (field.format === "uri") {
        try {
          new URL(text);
        } catch {
          return false;
        }
      }
      if (field.pattern) {
        try {
          if (!new RegExp(field.pattern).test(text)) return false;
        } catch {
          return false;
        }
      }
      return true;
    }
    if (field.type === "number" || field.type === "integer") {
      if (typeof value !== "number" || !Number.isFinite(value)) return false;
      if (field.type === "integer" && !Number.isInteger(value)) return false;
      if (field.minimum !== null && value < field.minimum) return false;
      if (field.maximum !== null && value > field.maximum) return false;
      return true;
    }
    if (field.type === "multiselect") {
      if (!Array.isArray(value)) return false;
      if (field.required && value.length === 0) return false;
      if (field.minItems !== null && value.length < field.minItems) return false;
      if (field.maxItems !== null && value.length > field.maxItems) return false;
      if (
        !field.custom &&
        value.some((item) => !field.options.some((option) => option.value === item))
      ) {
        return false;
      }
      return true;
    }
    return typeof value === "boolean";
  });
}
