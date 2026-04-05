// ─── Sidecar HTTP Control Server ──────────────────────────────────────────
//
// Zero-dependency localhost HTTP server for headed-mode session control.
// Exposes REST-ish endpoints to list, focus, zoom, tile, and screenshot
// browser sessions.  Started by index.ts when LEAP_TILE is set.
//
// All responses are JSON except /screenshot/:id which returns image/png.
// CORS is wide-open (localhost only, safe).

import * as http from "node:http";
import { logger } from "./logger.js";

// ─── Dependency injection interface ───────────────────────────────────────

export interface SidecarDeps {
  listSessions: () => Array<{ id: string; name?: string; url: string }>;
  focusSession: (id: string) => Promise<void>;
  zoomSession: (id: string) => Promise<void>;
  restoreGrid: () => Promise<void>;
  setLayout: (layout: string) => Promise<void>;
  destroyAll: () => Promise<void>;
  screenshot: (id: string) => Promise<Buffer>;
}

// ─── Server ───────────────────────────────────────────────────────────────

export class SidecarServer {
  private server: http.Server | null = null;
  private deps: SidecarDeps;

  constructor(deps: SidecarDeps) {
    this.deps = deps;
  }

  // ── lifecycle ───────────────────────────────────────────────────────────

  start(port = 9222): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        this.route(req, res).catch(() => {
          /* already handled inside route() */
        });
      });

      server.once("error", reject);

      server.listen(port, "127.0.0.1", () => {
        server.removeListener("error", reject);
        this.server = server;
        logger.info("sidecar.start", { port });
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close(() => {
        this.server = null;
        logger.info("sidecar.stop");
        resolve();
      });
    });
  }

  // ── routing ─────────────────────────────────────────────────────────────

  private async route(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const parsed = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const segments = parsed.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
    // segments: e.g. ["sessions"], ["focus","abc"], ["screenshot","abc"]

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const route = segments[0] ?? "";
    const param = segments[1];

    try {
      switch (route) {
        case "health":
          return this.json(res, 200, { ok: true, data: { status: "running" } });

        case "sessions":
          return this.json(res, 200, { ok: true, data: this.deps.listSessions() });

        case "focus":
          return await this.withSession(param, res, async (id) => {
            await this.deps.focusSession(id);
            return { focused: id };
          });

        case "zoom":
          return await this.withSession(param, res, async (id) => {
            await this.deps.zoomSession(id);
            return { zoomed: id };
          });

        case "grid":
          await this.deps.restoreGrid();
          return this.json(res, 200, { ok: true, data: { layout: "grid" } });

        case "layout": {
          const layoutType = param ?? "grid";
          await this.deps.setLayout(layoutType);
          return this.json(res, 200, { ok: true, data: { layout: layoutType } });
        }

        case "stop":
          await this.deps.destroyAll();
          return this.json(res, 200, { ok: true, data: { destroyed: true } });

        case "screenshot":
          return await this.withSession(param, res, async (id) => {
            const buf = await this.deps.screenshot(id);
            res.writeHead(200, {
              "Content-Type": "image/png",
              "Content-Length": buf.length,
              "Access-Control-Allow-Origin": "*",
            });
            res.end(buf);
            return null; // signal: already sent
          });

        default:
          return this.json(res, 404, { ok: false, error: `Unknown route: /${segments.join("/")}` });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("sidecar.handler", { route, param, error: message });
      return this.json(res, 500, { ok: false, error: message });
    }
  }

  // ── helpers ─────────────────────────────────────────────────────────────

  /** Run a handler that requires a session ID, with 404 guard. */
  private async withSession(
    id: string | undefined,
    res: http.ServerResponse,
    handler: (id: string) => Promise<Record<string, unknown> | null>,
  ): Promise<void> {
    if (!id) {
      return this.json(res, 400, { ok: false, error: "Missing session ID in URL" });
    }
    const sessions = this.deps.listSessions();
    if (!sessions.some((s) => s.id === id)) {
      return this.json(res, 404, {
        ok: false,
        error: `Session not found: ${id}`,
        available: sessions.map((s) => s.id),
      });
    }
    const data = await handler(id);
    if (data !== null) {
      this.json(res, 200, { ok: true, data });
    }
  }

  /** Send a JSON response. */
  private json(res: http.ServerResponse, status: number, body: Record<string, unknown>): void {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload),
      "Access-Control-Allow-Origin": "*",
    });
    res.end(payload);
  }
}
