import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as http from "node:http";
import { SidecarServer, type SidecarDeps } from "../sidecar.js";

// ---------------------------------------------------------------------------
// Unit tests for sidecar.ts — real HTTP against localhost, mocked deps
// ---------------------------------------------------------------------------

/** Helper: GET a URL and return { status, headers, body }. */
function httpGet(url: string): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks),
        });
      });
      res.on("error", reject);
    }).on("error", reject);
  });
}

describe("SidecarServer", () => {
  let server: SidecarServer;
  let baseUrl: string;
  let assignedPort: number;

  const mockDeps: SidecarDeps = {
    listSessions: vi.fn(() => [
      { id: "s_abc123", name: "session-1", url: "https://example.com" },
      { id: "s_def456", name: "session-2", url: "https://test.com" },
    ]),
    focusSession: vi.fn(async () => {}),
    zoomSession: vi.fn(async () => {}),
    restoreGrid: vi.fn(async () => {}),
    setLayout: vi.fn(async () => {}),
    destroyAll: vi.fn(async () => {}),
    screenshot: vi.fn(async () => Buffer.from([0x89, 0x50, 0x4e, 0x47])), // PNG magic bytes
  };

  beforeAll(async () => {
    server = new SidecarServer(mockDeps);
    // Use port 0 to let the OS assign a free port
    await server.start(0);
    // Extract the assigned port from the underlying server
    const addr = (server as any).server.address();
    assignedPort = typeof addr === "object" ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${assignedPort}`;
  });

  afterAll(async () => {
    await server.stop();
  });

  // ── Constructor ─────────────────────────────────────────────────────

  it("accepts SidecarDeps without throwing", () => {
    expect(() => new SidecarServer(mockDeps)).not.toThrow();
  });

  // ── Server lifecycle ────────────────────────────────────────────────

  it("starts an HTTP server on the specified port", () => {
    expect(assignedPort).toBeGreaterThan(0);
    const addr = (server as any).server.address();
    expect(addr).toBeTruthy();
    expect(addr.port).toBe(assignedPort);
  });

  // ── GET /health ─────────────────────────────────────────────────────

  it("GET /health returns 200 with JSON", async () => {
    const { status, headers, body } = await httpGet(`${baseUrl}/health`);
    expect(status).toBe(200);
    expect(headers["content-type"]).toContain("application/json");
    const json = JSON.parse(body.toString());
    expect(json.ok).toBe(true);
    expect(json.data.status).toBe("running");
  });

  // ── GET /sessions ───────────────────────────────────────────────────

  it("GET /sessions calls listSessions and returns JSON array", async () => {
    const { status, headers, body } = await httpGet(`${baseUrl}/sessions`);
    expect(status).toBe(200);
    expect(headers["content-type"]).toContain("application/json");
    const json = JSON.parse(body.toString());
    expect(json.ok).toBe(true);
    expect(Array.isArray(json.data)).toBe(true);
    expect(json.data).toHaveLength(2);
    expect(json.data[0].id).toBe("s_abc123");
    expect(json.data[1].id).toBe("s_def456");
    expect(mockDeps.listSessions).toHaveBeenCalled();
  });

  // ── GET /screenshot/:id ─────────────────────────────────────────────

  it("GET /screenshot/:id calls screenshot dep and returns image/png", async () => {
    const { status, headers, body } = await httpGet(`${baseUrl}/screenshot/s_abc123`);
    expect(status).toBe(200);
    expect(headers["content-type"]).toBe("image/png");
    // Check PNG magic bytes
    expect(body[0]).toBe(0x89);
    expect(body[1]).toBe(0x50);
    expect(body[2]).toBe(0x4e);
    expect(body[3]).toBe(0x47);
    expect(mockDeps.screenshot).toHaveBeenCalledWith("s_abc123");
  });

  it("GET /screenshot without ID returns 400", async () => {
    const { status, body } = await httpGet(`${baseUrl}/screenshot`);
    expect(status).toBe(400);
    const json = JSON.parse(body.toString());
    expect(json.ok).toBe(false);
    expect(json.error).toContain("Missing session ID");
  });

  it("GET /screenshot with unknown session returns 404", async () => {
    const { status, body } = await httpGet(`${baseUrl}/screenshot/s_unknown`);
    expect(status).toBe(404);
    const json = JSON.parse(body.toString());
    expect(json.ok).toBe(false);
    expect(json.error).toContain("Session not found");
  });

  // ── Unknown routes ──────────────────────────────────────────────────

  it("unknown routes return 404", async () => {
    const { status, body } = await httpGet(`${baseUrl}/nonexistent`);
    expect(status).toBe(404);
    const json = JSON.parse(body.toString());
    expect(json.ok).toBe(false);
    expect(json.error).toContain("Unknown route");
  });

  it("root path returns 404", async () => {
    const { status, body } = await httpGet(`${baseUrl}/`);
    expect(status).toBe(404);
    const json = JSON.parse(body.toString());
    expect(json.ok).toBe(false);
  });

  // ── CORS headers ────────────────────────────────────────────────────

  it("responses include CORS headers", async () => {
    const { headers } = await httpGet(`${baseUrl}/health`);
    expect(headers["access-control-allow-origin"]).toBe("*");
  });

  // ── Error handling ──────────────────────────────────────────────────

  it("returns 500 when a dep throws", async () => {
    // Make focusSession throw
    const errorDeps: SidecarDeps = {
      ...mockDeps,
      listSessions: vi.fn(() => [{ id: "s_err001", name: "bad", url: "https://err.com" }]),
      focusSession: vi.fn(async () => {
        throw new Error("Browser crashed");
      }),
    };
    const errServer = new SidecarServer(errorDeps);
    await errServer.start(0);
    const addr = (errServer as any).server.address();
    const errPort = typeof addr === "object" ? addr.port : 0;

    try {
      const { status, body } = await httpGet(`http://127.0.0.1:${errPort}/focus/s_err001`);
      expect(status).toBe(500);
      const json = JSON.parse(body.toString());
      expect(json.ok).toBe(false);
      expect(json.error).toContain("Browser crashed");
    } finally {
      await errServer.stop();
    }
  });

  // ── stop() ──────────────────────────────────────────────────────────

  it("stop() closes the server cleanly", async () => {
    const tempServer = new SidecarServer(mockDeps);
    await tempServer.start(0);
    const tempAddr = (tempServer as any).server.address();
    expect(tempAddr).toBeTruthy();

    await tempServer.stop();
    expect((tempServer as any).server).toBeNull();
  });

  it("stop() is safe to call when server is not started", async () => {
    const unstarted = new SidecarServer(mockDeps);
    await expect(unstarted.stop()).resolves.toBeUndefined();
  });
});
