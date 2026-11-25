import { createStore } from "jotai";
import { beforeEach, expect, it, vi } from "vitest";

beforeEach(() => {
  window.localStorage.clear();
  vi.resetModules();
});

it("bootstraps the current server once, preserves disabling across reload, and enables new servers", async () => {
  let atoms = await import("./connections");
  let store = createStore();
  store.set(atoms.discoverProfilesAtom, { ids: ["local", "remote"], activeProfileID: "local" });
  expect(store.get(atoms.includedProfileIDsAtom)).toEqual(["local"]);
  store.set(atoms.includedProfileIDsAtom, []);
  store.set(atoms.discoverProfilesAtom, { ids: ["local", "remote"], activeProfileID: "local" });
  expect(store.get(atoms.includedProfileIDsAtom)).toEqual([]);
  vi.resetModules();
  atoms = await import("./connections");
  store = createStore();
  store.set(atoms.discoverProfilesAtom, { ids: ["local", "remote"], activeProfileID: "remote" });
  expect(store.get(atoms.includedProfileIDsAtom)).toEqual([]);
  store.set(atoms.discoverProfilesAtom, {
    ids: ["local", "remote", "added"],
    activeProfileID: "local",
  });
  expect(store.get(atoms.includedProfileIDsAtom)).toEqual(["added"]);
  expect(store.get(atoms.disabledProfileIDsAtom)).toEqual(["local", "remote"]);
});

it("enables a disabled profile again only after an explicit start connected it", async () => {
  const atoms = await import("./connections");
  const store = createStore();
  store.set(atoms.discoverProfilesAtom, { ids: ["local", "remote"], activeProfileID: "local" });
  store.set(atoms.includedProfileIDsAtom, ["remote"]);
  expect(store.get(atoms.disabledProfileIDsAtom)).toEqual(["local"]);

  store.set(atoms.includeStartedProfileAtom, { profileID: "local", connected: false });
  expect(store.get(atoms.disabledProfileIDsAtom)).toEqual(["local"]);

  store.set(atoms.includeStartedProfileAtom, { profileID: "local", connected: true });
  expect(store.get(atoms.includedProfileIDsAtom)).toEqual(["remote", "local"]);
  expect(store.get(atoms.disabledProfileIDsAtom)).toEqual([]);

  store.set(atoms.includeStartedProfileAtom, { profileID: "local", connected: true });
  expect(store.get(atoms.includedProfileIDsAtom)).toEqual(["remote", "local"]);
});
