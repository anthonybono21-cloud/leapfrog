// ─── Browser Fingerprint Generation ────────────────────────────────────────
//
// Generates internally-coherent browser fingerprint profiles for stealth
// automation. Platform matches userAgent, deviceMemory correlates with
// screen tier, GPU and timezone are weighted by real-world distribution.
// Ported from the validated humanize.js prototype.
//
// Integration point: import { generateFingerprint } from "./humanize-fingerprint.js"
// then pass the returned profile to session_create options or use with
// stealth.getContextOptions() in src/session-manager.ts.
//
// Standalone module — no cross-dependencies on other humanize modules.

// ─── Types ─────────────────────────────────────────────────────────────────

export interface Fingerprint {
  userAgent: string;
  platform: string;
  viewport: { width: number; height: number };
  screen: { width: number; height: number };
  devicePixelRatio: number;
  deviceMemory: number;
  hardwareConcurrency: number;
  timezone: string;
  languages: string[];
  webgl: { vendor: string; renderer: string };
  colorDepth: number;
  maxTouchPoints: number;
  doNotTrack: string | null;
  cookieEnabled: boolean;
  pdfViewerEnabled: boolean;
}

export type BrowserFamily = "chrome" | "firefox" | "edge";

export interface FingerprintOptions {
  browserFamily?: BrowserFamily;
}

// ─── Weighted Data ─────────────────────────────────────────────────────────

interface Weighted {
  weight: number;
}

interface ScreenResolution extends Weighted {
  width: number;
  height: number;
}

interface Platform extends Weighted {
  name: string;
  os: string;
}

interface Timezone extends Weighted {
  tz: string;
}

interface Language extends Weighted {
  langs: string[];
}

interface GPU extends Weighted {
  vendor: string;
  renderer: string;
}

/**
 * Common screen resolutions weighted by real-world usage (StatCounter 2025).
 */
const SCREEN_RESOLUTIONS: ScreenResolution[] = [
  { width: 1920, height: 1080, weight: 0.30 },
  { width: 1366, height: 768,  weight: 0.15 },
  { width: 1536, height: 864,  weight: 0.10 },
  { width: 2560, height: 1440, weight: 0.12 },
  { width: 1440, height: 900,  weight: 0.08 },
  { width: 1680, height: 1050, weight: 0.05 },
  { width: 3840, height: 2160, weight: 0.07 },
  { width: 1280, height: 720,  weight: 0.06 },
  { width: 1600, height: 900,  weight: 0.04 },
  { width: 2560, height: 1600, weight: 0.03 },
];

const PLATFORMS: Platform[] = [
  { name: "Win32",        os: "Windows NT 10.0; Win64; x64",        weight: 0.60 },
  { name: "MacIntel",     os: "Macintosh; Intel Mac OS X 10_15_7",  weight: 0.25 },
  { name: "Linux x86_64", os: "X11; Linux x86_64",                  weight: 0.15 },
];

const TIMEZONES: Timezone[] = [
  { tz: "America/New_York",     weight: 0.20 },
  { tz: "America/Chicago",      weight: 0.12 },
  { tz: "America/Denver",       weight: 0.06 },
  { tz: "America/Los_Angeles",  weight: 0.15 },
  { tz: "Europe/London",        weight: 0.10 },
  { tz: "Europe/Berlin",        weight: 0.08 },
  { tz: "Europe/Paris",         weight: 0.06 },
  { tz: "Asia/Tokyo",           weight: 0.05 },
  { tz: "Asia/Shanghai",        weight: 0.05 },
  { tz: "Australia/Sydney",     weight: 0.04 },
  { tz: "America/Sao_Paulo",    weight: 0.04 },
  { tz: "Asia/Kolkata",         weight: 0.05 },
];

const LANGUAGES: Language[] = [
  { langs: ["en-US", "en"],       weight: 0.55 },
  { langs: ["en-GB", "en"],       weight: 0.10 },
  { langs: ["de-DE", "de", "en"], weight: 0.08 },
  { langs: ["fr-FR", "fr", "en"], weight: 0.06 },
  { langs: ["es-ES", "es", "en"], weight: 0.06 },
  { langs: ["ja-JP", "ja"],       weight: 0.05 },
  { langs: ["pt-BR", "pt", "en"], weight: 0.05 },
  { langs: ["zh-CN", "zh"],       weight: 0.05 },
];

