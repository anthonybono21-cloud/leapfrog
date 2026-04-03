// ─── Script Executor ──────────────────────────────────────────────────────
//
// Code-first scripting mode: runs Playwright scripts inside a Node.js vm
// sandbox. Agents send a JS function body string and get back the return
// value + captured console output.
//
// Kill switch: LEAP_ALLOW_EXECUTE (default "true"). Set to "false" to
// disable entirely.

import * as vm from "node:vm";
import { logger } from "./logger.js";
import type { Session } from "./types.js";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ExecuteOptions {
  script: string;
  timeout?: number; // ms, default 60000, max 300000
}

export interface ExecuteResult {
  returnValue: string; // JSON-stringified return value
  console: string[];   // Captured console output
  duration: number;    // ms
}

// ─── Constants ─────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT = 60_000;
const MAX_TIMEOUT = 300_000;

const BLOCKED_GLOBALS: readonly string[] = [
  "require",
  "process",
  "fs",
  "child_process",
  "net",
  "http",
  "https",
  "global",
  "globalThis",
] as const;

// ─── Helpers ───────────────────────────────────────────────────────────────

function clampTimeout(value: number | undefined): number {
  if (value === undefined || value <= 0) return DEFAULT_TIMEOUT;
  return Math.min(value, MAX_TIMEOUT);
}

function createBlockedProxy(name: string): unknown {
  // Use a function target so both call-style (require("x")) and
  // property-access-style (process.pid) throw the correct error.
  const msg = `Access to '${name}' is not allowed in execute scripts`;
  const trap = () => {
    throw new Error(msg);
  };
  return new Proxy(trap, {
    get() {
      throw new Error(msg);
    },
    set() {
      throw new Error(msg);
    },
    apply() {
      throw new Error(msg);
    },
    construct() {
      throw new Error(msg);
    },
  });
}

function safeStringify(value: unknown): string {
  if (value === undefined) {
    return "Script completed (no return value)";
  }
  try {
    return JSON.stringify(value);
  } catch {
    // Non-serializable (circular refs, functions, etc.)
    return String(value);
  }
}

// ─── Stack trace sanitization ─────────────────────────────────────────────

/** Pattern matching file paths that leak server install location */
const PATH_LEAK_RE = /[A-Za-z]:[\\\/]|\/[Uu]sers\/[^\s:)]+|\/home\/[^\s:)]+|\/tmp\/[^\s:)]+|node_modules\/[^\s:)]+/g;

/** Pattern matching the async IIFE wrapper frame we inject */
const WRAPPER_FRAME_RE = /\s*at\s+(async\s+)?execute-script\.js:\d+:\d+\s*$/gm;

/**
 * Sanitize a stack trace to remove:
 * 1. Server install paths (e.g., /Users/ted/Projects/leapfrog/dist/...)
 * 2. The async wrapper function frame added by the executor
 * 3. Adjust line numbers to be relative to the user's script (subtract 1 for wrapper)
 */
function sanitizeStack(stack: string): string {
  let sanitized = stack;

  // Strip file paths that leak server location
  sanitized = sanitized.replace(PATH_LEAK_RE, "[leapfrog]");

  // Remove the async IIFE wrapper frames
  sanitized = sanitized.replace(WRAPPER_FRAME_RE, "");

  // Adjust line numbers in "execute-script.js:N:M" — subtract 1 for the async wrapper line
  sanitized = sanitized.replace(
    /execute-script\.js:(\d+):(\d+)/g,
    (_match, line, col) => {
      const adjustedLine = Math.max(1, Number(line) - 1);
      return `execute-script.js:${adjustedLine}:${col}`;
    },
  );

  // Remove empty lines left after stripping
  sanitized = sanitized
    .split("\n")
    .filter((line) => line.trim() !== "")
    .join("\n");

  return sanitized;
}

// ─── ScriptExecutor ────────────────────────────────────────────────────────

export class ScriptExecutor {
  /**
   * Whether the execute tool is enabled (LEAP_ALLOW_EXECUTE env var).
   * Defaults to true when unset.
   */
  static isEnabled(): boolean {
    const val = process.env.LEAP_ALLOW_EXECUTE;
    // Only explicitly "false" disables it
    return val !== "false";
  }

