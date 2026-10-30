// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  defaultSpellcheckLanguages,
  matchSpellcheckLanguages,
  resolveSpellcheckLanguages,
} from "./spellcheck-languages";

// A slice of Electron's Linux and Windows list, including aliases such as de and de-DE.
const available = [
  "de",
  "de-DE",
  "en",
  "en-AU",
  "en-GB",
  "en-US",
  "es",
  "es-MX",
  "fr",
  "fr-FR",
  "nl",
  "pt",
  "pt-BR",
  "sr",
];

describe("defaultSpellcheckLanguages", () => {
  // Cases from OpenCode v2.2.3's spellcheck-languages.test.ts, plus POSIX locale forms.
  it.each([
    [["de-DE"], ["de-DE", "en-US"]],
    [
      ["de-DE", "de", "en-US", "en"],
      ["de-DE", "en-US"],
    ],
    [
      ["de-AT", "fr-CA"],
      ["de", "fr", "en-US"],
    ],
    [
      ["en-GB", "de-DE"],
      ["en-GB", "de-DE"],
    ],
    [["en-NZ"], ["en"]],
    [
      ["es-MX", "es-ES"],
      ["es-MX", "en-US"],
    ],
    [["pt-AO"], ["pt", "en-US"]],
    [["DE-de"], ["de-DE", "en-US"]],
    [["ja-JP"], ["en-US"]],
    [[], ["en-US"]],
    [
      ["nl_NL.UTF-8", "C"],
      ["nl", "en-US"],
    ],
    [["sr_RS@latin"], ["sr", "en-US"]],
  ])("system languages %j use dictionaries %j", (preferred, languages) => {
    expect(defaultSpellcheckLanguages(available, preferred)).toEqual(languages);
  });

  it("adds no US English when Chromium has no en-US dictionary", () => {
    expect(defaultSpellcheckLanguages(["nl", "de"], ["nl-NL"])).toEqual(["nl"]);
    expect(defaultSpellcheckLanguages([], ["en-US"])).toEqual([]);
  });
});

describe("resolveSpellcheckLanguages", () => {
  it("keeps a saved choice in Chromium's own spelling, dropping unknown tags", () => {
    expect(resolveSpellcheckLanguages(available, ["FR-fr", "xx", "nl", "nl"], ["de-DE"])).toEqual({
      languages: ["fr-FR", "nl"],
      followsSystem: false,
    });
  });

  it.each([
    ["nothing saved", undefined],
    ["an empty choice", []],
    ["a choice Chromium no longer offers", ["xx-YY"]],
  ])("follows the system with %s", (_case, saved) => {
    expect(resolveSpellcheckLanguages(available, saved, ["de-AT"])).toEqual({
      languages: ["de", "en-US"],
      followsSystem: true,
    });
  });
});

describe("matchSpellcheckLanguages", () => {
  it("keeps request order and Chromium's casing", () => {
    expect(matchSpellcheckLanguages(available, ["pt-br", "EN-us", "pt-BR"])).toEqual([
      "pt-BR",
      "en-US",
    ]);
  });
});
