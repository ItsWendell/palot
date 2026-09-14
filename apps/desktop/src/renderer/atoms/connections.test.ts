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
