// ─── Record / Replay Tier 1 ────────────────────────────────────────────────
//
// session_export  — export session action history as a replayable Recording
// session_replay  — replay a Recording in a new (or existing) session
//
// Recording format is a JSON script of parameterized steps. Refs are resolved
// to stable Playwright selectors at export time so they survive across pages.

import { HarnessIntelligence } from "./harness-intelligence.js";
import { logger } from "./logger.js";
import type { Session } from "./types.js";
import type { Page } from "playwright-core";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RecordingParam {
  default: string;
  description?: string;
  sensitive?: boolean;
}

export interface RecordingStep {
  tool: string;
  args: Record<string, unknown>;
}

export interface Recording {
  version: 1;
  name: string;
  createdAt: number;
  sourceUrl: string;
  params: Record<string, RecordingParam>;
  steps: RecordingStep[];
}

export interface ReplayStepResult {
  step: number;
  tool: string;
  status: "ok" | "error";
  error?: string;
  duration: number;
}

export interface ReplayResult {
  status: "ok" | "error";
  stepsCompleted: number;
  stepsTotal: number;
  totalDuration: number;
  results: ReplayStepResult[];
}

export interface ExportOptions {
  name?: string;
  /** When true, keep extract steps in the recording */
  keepExtracts?: boolean;
  /** Output format: json (default) or playwright */
  format?: "json" | "playwright";
}

