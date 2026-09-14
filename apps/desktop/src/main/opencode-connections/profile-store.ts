import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import Store from "electron-store";
import type {
  OpenCodeProfile,
  OpenCodeProfileCreateInput,
  OpenCodeProfileSnapshot,
  OpenCodeProfileUpdateInput,
} from "../../shared";
import { normalizeSshConfig } from "../ssh/config";

const LOCAL_DEFAULT: OpenCodeProfile = {
  id: "local-default",
  kind: "local",
  name: "Local OpenCode",
};
const PROFILE_SCHEMA_VERSION = 1;

interface PersistedProfiles {
  schemaVersion: number;
  activeProfileID: string;
  profiles: OpenCodeProfile[];
}

interface ProfileStoreBackend {
  get<TKey extends keyof PersistedProfiles>(key: TKey): PersistedProfiles[TKey];
  set<TKey extends keyof PersistedProfiles>(key: TKey, value: PersistedProfiles[TKey]): void;
}

export class OpenCodeProfileStore {
  private readonly store: ProfileStoreBackend;

  constructor(store?: ProfileStoreBackend) {
    this.store =
      store ??
      new Store<PersistedProfiles>({
        name: "opencode-connections",
        // Runtime stores can be constructed before main applies app.setPath().
        cwd: process.env.PALOT_E2E_USER_DATA ?? process.env.PALOT_RELEASE_SMOKE_USER_DATA,
        defaults: {
          schemaVersion: PROFILE_SCHEMA_VERSION,
          activeProfileID: LOCAL_DEFAULT.id,
          profiles: [LOCAL_DEFAULT],
        },
      });
  }

  snapshot(): OpenCodeProfileSnapshot {
    const storedProfiles = this.store.get("profiles");
    const profiles = normalizeProfiles(storedProfiles);
    const storedActiveProfileID = this.store.get("activeProfileID");
    let activeProfileID =
      typeof storedActiveProfileID === "string" ? storedActiveProfileID : LOCAL_DEFAULT.id;
    if (!profiles.some((profile) => profile.id === activeProfileID))
      activeProfileID = LOCAL_DEFAULT.id;
    const snapshot = { activeProfileID, profiles };
    if (this.store.get("schemaVersion") !== PROFILE_SCHEMA_VERSION)
      this.store.set("schemaVersion", PROFILE_SCHEMA_VERSION);
    if (storedActiveProfileID !== activeProfileID)
      this.store.set("activeProfileID", activeProfileID);
    if (!isDeepStrictEqual(storedProfiles, profiles)) this.store.set("profiles", profiles);
    return structuredClone(snapshot);
  }

  get(profileID: string): OpenCodeProfile {
    const profile = this.snapshot().profiles.find((item) => item.id === profileID);
    if (!profile) throw new Error("OpenCode profile was not found");
    return profile;
  }

  create(input: OpenCodeProfileCreateInput, credentialID: string | null): OpenCodeProfileSnapshot {
    const snapshot = this.snapshot();
    const id = randomUUID();
    const profile = createProfile(id, input, credentialID);
    const profiles = [...snapshot.profiles, profile];
    this.store.set("profiles", profiles);
    return structuredClone({ activeProfileID: snapshot.activeProfileID, profiles });
  }

  update(input: OpenCodeProfileUpdateInput, credentialID?: string | null): OpenCodeProfileSnapshot {
    const snapshot = this.snapshot();
    const current = this.get(input.id);
    if (current.kind !== input.kind) throw new Error("OpenCode profile kind cannot be changed");
    const next = updateProfile(current, input, credentialID);
    const profiles = snapshot.profiles.map((profile) => (profile.id === input.id ? next : profile));
    this.store.set("profiles", profiles);
    return structuredClone({ activeProfileID: snapshot.activeProfileID, profiles });
  }

  delete(profileID: string): OpenCodeProfileSnapshot {
    if (profileID === LOCAL_DEFAULT.id)
      throw new Error("The default local profile cannot be deleted");
    const snapshot = this.snapshot();
    this.store.set(
      "profiles",
      snapshot.profiles.filter((profile) => profile.id !== profileID),
    );
    if (snapshot.activeProfileID === profileID) this.store.set("activeProfileID", LOCAL_DEFAULT.id);
    return this.snapshot();
  }

  activate(profileID: string): OpenCodeProfileSnapshot {
    const snapshot = this.snapshot();
    if (!snapshot.profiles.some((profile) => profile.id === profileID)) {
      throw new Error("OpenCode profile was not found");
    }
    if (snapshot.activeProfileID !== profileID) this.store.set("activeProfileID", profileID);
    return structuredClone({ ...snapshot, activeProfileID: profileID });
  }

  recordConnection(profileID: string, url: string, connectedAt: number): void {
    const profile = this.get(profileID);
    if (profile.kind !== "remote") return;
    if (profile.lastSuccessfulUrl === url && profile.lastConnectedAt === connectedAt) return;
    this.store.set(
      "profiles",
      this.snapshot().profiles.map((item) =>
        item.id === profileID
          ? { ...item, lastSuccessfulUrl: url, lastConnectedAt: connectedAt }
          : item,
      ),
    );
  }
}

