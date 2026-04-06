// ─── CAPTCHA Solver Integration ──────────────────────────────────────────
//
// Integrates with external CAPTCHA solving services (CapSolver, 2Captcha,
// NopeCHA) to automatically solve CAPTCHAs detected by the intervention
// system. This module is standalone — no cross-deps except logger.ts types.
//
// Flow:
//   1. intervention.ts detects a CAPTCHA (reCAPTCHA v2/v3, hCaptcha, Turnstile)
//   2. If LEAP_CAPTCHA_PROVIDER env var is set, this module handles solving
//   3. Extract sitekey + pageURL from the page
//   4. POST to the solver API
//   5. Poll for the token (or receive it directly from NopeCHA)
//   6. Inject the token into the page
//   7. Submit the form / trigger the callback
//
// Env vars:
//   LEAP_CAPTCHA_PROVIDER  — 'capsolver' | '2captcha' | 'nopecha'
//   LEAP_CAPTCHA_API_KEY   — API key for the selected provider
//
// If LEAP_CAPTCHA_PROVIDER is unset, all exports are safe no-ops.

import type { Page } from "playwright-core";
import { logger } from "./logger.js";

// ─── Types ───────────────────────────────────────────────────────────────

export type CaptchaProvider = "capsolver" | "2captcha" | "nopecha";

export type CaptchaType = "recaptcha-v2" | "recaptcha-v3" | "hcaptcha" | "turnstile";

export interface CaptchaSolveResult {
  solved: boolean;
  provider: string;
  captchaType: string;
  solveTimeMs: number;
  error?: string;
}

interface SitekeyInfo {
  sitekey: string;
  pageURL: string;
}

interface TaskCreateResponse {
  errorId: number;
  errorCode?: string;
  errorDescription?: string;
  taskId?: string;
}

interface TaskResultResponse {
  errorId: number;
  errorCode?: string;
  errorDescription?: string;
  status?: "processing" | "ready";
  solution?: {
    gRecaptchaResponse?: string;
    token?: string;
  };
}

// ─── Constants ───────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS = 120_000;

const CAPSOLVER_CREATE_URL = "https://api.capsolver.com/createTask";
const CAPSOLVER_RESULT_URL = "https://api.capsolver.com/getTaskResult";

const TWOCAPTCHA_CREATE_URL = "https://api.2captcha.com/createTask";
const TWOCAPTCHA_RESULT_URL = "https://api.2captcha.com/getTaskResult";

const NOPECHA_SOLVE_URL = "https://api.nopecha.com/token";

/** Maps our internal captcha type to each provider's task type string. */
const CAPSOLVER_TASK_TYPES: Record<CaptchaType, string> = {
  "recaptcha-v2": "ReCaptchaV2TaskProxyLess",
  "recaptcha-v3": "ReCaptchaV3TaskProxyLess",
  hcaptcha: "HCaptchaTaskProxyLess",
  turnstile: "AntiTurnstileTaskProxyLess",
};

const TWOCAPTCHA_TASK_TYPES: Record<CaptchaType, string> = {
  "recaptcha-v2": "RecaptchaV2TaskProxyless",
  "recaptcha-v3": "RecaptchaV3TaskProxyless",
  hcaptcha: "HCaptchaTaskProxyless",
  turnstile: "TurnstileTaskProxyless",
};

const NOPECHA_TYPE_MAP: Record<CaptchaType, string> = {
  "recaptcha-v2": "recaptcha2",
  "recaptcha-v3": "recaptcha3",
  hcaptcha: "hcaptcha",
  turnstile: "turnstile",
};

// ─── Config helpers ──────────────────────────────────────────────────────

function getProvider(): CaptchaProvider | null {
  const raw = process.env.LEAP_CAPTCHA_PROVIDER;
  if (!raw) return null;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "capsolver" || normalized === "2captcha" || normalized === "nopecha") {
    return normalized;
  }
  logger.warn("captcha:invalid-provider", { value: raw, valid: "capsolver, 2captcha, nopecha" });
  return null;
}

function getApiKey(): string | null {
  const key = process.env.LEAP_CAPTCHA_API_KEY;
  if (!key || key.trim().length === 0) return null;
  return key.trim();
}

/**
 * Returns true if a CAPTCHA solving provider is configured and ready.
 * Safe to call at any time — reads env vars on each invocation so config
 * changes at runtime are picked up immediately.
 */