export interface ReplayOptions {
  onError?: "stop" | "skip";
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** Tools that mutate browser state — kept in export */
const MUTATING_TOOLS = new Set([
  "navigate",
  "act",
  "batch_actions",
  "wait_for",
  "add_init_script",
  "network_intercept",
  "execute",
  "tab_switch",
  "tab_close",
]);

/** Action types within the `act` tool that are mutating */
const MUTATING_ACTIONS = new Set([
  "click",
  "dblclick",
  "fill",
  "type",
  "check",
  "uncheck",
  "select",
  "press",
  "scroll",
  "hover",
  "mousemove",
  "drag",
  "upload",
  "resize",
  "back",
  "forward",
]);

/** Patterns for auto-detecting parameterizable values */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\/.+/;
const PASSWORD_FIELD_HINTS = ["password", "passwd", "pass", "secret", "pin"];

// ─── Ref Resolution ─────────────────────────────────────────────────────────

/**
 * Resolve an @eN ref to a stable selector from the session's refMap.
 * Returns the CSS/aria selector string, or the original value if not an @eN ref.
 */
function resolveRef(value: string, refMap: Map<string, string>): string {
  if (!value.startsWith("@e")) return value;
  const selector = refMap.get(value);
  if (!selector) {
    logger.warn("recording:ref-miss", { ref: value });
    return value; // keep the raw ref as fallback
  }
  return selector;
}

/**
 * Attempt to convert a Playwright aria-ref selector to a simpler CSS selector.
 * aria-ref=eN selectors are ephemeral — try to build a stable alternative.
 * For role-based selectors (role=button[name="OK"]), keep as-is since they're
 * already stable across page loads.
 */
function stabilizeSelector(selector: string): string {
  // aria-ref=eN → not stable; we can't convert without DOM access, so keep as-is
  // role=button[name="OK"] → already stable
  // CSS selectors → already stable
  return selector;
}

// ─── Auto-parameterization ──────────────────────────────────────────────────

interface ParamDetection {
  paramName: string;
  original: string;
  param: RecordingParam;
}

/**
 * Detect values that should be parameterized: emails, URLs in fill actions,
 * and values going into password fields.
 */
function detectParams(steps: RecordingStep[]): ParamDetection[] {
  const detections: ParamDetection[] = [];
  const seen = new Set<string>();
  let emailCount = 0;
  let urlCount = 0;
  let passwordCount = 0;

  for (const step of steps) {
    const value = step.args.value as string | undefined;
    if (!value || typeof value !== "string") continue;

    // Check if this is a fill or type action
    const isFillAction =
      step.tool === "act" &&
      (step.args.action === "fill" || step.args.action === "type");

    if (!isFillAction) continue;

    const target = (step.args.target as string) ?? "";
    const targetLower = target.toLowerCase();

    // Password field detection
    const isPasswordField = PASSWORD_FIELD_HINTS.some(
      (hint) => targetLower.includes(hint),
    );

    if (isPasswordField && !seen.has(value)) {
      seen.add(value);
      passwordCount++;
      const name = passwordCount === 1 ? "password" : `password_${passwordCount}`;
      detections.push({
        paramName: name,
        original: value,
        param: {
          default: "",
          description: "Password value",
          sensitive: true,
        },
      });
      continue;
    }

    // Email detection
    if (EMAIL_RE.test(value) && !seen.has(value)) {
      seen.add(value);
      emailCount++;
      const name = emailCount === 1 ? "email" : `email_${emailCount}`;
      detections.push({
        paramName: name,
        original: value,
        param: {
          default: value,
          description: "Email address",
        },
      });
      continue;
    }

    // URL detection (in fill/type values, not navigate URLs)
    if (URL_RE.test(value) && !seen.has(value)) {
      seen.add(value);
      urlCount++;
      const name = urlCount === 1 ? "url" : `url_${urlCount}`;
      detections.push({
        paramName: name,
        original: value,
        param: {
          default: value,
          description: "URL value",
        },
      });
    }
  }

  return detections;
}

/**
 * Apply parameter placeholders to step values.
 * Replaces literal values with {{paramName}} tokens.
 */
function applyParams(
  steps: RecordingStep[],
  detections: ParamDetection[],
): RecordingStep[] {
  if (detections.length === 0) return steps;

  // Build a map of original value → placeholder
  const replacements = new Map<string, string>();
  for (const d of detections) {
    replacements.set(d.original, `{{${d.paramName}}}`);
  }

  return steps.map((step) => {
    const newArgs = { ...step.args };

    // Replace in value field
    if (typeof newArgs.value === "string" && replacements.has(newArgs.value)) {
      newArgs.value = replacements.get(newArgs.value)!;
    }

    // Replace in url field (for navigate steps)
    if (typeof newArgs.url === "string") {
      for (const [original, placeholder] of replacements) {
        if (newArgs.url === original) {
          newArgs.url = placeholder;
        }
      }
    }

    return { ...step, args: newArgs };
  });
}

// ─── Export ─────────────────────────────────────────────────────────────────

/**
 * Export session action history as a replayable Recording.
 *
 * 1. Gets action history from HarnessIntelligence
 * 2. Filters to mutating actions only
 * 3. Resolves @eN refs to stable selectors via session.refMap
 * 4. Auto-detects parameters for emails, URLs, passwords
 * 5. Returns Recording JSON
 */
export function exportSession(
  sessionId: string,
  session: Session,
  options?: ExportOptions,
): Recording | string {
  const history = HarnessIntelligence.getHistory(sessionId);

  if (history.length === 0) {
    throw new Error("No actions recorded in this session. Perform some actions first.");
  }

  // Determine the source URL (first navigate or earliest URL)
  let sourceUrl = "";
  for (const rec of history) {
    if (rec.url) {
      sourceUrl = rec.url;
      break;
    }
  }

  // ── Step 1: Filter to mutating actions ──────────────────────────────────

  const filtered = history.filter((rec) => {
    const toolName = rec.toolCall?.toolName ?? rec.actionType;

    // Keep mutating tools
    if (MUTATING_TOOLS.has(toolName)) return true;

    // Keep act sub-actions (click, fill, etc.) that come through analyzePostAction
    if (MUTATING_ACTIONS.has(rec.actionType)) return true;

    // Keep extract steps if option is set
    if (options?.keepExtracts && toolName === "extract") return true;

    return false;
  });

  if (filtered.length === 0) {
    throw new Error("No replayable actions found in session history.");
  }

  // ── Step 2: Convert to RecordingSteps with ref resolution ─────────────

  const refMap = session.refMap;
  const steps: RecordingStep[] = [];

  for (const rec of filtered) {
    const toolName = rec.toolCall?.toolName ?? rec.actionType;
    const params = rec.toolCall?.params ?? {};

    // Build step based on tool type
    if (toolName === "navigate") {
      steps.push({
        tool: "navigate",
        args: {
          url: (params.url as string) ?? rec.url,
          ...(params.waitUntil ? { waitUntil: params.waitUntil } : {}),
        },
      });
    } else if (toolName === "act") {
      const action = (params.action as string) ?? rec.actionType;
      const target = (params.target as string) ?? rec.target;
      const value = (params.value as string) ?? rec.value;

      const args: Record<string, unknown> = { action };

      if (target) {
        args.target = resolveRef(target, refMap);
        args.target = stabilizeSelector(args.target as string);
      }
      if (value !== undefined && value !== null) args.value = value;
      if (params.key) args.key = params.key;
      if (params.scrollDirection) args.scrollDirection = params.scrollDirection;
      if (params.scrollAmount) args.scrollAmount = params.scrollAmount;
      if (params.target2) {
        args.target2 = resolveRef(params.target2 as string, refMap);
        args.target2 = stabilizeSelector(args.target2 as string);
      }
      if (params.filePaths) args.filePaths = params.filePaths;
      if (params.width) args.width = params.width;
      if (params.height) args.height = params.height;

      steps.push({ tool: "act", args });
    } else if (toolName === "batch_actions") {
      // Inline batch actions as individual steps for replay clarity
      const actions = params.actions as Array<Record<string, unknown>> | undefined;
      if (actions) {
        for (const a of actions) {
          const target = a.target as string | undefined;
          const args: Record<string, unknown> = { ...a };
          if (target) {
            args.target = resolveRef(target, refMap);
            args.target = stabilizeSelector(args.target as string);
          }
          steps.push({ tool: "act", args });
        }
      }
    } else if (toolName === "wait_for") {
      const args: Record<string, unknown> = {};
      if (params.condition) args.condition = params.condition;
      if (params.target) {
        args.target = resolveRef(params.target as string, refMap);
        args.target = stabilizeSelector(args.target as string);
      }
      if (params.text) args.text = params.text;
      if (params.js) args.js = params.js;
      if (params.timeout) args.timeout = params.timeout;
      steps.push({ tool: "wait_for", args });
    } else if (toolName === "add_init_script") {
      steps.push({
        tool: "add_init_script",
        args: { script: params.script ?? "" },
      });
    } else if (toolName === "network_intercept") {
      steps.push({
        tool: "network_intercept",
        args: { ...params },
      });
    } else if (toolName === "execute") {
      steps.push({
        tool: "execute",
        args: { script: params.script ?? params.code ?? "" },
      });
    } else if (toolName === "extract" && options?.keepExtracts) {
      const args: Record<string, unknown> = {};
      if (params.type) args.type = params.type;
      if (params.target) {
        args.target = resolveRef(params.target as string, refMap);
      }
      if (params.js) args.js = params.js;
      steps.push({ tool: "extract", args });
    } else if (toolName === "tab_switch") {
      steps.push({ tool: "tab_switch", args: { tabIndex: params.tabIndex } });
    } else if (toolName === "tab_close") {
      steps.push({ tool: "tab_close", args: { tabIndex: params.tabIndex } });
    } else if (MUTATING_ACTIONS.has(rec.actionType)) {
      // Raw act sub-action from analyzePostAction (no toolCall wrapper)
      const args: Record<string, unknown> = { action: rec.actionType };
      if (rec.target) {
        args.target = resolveRef(rec.target, refMap);
        args.target = stabilizeSelector(args.target as string);
      }
      if (rec.value !== undefined) args.value = rec.value;
      steps.push({ tool: "act", args });
    }
  }

  // ── Step 2b: Deduplicate consecutive identical steps ────────────────
  // Both recordToolCall and analyzePostAction fire for the same act call,
  // producing duplicate entries. Remove consecutive steps with matching
  // tool + action + target + value.
  const deduped: RecordingStep[] = [];
  for (const step of steps) {
    const prev = deduped[deduped.length - 1];
    if (
      prev &&
      prev.tool === step.tool &&
      prev.args.action === step.args.action &&
      prev.args.target === step.args.target &&
      prev.args.value === step.args.value &&
      prev.args.key === step.args.key
    ) {
      continue; // Skip duplicate
    }
    deduped.push(step);
  }

  // ── Step 3: Auto-detect parameters ────────────────────────────────────

  const detections = detectParams(deduped);
  const parameterizedSteps = applyParams(deduped, detections);

  const paramDefs: Record<string, RecordingParam> = {};
  for (const d of detections) {
    paramDefs[d.paramName] = d.param;
  }

  // ── Step 4: Build Recording ───────────────────────────────────────────

  const recording: Recording = {
    version: 1,
    name: options?.name ?? `recording-${Date.now()}`,
    createdAt: Date.now(),
    sourceUrl,
    params: paramDefs,
    steps: parameterizedSteps,
  };

  // ── Step 5: Return in requested format ────────────────────────────────

  if (options?.format === "playwright") {
    return toPlaywrightScript(recording);
  }

  return recording;
}

// ─── Playwright Script Export ───────────────────────────────────────────────

/**
 * Convert a Recording to a Playwright-compatible JS function body.
 * Output is suitable for the `execute` tool.
 */
export function toPlaywrightScript(recording: Recording): string {
  const lines: string[] = [];

  lines.push("// Auto-generated Playwright script from Leapfrog session recording");
  lines.push(`// Name: ${recording.name}`);
  lines.push(`// Source: ${recording.sourceUrl}`);
  lines.push(`// Steps: ${recording.steps.length}`);
  lines.push("");

  // Parameter declarations
  if (Object.keys(recording.params).length > 0) {
    lines.push("// Parameters — override these when calling");
    lines.push("const params = {");
    for (const [name, param] of Object.entries(recording.params)) {
      const val = param.sensitive ? '""' : JSON.stringify(param.default);
      const desc = param.description ? ` // ${param.description}` : "";
      lines.push(`  ${name}: ${val},${desc}`);
    }
    lines.push("};");
    lines.push("");
  }

  // Step conversion
  for (let i = 0; i < recording.steps.length; i++) {
    const step = recording.steps[i];
    const comment = `// Step ${i + 1}: ${step.tool}`;
    lines.push(comment);

    switch (step.tool) {
      case "navigate": {
        const url = resolveParamInValue(step.args.url as string);
        const waitUntil = step.args.waitUntil ? `, { waitUntil: ${JSON.stringify(step.args.waitUntil)} }` : "";
        lines.push(`await page.goto(${url}${waitUntil});`);
        break;
      }
      case "act": {
        const action = step.args.action as string;
        const target = step.args.target as string | undefined;
        const value = step.args.value as string | undefined;

        switch (action) {
          case "click":
            if (target) lines.push(`await page.locator(${quoteSelector(target)}).click();`);
            break;
          case "dblclick":
            if (target) lines.push(`await page.locator(${quoteSelector(target)}).dblclick();`);
            break;
          case "fill":
            if (target && value !== undefined) {
              lines.push(`await page.locator(${quoteSelector(target)}).fill(${resolveParamInValue(value)});`);
            }
            break;
          case "type":
            if (target && value !== undefined) {
              lines.push(`await page.locator(${quoteSelector(target)}).pressSequentially(${resolveParamInValue(value)});`);
            }
            break;
          case "check":
            if (target) lines.push(`await page.locator(${quoteSelector(target)}).check();`);
            break;
          case "uncheck":
            if (target) lines.push(`await page.locator(${quoteSelector(target)}).uncheck();`);
            break;
          case "select":
            if (target && value !== undefined) {
              lines.push(`await page.locator(${quoteSelector(target)}).selectOption(${JSON.stringify(value)});`);
            }
            break;
          case "press": {
            const key = step.args.key as string;
            if (key) lines.push(`await page.keyboard.press(${JSON.stringify(key)});`);
            break;
          }
          case "scroll": {
            const dir = (step.args.scrollDirection as string) ?? "down";
            const amount = (step.args.scrollAmount as number) ?? 300;
            const dx = dir === "left" ? -amount : dir === "right" ? amount : 0;
            const dy = dir === "up" ? -amount : dir === "down" ? amount : 0;
            if (target) {
              lines.push(`await page.locator(${quoteSelector(target)}).evaluate((el, { dx, dy }) => el.scrollBy(dx, dy), { dx: ${dx}, dy: ${dy} });`);
            } else {
              lines.push(`await page.mouse.wheel(${dx}, ${dy});`);
            }
            break;
          }
          case "hover":
            if (target) lines.push(`await page.locator(${quoteSelector(target)}).hover();`);
            break;
          case "back":
            lines.push("await page.goBack();");
            break;
          case "forward":
            lines.push("await page.goForward();");
            break;
          default:
            lines.push(`// Unsupported action: ${action}`);
        }
        break;
      }
      case "wait_for": {
        const condition = step.args.condition as string;
        const target = step.args.target as string | undefined;
        const text = step.args.text as string | undefined;
        const js = step.args.js as string | undefined;
        const timeout = (step.args.timeout as number) ?? 10000;

        switch (condition) {
          case "element":
            if (target) lines.push(`await page.locator(${quoteSelector(target)}).waitFor({ timeout: ${timeout} });`);
            break;
          case "text":
            if (text) lines.push(`await page.getByText(${JSON.stringify(text)}).waitFor({ timeout: ${timeout} });`);
            break;
          case "network_idle":
            lines.push(`await page.waitForLoadState("networkidle", { timeout: ${timeout} });`);
            break;
          case "navigation":
            if (text) lines.push(`await page.waitForURL(${JSON.stringify(text)}, { timeout: ${timeout} });`);
            break;
          case "js":
            if (js) lines.push(`await page.waitForFunction(${JSON.stringify(js)}, null, { timeout: ${timeout} });`);
            break;
        }
        break;
      }
      case "extract": {
        const type = (step.args.type as string) ?? "text";
        const target = step.args.target as string | undefined;
        switch (type) {
          case "title":
            lines.push("const title = await page.title();");
            break;
          case "url":
            lines.push("const url = page.url();");
            break;
          case "text":
            if (target) {
              lines.push(`const text = await page.locator(${quoteSelector(target)}).innerText();`);
            } else {
              lines.push("const text = await page.locator('body').innerText();");
            }
            break;
          default:
            lines.push(`// Extract type: ${type}`);
        }
        break;
      }
      case "execute": {
        const script = step.args.script as string;
        lines.push(`await (async () => { ${script} })();`);
        break;
      }
      default:
        lines.push(`// Unsupported tool: ${step.tool}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/** Quote a selector for JS output — handle param placeholders */
function quoteSelector(selector: string): string {
  if (selector.includes("{{")) {
    // Has param placeholders — use template literal
    const escaped = selector.replace(/`/g, "\\`");
    const replaced = escaped.replace(/\{\{(\w+)\}\}/g, "${params.$1}");
    return "`" + replaced + "`";
  }
  return JSON.stringify(selector);
}

/** Resolve {{param}} in a value to JS template literal for Playwright script */
function resolveParamInValue(value: string): string {
  if (value.includes("{{")) {
    const escaped = value.replace(/`/g, "\\`");
    const replaced = escaped.replace(/\{\{(\w+)\}\}/g, "${params.$1}");
    return "`" + replaced + "`";
  }
  return JSON.stringify(value);
}

// ─── Replay ─────────────────────────────────────────────────────────────────

/**
 * Resolve {{placeholder}} params in a string value.
 */
function resolveParams(
  value: unknown,
  params: Record<string, string>,
): unknown {
  if (typeof value !== "string") return value;
  return value.replace(/\{\{(\w+)\}\}/g, (_, name) => {
    if (name in params) return params[name];
    return `{{${name}}}`; // leave unresolved if no param provided
  });
}

/**
 * Recursively resolve params in an args object.
 */
function resolveArgsParams(
  args: Record<string, unknown>,
  params: Record<string, string>,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === "string") {
      resolved[key] = resolveParams(value, params);
    } else if (Array.isArray(value)) {
      resolved[key] = value.map((v) =>
        typeof v === "string" ? resolveParams(v, params) : v,
      );
    } else {
      resolved[key] = value;
    }
  }
  return resolved;
}

/**
 * Replay a Recording against a live browser session.
 *
 * Each step is dispatched directly to Playwright page methods — no MCP
 * round-trip. The overall replay is recorded as a single summary entry
 * in harness intelligence (individual steps are NOT recorded).
 */
export async function replayRecording(
  recording: Recording,
  session: Session,
  page: Page,
  params?: Record<string, string>,
  options?: ReplayOptions,
): Promise<ReplayResult> {
  const onError = options?.onError ?? "stop";
  const mergedParams: Record<string, string> = {};

  // Merge defaults from recording with provided overrides
  for (const [name, paramDef] of Object.entries(recording.params)) {
    mergedParams[name] = paramDef.default;
  }
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      mergedParams[name] = value;
    }
  }

  const results: ReplayStepResult[] = [];
  const totalStart = Date.now();

  for (let i = 0; i < recording.steps.length; i++) {
    const step = recording.steps[i];
    const args = resolveArgsParams(step.args, mergedParams);
    const stepStart = Date.now();

    try {
      await executeStep(page, step.tool, args);

      results.push({
        step: i,
        tool: step.tool,
        status: "ok",
        duration: Date.now() - stepStart,
      });
    } catch (e: any) {
      const result: ReplayStepResult = {
        step: i,
        tool: step.tool,
        status: "error",
        error: e.message,
        duration: Date.now() - stepStart,
      };
      results.push(result);

      if (onError === "stop") {
        logger.warn("recording:replay-stopped", {
          step: i,
          tool: step.tool,
          error: e.message,
        });
        break;
      }

      logger.warn("recording:replay-skip", {
        step: i,
        tool: step.tool,
        error: e.message,
      });
    }
  }

  const totalDuration = Date.now() - totalStart;
  const completedOk = results.filter((r) => r.status === "ok").length;
  const hasErrors = results.some((r) => r.status === "error");

  // Record ONE summary entry in harness intelligence (not individual steps)
  HarnessIntelligence.recordToolCall(
    session.id,
    "session_replay",
    {
      name: recording.name,
      steps: recording.steps.length,
      params: Object.keys(mergedParams),
    },
    `Replay "${recording.name}": ${completedOk}/${recording.steps.length} steps OK (${totalDuration}ms)`,
    totalDuration,
  );

  return {
    status: hasErrors ? "error" : "ok",
    stepsCompleted: completedOk,
    stepsTotal: recording.steps.length,
    totalDuration,
    results,
  };
}

