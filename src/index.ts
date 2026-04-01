#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { SessionManager } from "./session-manager.js";
import { SnapshotEngine } from "./snapshot-engine.js";
import type { Session } from "./types.js";

// ─── Config ─────────────────────────────────────────────────────────────────

const MAX_SESSIONS = parseInt(process.env.HYDRA_MAX_SESSIONS ?? "15");
const IDLE_TIMEOUT_MS = parseInt(process.env.HYDRA_IDLE_TIMEOUT ?? String(5 * 60 * 1000));
const HEADLESS = process.env.HYDRA_HEADLESS !== "false";
const SCREENSHOT_DIR = path.join(os.homedir(), "Documents", "hydrachrome-screenshots");
const MAX_SNAPSHOT_CHARS = 10000;

const sessions = new SessionManager({
  maxSessions: MAX_SESSIONS,
  idleTimeoutMs: IDLE_TIMEOUT_MS,
  headless: HEADLESS,
});

const snapEngine = new SnapshotEngine();

// ─── Helpers ────────────────────────────────────────────────────────────────

function ok(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function err(msg: string) {
  return { content: [{ type: "text" as const, text: msg }], isError: true as const };
}

function requireSession(sessionId: string): Session {
  const s = sessions.getSession(sessionId);
  if (!s) throw new Error(`Session "${sessionId}" not found. Use session_list to see active sessions.`);
  sessions.touchSession(sessionId);
  return s;
}

async function snapAndFormat(session: Session, opts?: { selector?: string; maxChars?: number }): Promise<string> {
  const result = await snapEngine.snapshot(session.page, session, {
    interactiveOnly: true,
    maxChars: opts?.maxChars ?? MAX_SNAPSHOT_CHARS,
    selector: opts?.selector,
  });

  const url = session.page.url();
  let title = "";
  try { title = await session.page.title(); } catch { /* */ }

  return `[${session.id}] ${title}\n${url}\n${result.nodeCount} elements\n\n${result.text}`;
}

// ─── Server ─────────────────────────────────────────────────────────────────

const server = new McpServer(
  { name: "hydrachrome", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

// ─── session_create ─────────────────────────────────────────────────────────

server.registerTool(
  "session_create",
  {
    title: "Create Browser Session",
    description:
      "Create a new isolated browser session with its own cookies and state. " +
      "Returns a short session ID (e.g. s_k3m7x1) to pass to all other tools. " +
      "Each session is a separate BrowserContext — no cookie leakage between sessions. " +
      `Pool limit: ${MAX_SESSIONS} concurrent sessions.`,
    inputSchema: z.object({
      profilePath: z
        .string()
        .optional()
        .describe("Path to a Playwright storageState JSON file for pre-authenticated sessions."),
      viewport: z
        .object({ width: z.number(), height: z.number() })
        .optional()
        .describe("Custom viewport. Default: 1280x720."),
      userAgent: z.string().optional().describe("Custom user agent string."),
    }),
  },
  async ({ profilePath, viewport, userAgent }) => {
    try {
      const session = await sessions.createSession({ profilePath, viewport, userAgent });
      const stats = sessions.getStats();
      return ok(
        `Session created: ${session.id}\n` +
        `Pool: ${stats.active}/${stats.maxSessions} active`,
      );
    } catch (e: any) {
      return err(e.message);
    }
  },
);

// ─── session_list ───────────────────────────────────────────────────────────

server.registerTool(
  "session_list",
  {
    title: "List Browser Sessions",
    description: "List all active browser sessions with their URLs and idle times.",
    inputSchema: z.object({}),
  },
  async () => {
    const list = sessions.listSessions();
    const stats = sessions.getStats();

    if (list.length === 0) {
      return ok(`No active sessions. (${stats.totalCreated} total created)`);
    }

    const now = Date.now();
    const lines = list.map((s) => {
      const idle = Math.round((now - s.lastUsedAt) / 1000);
      return `${s.id}  ${s.url || "(blank)"}  idle ${idle}s`;
    });

    return ok(
      `${stats.active}/${stats.maxSessions} sessions\n\n` +
      lines.join("\n"),
    );
  },
);

// ─── session_destroy ────────────────────────────────────────────────────────

server.registerTool(
  "session_destroy",
  {
    title: "Destroy Browser Session",
    description: "Close and clean up a browser session. Frees a pool slot.",
    inputSchema: z.object({
      sessionId: z.string().describe("Session ID to destroy."),
    }),
  },
  async ({ sessionId }) => {
    await sessions.destroySession(sessionId);
    const stats = sessions.getStats();
    return ok(`Destroyed ${sessionId}. Pool: ${stats.active}/${stats.maxSessions}`);
  },
);

// ─── navigate ───────────────────────────────────────────────────────────────

server.registerTool(
  "navigate",
  {
    title: "Navigate & Snapshot",
    description:
      "Navigate to a URL and return a compact accessibility snapshot with @eN refs. " +
      "Refs like @e1, @e2 can be passed directly to the 'act' tool — no CSS selectors needed. " +
      "Snapshots are ~200-500 tokens (vs 15,000 with Playwright MCP).",
    inputSchema: z.object({
      sessionId: z.string().describe("Session ID."),
      url: z.string().describe("Full URL including https://"),
      waitUntil: z
        .enum(["load", "domcontentloaded", "networkidle"])
        .default("load")
        .describe("Wait strategy. Use networkidle for SPAs."),
    }),
  },
  async ({ sessionId, url, waitUntil }) => {
    try {
      const session = requireSession(sessionId);
      await session.page.goto(url, { waitUntil });
      const text = await snapAndFormat(session);
      return ok(text);
    } catch (e: any) {
      return err(`Navigate failed: ${e.message}`);
    }
  },
);

// ─── snapshot ───────────────────────────────────────────────────────────────

server.registerTool(
  "snapshot",
  {
    title: "Page Snapshot",
    description:
      "Re-snapshot the current page for fresh @eN refs. " +
      "Use after 'act' when you need to re-orient, or scope to a region with 'selector'. " +
      "Use 'selector' to dramatically reduce tokens (e.g. 'form', '#results').",
    inputSchema: z.object({
      sessionId: z.string().describe("Session ID."),
      selector: z.string().optional().describe("CSS selector to scope snapshot to a page region."),
      maxChars: z.number().int().default(MAX_SNAPSHOT_CHARS).describe("Max output chars."),
    }),
  },
  async ({ sessionId, selector, maxChars }) => {
    try {
      const session = requireSession(sessionId);
      const text = await snapAndFormat(session, { selector, maxChars });
      return ok(text);
    } catch (e: any) {
      return err(`Snapshot failed: ${e.message}`);
    }
  },
);

// ─── act ────────────────────────────────────────────────────────────────────

server.registerTool(
  "act",
  {
    title: "Browser Action",
    description:
      "Perform a browser interaction: click, fill, type, check, select, press key, scroll, hover, back, forward. " +
      "Use @eN refs from navigate/snapshot as the target (e.g. '@e2'). CSS selectors also work. " +
      "Returns a fresh snapshot if the page navigated, or just the action result if it didn't.",
    inputSchema: z.object({
      sessionId: z.string().describe("Session ID."),
      action: z
        .enum(["click", "dblclick", "fill", "type", "check", "uncheck", "select", "press", "scroll", "hover", "back", "forward"])
        .describe("Interaction to perform."),
      target: z
        .string()
        .optional()
        .describe("@eN ref or CSS selector. Required for click, fill, type, check, select, hover."),
      value: z
        .string()
        .optional()
        .describe("Text for fill/type, option value for select."),
      key: z.string().optional().describe("Key name for press (e.g. 'Enter', 'Tab', 'Control+a')."),
      scrollDirection: z
        .enum(["up", "down", "left", "right"])
        .optional()
        .describe("Scroll direction. Default: down."),
      scrollAmount: z.number().int().optional().describe("Pixels to scroll. Default: 300."),
    }),
  },
  async ({ sessionId, action, target, value, key, scrollDirection, scrollAmount }) => {
    try {
      const session = requireSession(sessionId);
      const page = session.page;
      const urlBefore = page.url();

      // Resolve target to a Playwright locator
      const resolve = (ref: string) => {
        if (ref.startsWith("@e")) {
          const selector = session.refMap.get(ref);
          if (!selector) throw new Error(`Ref ${ref} not found. Take a fresh snapshot.`);
          return page.locator(selector);
        }
        return page.locator(ref);
      };

      switch (action) {
        case "click":
        case "dblclick":
        case "hover": {
          if (!target) return err(`'${action}' requires a target`);
          const loc = resolve(target);
          if (action === "dblclick") await loc.dblclick();
          else if (action === "hover") await loc.hover();
          else await loc.click();
          break;
        }
        case "fill": {
          if (!target || value === undefined) return err("'fill' requires target and value");
          await resolve(target).fill(value);
          break;
        }
        case "type": {
          if (!target || value === undefined) return err("'type' requires target and value");
          await resolve(target).pressSequentially(value);
          break;
        }
        case "check":
        case "uncheck": {
          if (!target) return err(`'${action}' requires a target`);
          if (action === "check") await resolve(target).check();
          else await resolve(target).uncheck();
          break;
        }
        case "select": {
          if (!target || value === undefined) return err("'select' requires target and value");
          await resolve(target).selectOption(value);
          break;
        }
        case "press": {
          if (!key) return err("'press' requires a key");
          await page.keyboard.press(key);
          break;
        }
        case "scroll": {
          if (target) {
            await resolve(target).scrollIntoViewIfNeeded();
          } else {
            const dir = scrollDirection ?? "down";
            const px = scrollAmount ?? 300;
            const deltaX = dir === "right" ? px : dir === "left" ? -px : 0;
            const deltaY = dir === "down" ? px : dir === "up" ? -px : 0;
            await page.mouse.wheel(deltaX, deltaY);
          }
          break;
        }
        case "back":
          await page.goBack();
          break;
        case "forward":
          await page.goForward();
          break;
      }

      // If the URL changed, return a full snapshot of the new page
      const urlAfter = page.url();
      if (urlAfter !== urlBefore) {
        try { await page.waitForLoadState("load", { timeout: 5000 }); } catch { /* timeout ok */ }
        const text = await snapAndFormat(session);
        return ok(`[navigated → ${urlAfter}]\n\n${text}`);
      }

      // Same page — brief confirmation
      return ok(`Done: ${action}${target ? ` ${target}` : ""}${value ? ` "${value}"` : ""}`);
    } catch (e: any) {
      return err(`Action failed: ${e.message}`);
    }
  },
);

// ─── screenshot ─────────────────────────────────────────────────────────────

server.registerTool(
  "screenshot",
  {
    title: "Screenshot",
    description: "Capture a screenshot of the current page. Returns the image inline.",
    inputSchema: z.object({
      sessionId: z.string().describe("Session ID."),
      fullPage: z.boolean().default(false).describe("Capture full scrollable page."),
      selector: z.string().optional().describe("CSS selector to capture a specific element."),
    }),
  },
  async ({ sessionId, fullPage, selector }) => {
    try {
      const session = requireSession(sessionId);
      await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
      const filepath = path.join(SCREENSHOT_DIR, `${sessionId}_${Date.now()}.png`);

      if (selector) {
        await session.page.locator(selector).screenshot({ path: filepath });
      } else {
        await session.page.screenshot({ path: filepath, fullPage });
      }

      const imageBuffer = await fs.readFile(filepath);
      return {
        content: [
          { type: "text" as const, text: `Saved: ${filepath}` },
          { type: "image" as const, data: imageBuffer.toString("base64"), mimeType: "image/png" as const },
        ],
      };
    } catch (e: any) {
      return err(`Screenshot failed: ${e.message}`);
    }
  },
);

// ─── extract ────────────────────────────────────────────────────────────────

server.registerTool(
  "extract",
  {
    title: "Extract Data",
    description:
      "Extract data from the page without a full snapshot. " +
      "Types: text (visible text), html (markup), title, url, js (evaluate JavaScript). " +
      "Use target with @eN or CSS selector for element-specific extraction.",
    inputSchema: z.object({
      sessionId: z.string().describe("Session ID."),
      type: z
        .enum(["text", "html", "title", "url", "js"])
        .default("text")
        .describe("What to extract."),
      target: z.string().optional().describe("@eN ref or CSS selector. Omit for page-level."),
      js: z.string().optional().describe("JavaScript expression for type='js'."),
      maxChars: z.number().int().default(5000).describe("Max output characters."),
    }),
  },
  async ({ sessionId, type, target, js, maxChars }) => {
    try {
      const session = requireSession(sessionId);
      const page = session.page;
      let result: string;

      const resolve = (ref: string) => {
        if (ref.startsWith("@e")) {
          const sel = session.refMap.get(ref);
          if (!sel) throw new Error(`Ref ${ref} not found.`);
          return page.locator(sel);
        }
        return page.locator(ref);
      };

      switch (type) {
        case "title":
          result = await page.title();
          break;
        case "url":
          result = page.url();
          break;
        case "js": {
          if (!js) return err("type='js' requires a js expression.");
          const val = await page.evaluate(js);
          result = typeof val === "string" ? val : JSON.stringify(val, null, 2);
          break;
        }
        case "text": {
          if (target) {
            result = (await resolve(target).textContent()) ?? "";
          } else {
            result = (await page.locator("body").textContent()) ?? "";
          }
          break;
        }
        case "html": {
          if (target) {
            result = await resolve(target).innerHTML();
          } else {
            result = await page.content();
          }
          break;
        }
      }

      if (result.length > maxChars) {
        result = result.substring(0, maxChars) + "\n... (truncated)";
      }

      return ok(result || "(empty)");
    } catch (e: any) {
      return err(`Extract failed: ${e.message}`);
    }
  },
);

// ─── Startup ────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`HydraChrome MCP server running (max ${MAX_SESSIONS} sessions, headless=${HEADLESS})`);
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});

// ─── Graceful shutdown ──────────────────────────────────────────────────────

process.on("SIGINT", async () => {
  await sessions.destroyAll();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await sessions.destroyAll();
  process.exit(0);
});