export function isCaptchaSolverEnabled(): boolean {
  return getProvider() !== null && getApiKey() !== null;
}

// ─── Captcha type normalization ──────────────────────────────────────────

/**
 * Normalizes the free-form captchaType string (from intervention.ts or the
 * caller) into one of our four supported CaptchaType values.
 *
 * Accepts a variety of inputs:
 *   "recaptcha", "recaptcha-v2", "recaptcha_v2", "reCAPTCHA v2" → "recaptcha-v2"
 *   "recaptcha-v3", "recaptcha_v3", "reCAPTCHA v3"               → "recaptcha-v3"
 *   "hcaptcha", "h-captcha"                                       → "hcaptcha"
 *   "turnstile", "cloudflare", "cf-turnstile"                     → "turnstile"
 */
function normalizeCaptchaType(raw: string): CaptchaType | null {
  const lower = raw.toLowerCase().replace(/[\s_]/g, "-");

  if (lower.includes("recaptcha") && lower.includes("v3")) return "recaptcha-v3";
  if (lower.includes("recaptcha")) return "recaptcha-v2";
  if (lower.includes("hcaptcha") || lower.includes("h-captcha")) return "hcaptcha";
  if (lower.includes("turnstile") || lower.includes("cloudflare") || lower.includes("cf-turnstile")) return "turnstile";

  return null;
}

// ─── Sitekey extraction ──────────────────────────────────────────────────

/**
 * Extracts the sitekey from the page for the given captcha type.
 * Runs inside page.evaluate() — all DOM access happens in-browser.
 */
async function extractSitekey(page: Page, captchaType: CaptchaType): Promise<SitekeyInfo | null> {
  const result = await page.evaluate((ct: string) => {
    function getAttr(selector: string, attr: string): string | null {
      const el = document.querySelector(selector);
      return el ? el.getAttribute(attr) : null;
    }

    function extractFromIframeSrc(pattern: string, paramName: string): string | null {
      const iframes = document.querySelectorAll("iframe[src]");
      for (const iframe of iframes) {
        const src = iframe.getAttribute("src") || "";
        if (!src.includes(pattern)) continue;
        try {
          const url = new URL(src, window.location.href);
          const val = url.searchParams.get(paramName);
          if (val) return val;
        } catch {
          // Malformed URL — skip
        }
      }
      return null;
    }

    let sitekey: string | null = null;

    switch (ct) {
      case "recaptcha-v2":
      case "recaptcha-v3":
        // Method 1: data-sitekey on the widget div
        sitekey = getAttr("div.g-recaptcha[data-sitekey]", "data-sitekey");
        // Method 2: sitekey in the reCAPTCHA script src
        if (!sitekey) {
          const scripts = document.querySelectorAll('script[src*="recaptcha"]');
          for (const script of scripts) {
            const src = script.getAttribute("src") || "";
            try {
              const url = new URL(src, window.location.href);
              const render = url.searchParams.get("render");
              if (render && render !== "explicit") {
                sitekey = render;
                break;
              }
            } catch {
              // skip
            }
          }
        }
        // Method 3: sitekey param in iframe src
        if (!sitekey) {
          sitekey = extractFromIframeSrc("recaptcha", "k");
        }
        break;

      case "hcaptcha":
        sitekey = getAttr("div.h-captcha[data-sitekey]", "data-sitekey");
        if (!sitekey) {
          sitekey = extractFromIframeSrc("hcaptcha", "sitekey");
        }
        break;

      case "turnstile":
        sitekey = getAttr("div.cf-turnstile[data-sitekey]", "data-sitekey");
        if (!sitekey) {
          sitekey = extractFromIframeSrc("challenges.cloudflare.com", "k");
        }
        break;
    }

    if (!sitekey) return null;
    return { sitekey, pageURL: window.location.href };
  }, captchaType);

  return result;
}

// ─── Provider: CapSolver ─────────────────────────────────────────────────

