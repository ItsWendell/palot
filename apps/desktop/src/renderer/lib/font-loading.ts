import {
  CODE_FONT_OPTIONS,
  UI_FONT_OPTIONS,
  type AppearanceFontOption,
  type CodeFontID,
  type UIFontID,
} from "../../shared";

const FONT_PROBE_TEXT = "mmmmmmmmMMWli1O0@# fjord";
const fontLoads = new Map<string, Promise<void>>();
let fontProbeContext: CanvasRenderingContext2D | null | undefined;

function quoteFontFamily(family: string): string {
  return `"${family.replaceAll('"', "")}"`;
}

function probeWidth(fontList: string): number | null {
  if (fontProbeContext === undefined) {
    fontProbeContext = document.createElement("canvas").getContext("2d");
  }
  if (fontProbeContext === null) return null;
  fontProbeContext.font = `16px ${fontList}`;
  return fontProbeContext.measureText(FONT_PROBE_TEXT).width;
}

export function isFontFamilyAvailable(family: string): boolean {
  try {
    const candidate = quoteFontFamily(family);
    for (const generic of ["monospace", "serif", "sans-serif"]) {
      const baselineWidth = probeWidth(generic);
      const candidateWidth = probeWidth(`${candidate}, ${generic}`);
      if (baselineWidth === null || candidateWidth === null) return true;
      if (candidateWidth !== baselineWidth) return true;
    }
    return false;
  } catch {
    return true;
  }
}

export function isAppearanceFontAvailable(option: AppearanceFontOption, platform: string): boolean {
  if (option.availability === "always") return true;
  if (option.availability === "darwin") return platform === "darwin";
  return option.localFamilies.some(isFontFamilyAvailable);
}

async function loadFontOption(option: AppearanceFontOption): Promise<void> {
  if (option.localFamilies.length === 0 || !document.fonts?.load) return;
  const cacheKey = option.localFamilies.join("|");
  const existing = fontLoads.get(cacheKey);
  if (existing) return existing;

  const load = (async () => {
    for (const family of option.localFamilies) {
      const quoted = quoteFontFamily(family);
      const normal = await document.fonts.load(`normal 400 16px ${quoted}`);
      if (normal.length === 0) continue;
      await Promise.all([
        document.fonts.load(`normal 500 16px ${quoted}`),
        document.fonts.load(`normal 600 16px ${quoted}`),
        document.fonts.load(`normal 700 16px ${quoted}`),
        document.fonts.load(`italic 400 16px ${quoted}`),
        document.fonts.load(`italic 700 16px ${quoted}`),
      ]);
      return;
    }
  })().catch(() => {
    fontLoads.delete(cacheKey);
  });
  fontLoads.set(cacheKey, load);
  return load;
}

export async function prepareUIFont(font: UIFontID): Promise<void> {
  await loadFontOption(UI_FONT_OPTIONS[font]);
}

export async function prepareCodeFont(font: CodeFontID): Promise<void> {
  await loadFontOption(CODE_FONT_OPTIONS[font]);
}

export async function prepareAppearanceFonts(
  uiFont: UIFontID,
  codeFont: CodeFontID,
): Promise<void> {
  await Promise.all([prepareUIFont(uiFont), prepareCodeFont(codeFont)]);
}