  /**
   * Execute a user-provided script string in a sandboxed vm context,
   * with access to the session's Playwright page and browser context.
   */
  static async execute(
    session: Session,
    options: ExecuteOptions,
  ): Promise<ExecuteResult> {
    // ── Kill switch ──────────────────────────────────────────────────
    if (!ScriptExecutor.isEnabled()) {
      throw new Error(
        "execute tool is disabled. Set LEAP_ALLOW_EXECUTE=true to enable.",
      );
    }

    const timeout = clampTimeout(options.timeout);
    const consoleOutput: string[] = [];
    const start = Date.now();

    // ── Console proxy ────────────────────────────────────────────────
    const consoleProxy = {
      log: (...args: unknown[]) => {
        consoleOutput.push(args.map(String).join(" "));
      },
      warn: (...args: unknown[]) => {
        consoleOutput.push(`[WARN] ${args.map(String).join(" ")}`);
      },
      error: (...args: unknown[]) => {
        consoleOutput.push(`[ERROR] ${args.map(String).join(" ")}`);
      },
      info: (...args: unknown[]) => {
        consoleOutput.push(`[INFO] ${args.map(String).join(" ")}`);
      },
    };

    // ── Build sandbox context ────────────────────────────────────────
    const sandbox: Record<string, unknown> = {
      // Playwright objects
      page: session.page,
      context: session.context,
      // Console proxy
      console: consoleProxy,
      // Safe built-ins
      setTimeout,
      clearTimeout,
      Promise,
      JSON,
      Array,
      Object,
      Map,
      Set,
      Date,
      Math,
      RegExp,
      Error,
      URL,
      URLSearchParams,
    };

    // Wire up blocked globals as throwing proxies
    for (const name of BLOCKED_GLOBALS) {
      sandbox[name] = createBlockedProxy(name);
    }

    const vmContext = vm.createContext(sandbox);

    // The vm module sets globalThis to the context object itself, which
    // overrides our proxy. Re-define it as a throwing getter.
    // Note: `global` is kept as a proxy in the sandbox (not a vm built-in),
    // so it doesn't need special handling here.
    Object.defineProperty(vmContext, "globalThis", {
      get() {
        throw new Error(
          "Access to 'globalThis' is not allowed in execute scripts",
        );
      },
      configurable: true,
    });

    // ── Compile the script ───────────────────────────────────────────
    // Wrap the user's script in an async IIFE so `await` works at top level.
    // The user provides the function body, so we wrap it:
    //   (async () => { <script> })()
    const wrappedSource = `(async () => {\n${options.script}\n})()`;

    let compiledScript: vm.Script;
    try {
      compiledScript = new vm.Script(wrappedSource, {
        filename: "execute-script.js",
      });
    } catch (err: unknown) {
      const syntaxError = err as SyntaxError & { stack?: string };
      logger.warn("script_executor.syntax_error", {
        message: syntaxError.message,
      });

      // Extract line info — subtract 1 for the async wrapper we added
      const lineMatch = syntaxError.stack?.match(/:(\d+)/);
      const line = lineMatch ? Math.max(1, Number(lineMatch[1]) - 1) : undefined;
      const lineInfo = line ? ` (line ${line})` : "";

      throw new Error(`Script syntax error${lineInfo}: ${syntaxError.message}`);
    }

    // ── Execute ──────────────────────────────────────────────────────
    logger.debug("script_executor.start", { timeout });

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeout);

    try {
      // Run in the vm context. The script returns a Promise (async IIFE).
      const resultPromise = compiledScript.runInContext(vmContext, {
        timeout,
        displayErrors: true,
      });

      // Race the promise result against our AbortController timeout
      const result = await Promise.race([
        resultPromise,
        new Promise((_, reject) => {
          ac.signal.addEventListener("abort", () => {
            reject(
              new Error(
                `Script execution timed out after ${timeout}ms`,
              ),
            );
          });
        }),
      ]);

      const duration = Date.now() - start;

      logger.debug("script_executor.complete", { duration });

      return {
        returnValue: safeStringify(result),
        console: consoleOutput,
        duration,
      };
    } catch (err: unknown) {
      const duration = Date.now() - start;
      const error = err as Error;

      // Check for vm timeout (throws "Script execution timed out")
      if (
        error.message?.includes("Script execution timed out") ||
        error.message?.includes("timed out")
      ) {
        logger.warn("script_executor.timeout", { timeout, duration });
        throw new Error(`Script execution timed out after ${timeout}ms`);
      }

      // Check for sandbox escape
      if (error.message?.includes("is not allowed in execute scripts")) {
        logger.warn("script_executor.blocked_access", {
          message: error.message,
        });
        throw error;
      }

      // Generic runtime error — include sanitized stack context
      logger.warn("script_executor.runtime_error", {
        message: error.message,
      });
      const rawStack = error.stack ?? "";
      const stack = sanitizeStack(rawStack);
      throw new Error(`Script runtime error: ${error.message}\n${stack}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

export { sanitizeStack };
export default ScriptExecutor;