async function solveWithCapSolver(
  apiKey: string,
  captchaType: CaptchaType,
  sitekey: string,
  pageURL: string,
): Promise<string> {
  const taskType = CAPSOLVER_TASK_TYPES[captchaType];

  const createBody = {
    clientKey: apiKey,
    task: {
      type: taskType,
      websiteURL: pageURL,
      websiteKey: sitekey,
    },
  };

  logger.debug("captcha:capsolver:create", { taskType, pageURL });

  const createRes = await fetch(CAPSOLVER_CREATE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(createBody),
  });

  if (!createRes.ok) {
    throw new Error(`CapSolver createTask HTTP ${createRes.status}: ${await createRes.text()}`);
  }

  const createData = (await createRes.json()) as TaskCreateResponse;

  if (createData.errorId !== 0) {
    throw new Error(`CapSolver createTask error: ${createData.errorCode} — ${createData.errorDescription}`);
  }

  if (!createData.taskId) {
    throw new Error("CapSolver createTask returned no taskId");
  }

  return pollForToken(
    CAPSOLVER_RESULT_URL,
    apiKey,
    createData.taskId,
    "capsolver",
  );
}

// ─── Provider: 2Captcha ─────────────────────────────────────────────────

async function solveWith2Captcha(
  apiKey: string,
  captchaType: CaptchaType,
  sitekey: string,
  pageURL: string,
): Promise<string> {
  const taskType = TWOCAPTCHA_TASK_TYPES[captchaType];

  const createBody = {
    clientKey: apiKey,
    task: {
      type: taskType,
      websiteURL: pageURL,
      websiteKey: sitekey,
    },
  };

  logger.debug("captcha:2captcha:create", { taskType, pageURL });

  const createRes = await fetch(TWOCAPTCHA_CREATE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(createBody),
  });

  if (!createRes.ok) {
    throw new Error(`2Captcha createTask HTTP ${createRes.status}: ${await createRes.text()}`);
  }

  const createData = (await createRes.json()) as TaskCreateResponse;

  if (createData.errorId !== 0) {
    throw new Error(`2Captcha createTask error: ${createData.errorCode} — ${createData.errorDescription}`);
  }

  if (!createData.taskId) {
    throw new Error("2Captcha createTask returned no taskId");
  }

  return pollForToken(
    TWOCAPTCHA_RESULT_URL,
    apiKey,
    createData.taskId,
    "2captcha",
  );
}

// ─── Provider: NopeCHA ──────────────────────────────────────────────────

async function solveWithNopeCHA(
  apiKey: string,
  captchaType: CaptchaType,
  sitekey: string,
  pageURL: string,
): Promise<string> {
  const nopechaType = NOPECHA_TYPE_MAP[captchaType];

  logger.debug("captcha:nopecha:solve", { type: nopechaType, pageURL });

  const body = {
    type: nopechaType,
    sitekey,
    url: pageURL,
    key: apiKey,
  };

  const res = await fetch(NOPECHA_SOLVE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`NopeCHA HTTP ${res.status}: ${await res.text()}`);
  }

  const data = (await res.json()) as { data?: string; error?: number; message?: string };

  if (data.error) {
    throw new Error(`NopeCHA error ${data.error}: ${data.message ?? "unknown"}`);
  }

  if (!data.data || typeof data.data !== "string") {
    throw new Error("NopeCHA returned no token");
  }

  return data.data;
}

// ─── Polling (CapSolver / 2Captcha shared) ──────────────────────────────