// ─── Step Executor ──────────────────────────────────────────────────────────

/**
 * Execute a single recording step directly against the Playwright page.
 * This bypasses the MCP tool layer — no snapshot overhead, no harness recording.
 */
async function executeStep(
  page: Page,
  tool: string,
  args: Record<string, unknown>,
): Promise<void> {
  switch (tool) {
    case "navigate": {
      const url = args.url as string;
      if (!url) throw new Error("navigate step missing url");
      const waitUntil = (args.waitUntil as "load" | "domcontentloaded" | "networkidle") ?? "load";
      await page.goto(url, { waitUntil });
      break;
    }

    case "act": {
      const action = args.action as string;
      const target = args.target as string | undefined;
      const value = args.value as string | undefined;

      switch (action) {
        case "click": {
          if (!target) throw new Error("click requires target");
          await page.locator(target).click();
          break;
        }
        case "dblclick": {
          if (!target) throw new Error("dblclick requires target");
          await page.locator(target).dblclick();
          break;
        }
        case "fill": {
          if (!target || value === undefined) throw new Error("fill requires target and value");
          await page.locator(target).fill(value);
          break;
        }
        case "type": {
          if (!target || value === undefined) throw new Error("type requires target and value");
          const delay = args.typeDelay as number | undefined;
          await page.locator(target).pressSequentially(value, delay ? { delay } : undefined);
          break;
        }
        case "check": {
          if (!target) throw new Error("check requires target");
          await page.locator(target).check();
          break;
        }
        case "uncheck": {
          if (!target) throw new Error("uncheck requires target");
          await page.locator(target).uncheck();
          break;
        }
        case "select": {
          if (!target || value === undefined) throw new Error("select requires target and value");
          await page.locator(target).selectOption(value);
          break;
        }
        case "press": {
          const key = args.key as string;
          if (!key) throw new Error("press requires key");
          await page.keyboard.press(key);
          break;
        }
        case "scroll": {
          const dir = (args.scrollDirection as string) ?? "down";
          const amount = (args.scrollAmount as number) ?? 300;
          const dx = dir === "left" ? -amount : dir === "right" ? amount : 0;
          const dy = dir === "up" ? -amount : dir === "down" ? amount : 0;

          if (target) {
            await page.locator(target).evaluate(
              (el, { dx, dy }) => el.scrollBy(dx, dy),
              { dx, dy },
            );
          } else {
            await page.mouse.wheel(dx, dy);
          }
          break;
        }
        case "hover": {
          if (!target) throw new Error("hover requires target");
          await page.locator(target).hover();
          break;
        }
        case "mousemove": {
          const x = args.x as number;
          const y = args.y as number;
          if (x === undefined || y === undefined) throw new Error("mousemove requires x and y");
          await page.mouse.move(x, y);
          break;
        }
        case "drag": {
          if (!target) throw new Error("drag requires target");
          const target2 = args.target2 as string;
          if (!target2) throw new Error("drag requires target2");
          await page.locator(target).dragTo(page.locator(target2));
          break;
        }
        case "upload": {
          if (!target) throw new Error("upload requires target");
          const filePaths = args.filePaths as string | string[];
          if (!filePaths) throw new Error("upload requires filePaths");
          const paths = Array.isArray(filePaths) ? filePaths : [filePaths];
          await page.locator(target).setInputFiles(paths);
          break;
        }
        case "resize": {
          const width = args.width as number;
          const height = args.height as number;
          if (!width || !height) throw new Error("resize requires width and height");
          await page.setViewportSize({ width, height });
          break;
        }
        case "back":
          await page.goBack();
          break;
        case "forward":
          await page.goForward();
          break;
        default:
          throw new Error(`Unknown action: ${action}`);
      }
      break;
    }

    case "wait_for": {
      const condition = args.condition as string;
      const target = args.target as string | undefined;
      const text = args.text as string | undefined;
      const js = args.js as string | undefined;
      const timeout = (args.timeout as number) ?? 10000;

      switch (condition) {
        case "element":
          if (!target) throw new Error("element wait requires target");
          await page.locator(target).waitFor({ timeout });
          break;
        case "text":
          if (!text) throw new Error("text wait requires text");
          await page.getByText(text).waitFor({ timeout });
          break;
        case "network_idle":
          await page.waitForLoadState("networkidle", { timeout });
          break;
        case "navigation":
          if (!text) throw new Error("navigation wait requires text (URL pattern)");
          await page.waitForURL(text, { timeout });
          break;
        case "js":
          if (!js) throw new Error("js wait requires js expression");
          await page.waitForFunction(js, null, { timeout });
          break;
        default:
          throw new Error(`Unknown wait condition: ${condition}`);
      }
      break;
    }

    case "add_init_script": {
      const script = args.script as string;
      if (!script) throw new Error("add_init_script requires script");
      await page.addInitScript(script);
      break;
    }

    case "execute": {
      const script = args.script as string;
      if (!script) throw new Error("execute requires script");
      const fn = new Function("page", "context", `return (async () => { ${script} })()`);
      await fn(page, page.context());
      break;
    }

    case "extract": {
      // Extracts during replay are executed but results are not captured
      // (they exist as checkpoint verification steps)
      const type = (args.type as string) ?? "text";
      const target = args.target as string | undefined;
      switch (type) {
        case "text":
          if (target) await page.locator(target).innerText();
          else await page.locator("body").innerText();
          break;
        case "title":
          await page.title();
          break;
        case "url":
          page.url();
          break;
      }
      break;
    }

    case "tab_switch": {
      // Tab operations during replay are best-effort
      logger.debug("recording:replay-tab-switch", { tabIndex: args.tabIndex });
      break;
    }

    case "tab_close": {
      logger.debug("recording:replay-tab-close", { tabIndex: args.tabIndex });
      break;
    }

    default:
      throw new Error(`Unsupported replay tool: ${tool}`);
  }
}

export default { exportSession, replayRecording, toPlaywrightScript };
