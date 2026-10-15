/** Pages people opened in the task browser, kept per connection profile for New tab suggestions. */
export interface BrowserRecentSite {
  url: string;
  title: string;
  visits: number;
  lastVisitedAt: number;
}

export type BrowserRecentSites = Record<string, BrowserRecentSite[]>;

export const MAX_BROWSER_RECENT_SITES = 50;
const MAX_PROFILES = 20;
const MAX_URL_LENGTH = 2_048;
const MAX_TITLE_LENGTH = 300;

/** Only ordinary web pages are suggested; blank, file, data and internal pages are not. */
export function browserRecentSiteURL(value: string): string | null {
  if (!value || value.length > MAX_URL_LENGTH) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Records one page. `visit` counts a navigation; title-only updates keep the count so a
 * page that retitles itself does not climb the list.
 */
export function recordBrowserRecentSite(
  sites: BrowserRecentSites,
  profileID: string,
  page: { url: string; title: string },
  options: { visit: boolean; now?: number },
): BrowserRecentSites {
  const url = browserRecentSiteURL(page.url);
  if (!url) return sites;
  const now = options.now ?? Date.now();
  const title = page.title.trim().slice(0, MAX_TITLE_LENGTH);
  const current = sites[profileID] ?? [];
  const existing = current.find((site) => site.url === url);
  if (existing && !options.visit && (!title || existing.title === title)) return sites;
  const next: BrowserRecentSite = existing
    ? {
        ...existing,
        title: title || existing.title,
        ...(options.visit ? { visits: existing.visits + 1, lastVisitedAt: now } : {}),
      }
    : { url, title, visits: 1, lastVisitedAt: now };
  const list = [next, ...current.filter((site) => site.url !== url)]
    .toSorted((left, right) => right.lastVisitedAt - left.lastVisitedAt)
    .slice(0, MAX_BROWSER_RECENT_SITES);
  const profiles = Object.entries({ ...sites, [profileID]: list })
    .toSorted(
      ([, left], [, right]) => (right[0]?.lastVisitedAt ?? 0) - (left[0]?.lastVisitedAt ?? 0),
    )
    .slice(0, MAX_PROFILES);
  return Object.fromEntries(profiles);
}

/** Frequent sites first, decaying by age so last month's favourite gives way to today's. */
export function suggestedBrowserSites(
  sites: readonly BrowserRecentSite[] | undefined,
  limit = 8,
  now = Date.now(),
): BrowserRecentSite[] {
  if (!sites?.length) return [];
  const DAY = 86_400_000;
  const score = (site: BrowserRecentSite) =>
    site.visits / (1 + Math.max(0, now - site.lastVisitedAt) / (7 * DAY));
  return sites
    .toSorted(
      (left, right) => score(right) - score(left) || right.lastVisitedAt - left.lastVisitedAt,
    )
    .slice(0, limit);
}

export function browserRecentSiteLabel(site: Pick<BrowserRecentSite, "url" | "title">): string {
  if (site.title) return site.title;
  try {
    return new URL(site.url).host;
  } catch {
    return site.url;
  }
}

export function isBrowserRecentSites(value: unknown): value is BrowserRecentSites {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every(
    (list) =>
      Array.isArray(list) &&
      list.length <= MAX_BROWSER_RECENT_SITES &&
      list.every(
        (site: unknown) =>
          !!site &&
          typeof site === "object" &&
          typeof (site as BrowserRecentSite).url === "string" &&
          browserRecentSiteURL((site as BrowserRecentSite).url) !== null &&
          typeof (site as BrowserRecentSite).title === "string" &&
          Number.isFinite((site as BrowserRecentSite).visits) &&
          Number.isFinite((site as BrowserRecentSite).lastVisitedAt),
      ),
  );
}