async function pollForToken(
  resultURL: string,
  apiKey: string,
  taskId: string,
  providerName: string,
): Promise<string> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let attempts = 0;

  while (Date.now() < deadline) {
    // Wait before first poll — the task is never ready instantly
    await sleep(POLL_INTERVAL_MS);
    attempts++;

    logger.debug(`captcha:${providerName}:poll`, { taskId, attempt: attempts });

    const res = await fetch(resultURL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientKey: apiKey, taskId }),
    });

    if (!res.ok) {
      throw new Error(`${providerName} getTaskResult HTTP ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as TaskResultResponse;

    if (data.errorId !== 0) {
      throw new Error(`${providerName} getTaskResult error: ${data.errorCode} — ${data.errorDescription}`);
    }

    if (data.status === "ready") {
      const token = data.solution?.gRecaptchaResponse ?? data.solution?.token;
      if (!token) {
        throw new Error(`${providerName} returned ready status but no token in solution`);
      }
      logger.info(`captcha:${providerName}:solved`, { taskId, attempts });
      return token;
    }

    // status === "processing" — continue polling
  }

  throw new Error(`${providerName} polling timed out after ${POLL_TIMEOUT_MS / 1000}s (${attempts} attempts)`);
}

// ─── Token injection ────────────────────────────────────────────────────

/**
 * Injects the solved CAPTCHA token into the page and triggers the
 * appropriate callback so the form recognizes the solution.
 *
 * Runs entirely inside page.evaluate() — no Node-side DOM access.
 */
async function injectToken(page: Page, captchaType: CaptchaType, token: string): Promise<void> {
  await page.evaluate(
    ({ ct, tk }: { ct: string; tk: string }) => {
      function setTextareaValue(selector: string, value: string): boolean {
        const el = document.querySelector(selector) as HTMLTextAreaElement | null;
        if (!el) return false;
        el.value = value;
        el.style.display = "none";
        return true;
      }

      function setInputValue(selector: string, value: string): boolean {
        const el = document.querySelector(selector) as HTMLInputElement | null;
        if (!el) return false;
        el.value = value;
        return true;
      }

      switch (ct) {
        case "recaptcha-v2": {
          // Set the response textarea
          setTextareaValue("#g-recaptcha-response", tk);
          // Also check for multiple response textareas (multi-widget pages)
          const textareas = document.querySelectorAll('textarea[name="g-recaptcha-response"]');
          for (const ta of textareas) {
            (ta as HTMLTextAreaElement).value = tk;
          }
          // Trigger the callback if available
          try {
            // Standard callback location
            const cb = (window as any).___grecaptcha_cfg?.clients?.[0]?.["*"]?.callback
              ?? (window as any).___grecaptcha_cfg?.clients?.[0];
            if (typeof cb === "function") {
              cb(tk);
            } else if (cb && typeof cb.callback === "function") {
              cb.callback(tk);
            }
          } catch {
            // Callback not found — the form may still work via textarea value
          }
          // Also try the data-callback attribute on the widget div
          try {
            const widget = document.querySelector("div.g-recaptcha[data-callback]");
            if (widget) {
              const cbName = widget.getAttribute("data-callback");
              if (cbName && typeof (window as any)[cbName] === "function") {
                (window as any)[cbName](tk);
              }
            }
          } catch {
            // skip
          }
          break;
        }

        case "recaptcha-v3": {
          setTextareaValue("#g-recaptcha-response", tk);
          const textareas = document.querySelectorAll('textarea[name="g-recaptcha-response"]');
          for (const ta of textareas) {
            (ta as HTMLTextAreaElement).value = tk;
          }
          // v3 callback is typically on ___grecaptcha_cfg.clients
          try {
            const clients = (window as any).___grecaptcha_cfg?.clients;
            if (clients) {
              for (const clientKey of Object.keys(clients)) {
                const client = clients[clientKey];
                // Walk the client object tree to find the callback
                for (const propKey of Object.keys(client)) {
                  const prop = client[propKey];
                  if (prop && typeof prop === "object") {
                    for (const subKey of Object.keys(prop)) {
                      if (typeof prop[subKey]?.callback === "function") {
                        prop[subKey].callback(tk);
                      }
                    }
                  }
                }
              }
            }
          } catch {
            // skip
          }
          break;
        }

        case "hcaptcha": {
          setTextareaValue('textarea[name="h-captcha-response"]', tk);
          setTextareaValue('textarea[name="g-recaptcha-response"]', tk);
          // Trigger hcaptcha callback
          try {
            const widget = document.querySelector("div.h-captcha[data-callback]");
            if (widget) {
              const cbName = widget.getAttribute("data-callback");
              if (cbName && typeof (window as any)[cbName] === "function") {
                (window as any)[cbName](tk);
              }
            }
            // Also try the global hcaptcha object
            if (typeof (window as any).hcaptcha?.getRespKey === "function") {
              // hcaptcha stores the response internally; some sites check via hcaptcha.getResponse()
              // Setting textarea is usually sufficient, but dispatch a custom event as a hint
              document.dispatchEvent(new CustomEvent("hcaptchaCallback", { detail: { token: tk } }));
            }
          } catch {
            // skip
          }
          break;
        }

        case "turnstile": {
          setInputValue('input[name="cf-turnstile-response"]', tk);
          // Also set any hidden textarea variants
          setTextareaValue('textarea[name="cf-turnstile-response"]', tk);
          // Try the Turnstile callback
          try {
            const widget = document.querySelector("div.cf-turnstile[data-callback]");
            if (widget) {
              const cbName = widget.getAttribute("data-callback");
              if (cbName && typeof (window as any)[cbName] === "function") {
                (window as any)[cbName](tk);
              }
            }
            // Also try turnstile.getResponse style — trigger via the global callback registry
            if (typeof (window as any).turnstile?.render === "function") {
              document.dispatchEvent(new CustomEvent("turnstileCallback", { detail: { token: tk } }));
            }
          } catch {
            // skip
          }
          break;
        }
      }
    },
    { ct: captchaType, tk: token },
  );
}

// ─── Main entry point ───────────────────────────────────────────────────

/**
 * Attempts to solve a CAPTCHA on the given page using the configured
 * external solving service.
 *
 * @param page           - Playwright page with the CAPTCHA
 * @param captchaType    - Free-form type string (e.g. "recaptcha", "hcaptcha", "turnstile")
 * @param elementSelector - Optional CSS selector hint for the CAPTCHA element
 * @returns              - Result object with solve status, timing, and any error
 */
export async function solveCaptcha(
  page: Page,
  captchaType: string,
  elementSelector?: string,
): Promise<CaptchaSolveResult> {
  const startTime = Date.now();

  const provider = getProvider();
  const apiKey = getApiKey();

  if (!provider || !apiKey) {
    return {
      solved: false,
      provider: provider ?? "none",
      captchaType,
      solveTimeMs: Date.now() - startTime,
      error: "CAPTCHA solver not configured. Set LEAP_CAPTCHA_PROVIDER and LEAP_CAPTCHA_API_KEY env vars.",
    };
  }

  const normalized = normalizeCaptchaType(captchaType);
  if (!normalized) {
    return {
      solved: false,
      provider,
      captchaType,
      solveTimeMs: Date.now() - startTime,
      error: `Unsupported CAPTCHA type: "${captchaType}". Supported: recaptcha-v2, recaptcha-v3, hcaptcha, turnstile.`,
    };
  }

  logger.info("captcha:solve:start", {
    provider,
    captchaType: normalized,
    url: page.url(),
    elementSelector: elementSelector ?? null,
  });

  try {
    // Step 1: Extract sitekey from the page
    const sitekeyInfo = await extractSitekey(page, normalized);
    if (!sitekeyInfo) {
      const error = `Could not extract sitekey for ${normalized} from page`;
      logger.warn("captcha:solve:no-sitekey", { captchaType: normalized, url: page.url() });
      return {
        solved: false,
        provider,
        captchaType: normalized,
        solveTimeMs: Date.now() - startTime,
        error,
      };
    }

    logger.debug("captcha:solve:sitekey", {
      sitekey: sitekeyInfo.sitekey,
      pageURL: sitekeyInfo.pageURL,
    });

    // Step 2: Send to solving service
    let token: string;

    switch (provider) {
      case "capsolver":
        token = await solveWithCapSolver(apiKey, normalized, sitekeyInfo.sitekey, sitekeyInfo.pageURL);
        break;
      case "2captcha":
        token = await solveWith2Captcha(apiKey, normalized, sitekeyInfo.sitekey, sitekeyInfo.pageURL);
        break;
      case "nopecha":
        token = await solveWithNopeCHA(apiKey, normalized, sitekeyInfo.sitekey, sitekeyInfo.pageURL);
        break;
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }

    // Step 3: Inject the token into the page
    await injectToken(page, normalized, token);

    const solveTimeMs = Date.now() - startTime;

    logger.info("captcha:solve:success", {
      provider,
      captchaType: normalized,
      solveTimeMs,
      url: page.url(),
    });

    return {
      solved: true,
      provider,
      captchaType: normalized,
      solveTimeMs,
    };
  } catch (err) {
    const solveTimeMs = Date.now() - startTime;
    const errorMsg = err instanceof Error ? err.message : String(err);

    logger.error("captcha:solve:failed", {
      provider,
      captchaType: normalized,
      solveTimeMs,
      error: errorMsg,
      url: page.url(),
    });

    return {
      solved: false,
      provider,
      captchaType: normalized,
      solveTimeMs,
      error: errorMsg,
    };
  }
}

// ─── Utilities ──────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