function normalizeProfiles(value: unknown): OpenCodeProfile[] {
  const profiles = Array.isArray(value)
    ? value.flatMap((profile) => {
        const normalized = normalizeProfile(profile);
        return normalized ? [normalized] : [];
      })
    : [];
  const withoutDefault = profiles.filter((profile) => profile.id !== LOCAL_DEFAULT.id);
  return [
    LOCAL_DEFAULT,
    ...new Map(withoutDefault.map((profile) => [profile.id, profile])).values(),
  ];
}

function normalizeProfile(value: unknown): OpenCodeProfile | null {
  if (!value || typeof value !== "object") return null;
  const profile = value as Record<string, unknown>;
  if (
    typeof profile.id !== "string" ||
    profile.id.length === 0 ||
    typeof profile.name !== "string" ||
    profile.name.length === 0
  ) {
    return null;
  }
  if (profile.kind === "local") return { id: profile.id, kind: "local", name: profile.name };
  if (profile.kind === "ssh") {
    try {
      return {
        id: profile.id,
        kind: "ssh",
        name: profile.name,
        ssh: normalizeSshConfig(profile.ssh),
      };
    } catch {
      return null;
    }
  }
  if (profile.kind !== "remote" || !Array.isArray(profile.urls)) return null;
  try {
    return {
      id: profile.id,
      kind: "remote",
      name: profile.name,
      urls: normalizeOpenCodeUrls(
        profile.urls.filter((url): url is string => typeof url === "string"),
      ),
      credentialID: typeof profile.credentialID === "string" ? profile.credentialID : null,
      allowPlainHttp: profile.allowPlainHttp === true,
      lastSuccessfulUrl:
        typeof profile.lastSuccessfulUrl === "string" &&
        profile.urls.includes(profile.lastSuccessfulUrl)
          ? normalizeOpenCodeUrl(profile.lastSuccessfulUrl)
          : null,
      lastConnectedAt:
        typeof profile.lastConnectedAt === "number" && Number.isFinite(profile.lastConnectedAt)
          ? profile.lastConnectedAt
          : null,
    };
  } catch {
    return null;
  }
}

function createProfile(
  id: string,
  input: OpenCodeProfileCreateInput,
  credentialID: string | null,
): OpenCodeProfile {
  if (input.kind === "local") return { id, kind: "local", name: input.name };
  if (input.kind === "ssh")
    return { id, kind: "ssh", name: input.name, ssh: normalizeSshConfig(input.ssh) };
  return {
    id,
    kind: "remote",
    name: input.name,
    urls: normalizeOpenCodeUrls(input.urls),
    credentialID,
    allowPlainHttp: input.allowPlainHttp,
    lastSuccessfulUrl: null,
    lastConnectedAt: null,
  };
}

function updateProfile(
  current: OpenCodeProfile,
  input: OpenCodeProfileUpdateInput,
  credentialID: string | null | undefined,
): OpenCodeProfile {
  if (current.kind === "local" && input.kind === "local") return { ...current, name: input.name };
  if (current.kind === "ssh" && input.kind === "ssh") {
    return { id: current.id, kind: "ssh", name: input.name, ssh: normalizeSshConfig(input.ssh) };
  }
  if (current.kind === "remote" && input.kind === "remote") {
    const urls = normalizeOpenCodeUrls(input.urls);
    const originChanged = urls.join("\u0000") !== current.urls.join("\u0000");
    return {
      ...current,
      name: input.name,
      urls,
      credentialID: credentialID === undefined ? current.credentialID : credentialID,
      allowPlainHttp: input.allowPlainHttp,
      lastSuccessfulUrl: originChanged ? null : current.lastSuccessfulUrl,
      lastConnectedAt: originChanged ? null : current.lastConnectedAt,
    };
  }
  throw new Error("OpenCode profile update is invalid");
}

export function normalizeOpenCodeUrls(values: string[]): string[] {
  const urls = [...new Set(values.map(normalizeOpenCodeUrl))];
  if (urls.length === 0) throw new Error("At least one OpenCode server URL is required");
  return urls;
}

export function normalizeOpenCodeUrl(value: string): string {
  const url = new URL(value.trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("OpenCode server URLs must use HTTP or HTTPS");
  }
  if (url.username || url.password)
    throw new Error("OpenCode server URLs cannot contain credentials");
  if (url.pathname !== "/" && url.pathname !== "") {
    throw new Error("OpenCode server URLs cannot contain a path");
  }
  url.hash = "";
  url.search = "";
  return url.href.replace(/\/$/, "");
}

export function isLoopbackOpenCodeUrl(value: string): boolean {
  const hostname = new URL(value).hostname.toLowerCase();
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1"
  );
}