const GPUS: GPU[] = [
  { vendor: "Google Inc. (NVIDIA)", renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)", weight: 0.12 },
  { vendor: "Google Inc. (NVIDIA)", renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0)", weight: 0.10 },
  { vendor: "Google Inc. (Intel)",  renderer: "ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0)", weight: 0.15 },
  { vendor: "Google Inc. (Intel)",  renderer: "ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0)", weight: 0.12 },
  { vendor: "Google Inc. (AMD)",   renderer: "ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0)", weight: 0.08 },
  { vendor: "Apple",               renderer: "Apple M1", weight: 0.15 },
  { vendor: "Apple",               renderer: "Apple M2", weight: 0.10 },
  { vendor: "Mesa",                renderer: "Mesa Intel(R) UHD Graphics 630 (CFL GT2)", weight: 0.08 },
  { vendor: "Mesa",                renderer: "llvmpipe (LLVM 15.0.7, 256 bits)", weight: 0.10 },
];

// ─── Weighted Selection ────────────────────────────────────────────────────

/**
 * Weighted random selection from an array of objects with a `weight` property.
 */
function weightedPick<T extends Weighted>(items: T[]): T {
  const total = items.reduce((s, i) => s + i.weight, 0);
  let r = Math.random() * total;
  for (const item of items) {
    r -= item.weight;
    if (r <= 0) return item;
  }
  return items[items.length - 1];
}

// ─── Generator ─────────────────────────────────────────────────────────────

/**
 * Generate a consistent, realistic browser fingerprint profile.
 * The fingerprint is internally coherent:
 * - Platform matches userAgent string
 * - deviceMemory correlates with screen resolution tier
 * - hardwareConcurrency scales with deviceMemory
 * - GPU, timezone, and languages are weighted by real-world distributions
 *
 * @param opts - Configuration options
 * @returns A complete fingerprint profile for Playwright context configuration
 */
export function generateFingerprint(opts: FingerprintOptions = {}): Fingerprint {
  const family = opts.browserFamily ?? "chrome";

  // Pick screen resolution
  const screen = weightedPick(SCREEN_RESOLUTIONS);

  // Browser version ranges (realistic as of early 2026)
  const versions: Record<string, { min: number; max: number }> = {
    chrome:  { min: 120, max: 132 },
    firefox: { min: 120, max: 128 },
    edge:    { min: 120, max: 132 },
  };
  const vRange = versions[family] ?? versions.chrome;
  const majorVersion = vRange.min + Math.floor(Math.random() * (vRange.max - vRange.min + 1));

  // Platform
  const platform = weightedPick(PLATFORMS);

  // Build userAgent
  let userAgent: string;
  const chromeBuild = `${majorVersion}.0.${3000 + Math.floor(Math.random() * 3000)}.${Math.floor(Math.random() * 200)}`;
  if (family === "chrome") {
    userAgent = `Mozilla/5.0 (${platform.os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeBuild} Safari/537.36`;
  } else if (family === "firefox") {
    userAgent = `Mozilla/5.0 (${platform.os}; rv:${majorVersion}.0) Gecko/20100101 Firefox/${majorVersion}.0`;
  } else {
    userAgent = `Mozilla/5.0 (${platform.os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeBuild} Safari/537.36 Edg/${chromeBuild}`;
  }

  // Viewport (slightly smaller than screen to simulate browser chrome)
  const chromeHeights = [80, 90, 100, 110];
  const chromeHeight = chromeHeights[Math.floor(Math.random() * chromeHeights.length)];
  const viewport = {
    width: screen.width,
    height: screen.height - chromeHeight,
  };

  // Device memory (correlated with screen resolution tier)
  const isHighEnd = screen.width >= 2560;
  const highEndMemory = [8, 16, 32];
  const normalMemory = [4, 8, 16];
  const deviceMemory = isHighEnd
    ? highEndMemory[Math.floor(Math.random() * highEndMemory.length)]
    : normalMemory[Math.floor(Math.random() * normalMemory.length)];

  // Hardware concurrency (correlated similarly)
  const highEndCores = [8, 12, 16];
  const normalCores = [4, 6, 8];
  const hardwareConcurrency = isHighEnd
    ? highEndCores[Math.floor(Math.random() * highEndCores.length)]
    : normalCores[Math.floor(Math.random() * normalCores.length)];

  // Timezone, languages, GPU
  const tz = weightedPick(TIMEZONES);
  const lang = weightedPick(LANGUAGES);
  const gpu = weightedPick(GPUS);

  return {
    userAgent,
    platform: platform.name,
    viewport,
    screen: { width: screen.width, height: screen.height },
    devicePixelRatio: screen.width >= 2560 ? 2 : 1,
    deviceMemory,
    hardwareConcurrency,
    timezone: tz.tz,
    languages: lang.langs,
    webgl: { vendor: gpu.vendor, renderer: gpu.renderer },
    colorDepth: 24,
    maxTouchPoints: platform.name === "Win32" ? (Math.random() < 0.3 ? 10 : 0) : 0,
    doNotTrack: Math.random() < 0.15 ? "1" : null,
    cookieEnabled: true,
    pdfViewerEnabled: true,
  };
}
