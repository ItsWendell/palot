// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  saved: new Map<string, unknown>(),
  preferred: ["de-AT"],
  current: ["en-US"],
}));

vi.mock("electron", () => ({
  app: { getPreferredSystemLanguages: () => mocks.preferred },
  session: {
    defaultSession: {
      availableSpellCheckerLanguages: ["de", "de-DE", "en-GB", "en-US", "fr", "nl"],
      getSpellCheckerLanguages: () => mocks.current,
      setSpellCheckerLanguages: (languages: string[]) => {
        mocks.current = languages;
        mocks.calls.push(`languages:${languages.join(",")}`);
      },
      setSpellCheckerEnabled: (enabled: boolean) => mocks.calls.push(`enabled:${enabled}`),
    },
  },
}));

vi.mock("electron-store", () => ({
  default: class {
    constructor(options: { defaults: Record<string, unknown> }) {
      for (const [key, value] of Object.entries(options.defaults))
        if (!mocks.saved.has(key)) mocks.saved.set(key, value);
    }
    get = (key: string) => mocks.saved.get(key);
    set = (key: string, value: unknown) => mocks.saved.set(key, value);
    delete = (key: string) => mocks.saved.delete(key);
  },
}));

async function load(platform: NodeJS.Platform = "linux") {
  vi.resetModules();
  vi.stubGlobal("process", { ...process, platform });
  return import("./spellcheck");
}

beforeEach(() => {
  mocks.calls = [];
  mocks.saved.clear();
  mocks.current = ["en-US"];
});
afterEach(() => vi.unstubAllGlobals());

describe("spellcheck preferences", () => {
  it("applies the system languages before turning checking on", async () => {
    const spellcheck = await load();
    spellcheck.applySpellcheck();
    expect(mocks.calls).toEqual(["languages:de,en-US", "enabled:true"]);
    expect(spellcheck.spellcheckSettings()).toMatchObject({
      enabled: true,
      chooseLanguages: true,
      languages: ["de", "en-US"],
      followsSystem: true,
    });
  });

  it("clears the dictionaries while checking is off so Chromium fetches none", async () => {
    const spellcheck = await load();
    spellcheck.updateSpellcheck({ enabled: false });
    expect(mocks.calls).toEqual(["languages:", "enabled:false"]);
    spellcheck.updateSpellcheck({ enabled: true });
    expect(mocks.calls.slice(2)).toEqual(["languages:de,en-US", "enabled:true"]);
  });

  it("saves a chosen language list and returns to the system on reset", async () => {
    const spellcheck = await load();
    expect(spellcheck.updateSpellcheck({ languages: ["NL", "xx"] })).toMatchObject({
      languages: ["nl"],
      followsSystem: false,
    });
    expect(mocks.current).toEqual(["nl"]);
    expect(() => spellcheck.updateSpellcheck({ languages: ["xx"] })).toThrow(/at least one/);
    expect(spellcheck.updateSpellcheck({ languages: null })).toMatchObject({
      languages: ["de", "en-US"],
      followsSystem: true,
    });
  });

  it("leaves language choice to macOS", async () => {
    const spellcheck = await load("darwin");
    spellcheck.applySpellcheck();
    expect(mocks.calls).toEqual(["enabled:true"]);
    expect(spellcheck.spellcheckSettings()).toMatchObject({
      chooseLanguages: false,
      languages: [],
    });
    expect(() => spellcheck.updateSpellcheck({ languages: ["nl"] })).toThrow(/macOS/);
  });
});
