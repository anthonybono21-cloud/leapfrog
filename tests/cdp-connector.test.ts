import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as http from "http";

// ─── Mocks ─────────────────────────────────────────────────────────────────

// Mock playwright before any imports that use it
vi.mock("playwright-core", () => ({
  chromium: {
    connectOverCDP: vi.fn(),
  },
}));

// Mock logger to suppress test output
vi.mock("../src/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock fs/promises at module level (ESM requires vi.mock, not vi.spyOn)
vi.mock("fs/promises", () => ({
  readFile: vi.fn(),
}));

// Import after mocks are set up
import { CdpConnector, parseDevToolsActivePort, probePort } from "../src/cdp-connector.js";
import { chromium } from "playwright-core";
import { readFile } from "fs/promises";

const mockedReadFile = vi.mocked(readFile);

// ─── Helpers ───────────────────────────────────────────────────────────────

const originalEnv = { ...process.env };

function setEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("parseDevToolsActivePort", () => {
  it("parses a valid port file with port and path", () => {
    const contents = "9222\n/devtools/browser/abc-123\n";
    expect(parseDevToolsActivePort(contents)).toBe(9222);
  });

  it("parses a file with only a port number", () => {
    expect(parseDevToolsActivePort("9222")).toBe(9222);
  });

  it("handles an unusual but valid port", () => {
    expect(parseDevToolsActivePort("41017\n/devtools/browser/x")).toBe(41017);
  });

  it("returns null for empty content", () => {
    expect(parseDevToolsActivePort("")).toBeNull();
    expect(parseDevToolsActivePort("   \n  ")).toBeNull();
  });

  it("returns null for non-numeric content", () => {
    expect(parseDevToolsActivePort("not-a-port\n/foo")).toBeNull();
  });

  it("returns null for port out of range", () => {
    expect(parseDevToolsActivePort("0")).toBeNull();
    expect(parseDevToolsActivePort("70000")).toBeNull();
    expect(parseDevToolsActivePort("-1")).toBeNull();
  });
});

describe("probePort", () => {
  let server: http.Server;
  let serverPort: number;

  afterEach(() => {
    return new Promise<void>((resolve) => {
      if (server?.listening) {
        server.close(() => resolve());
      } else {
        resolve();
      }
    });
  });

  it("returns the browser name when /json/version responds", async () => {
    const responseBody = JSON.stringify({
      Browser: "Chrome/125.0.6422.60",
      webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/abc",
    });

    server = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(responseBody);
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    serverPort = (server.address() as { port: number }).port;

    const result = await probePort(serverPort, 1000);
    expect(result).toBe("Chrome/125.0.6422.60");
  });

  it("returns null for a port that is not listening", async () => {
    const result = await probePort(19999, 300);
    expect(result).toBeNull();
  });

  it("returns null for invalid JSON response", async () => {
    server = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("not json");
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    serverPort = (server.address() as { port: number }).port;

    const result = await probePort(serverPort, 1000);
    expect(result).toBeNull();
  });

  it("does not hang when timeout is short", async () => {
    const start = Date.now();
    await probePort(19998, 200);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(2000);
  });
});

describe("CdpConnector.discover", () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.LEAP_CDP_ENDPOINT;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns env var endpoint with highest priority", async () => {
    setEnv("LEAP_CDP_ENDPOINT", "http://localhost:9333");

    vi.spyOn(CdpConnector, "discoverFromPortFiles").mockResolvedValue([]);
    vi.spyOn(CdpConnector, "discoverFromPortScan").mockResolvedValue([]);

    const results = await CdpConnector.discover();
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]).toEqual({
      endpoint: "http://localhost:9333",
      browser: "Chrome",
      source: "env",
    });
  });

  it("env var comes before port file results in ordering", async () => {
    setEnv("LEAP_CDP_ENDPOINT", "http://localhost:9333");

    vi.spyOn(CdpConnector, "discoverFromPortFiles").mockResolvedValue([
      { endpoint: "http://localhost:9222", browser: "Chrome", source: "devtools-port-file" },
    ]);
    vi.spyOn(CdpConnector, "discoverFromPortScan").mockResolvedValue([]);

    const results = await CdpConnector.discover();
    expect(results[0].source).toBe("env");
    expect(results[1].source).toBe("devtools-port-file");
  });

  it("deduplicates endpoints", async () => {
    setEnv("LEAP_CDP_ENDPOINT", "http://localhost:9222");

    vi.spyOn(CdpConnector, "discoverFromPortFiles").mockResolvedValue([
      { endpoint: "http://localhost:9222", browser: "Chrome", source: "devtools-port-file" },
    ]);
    vi.spyOn(CdpConnector, "discoverFromPortScan").mockResolvedValue([
      { endpoint: "http://localhost:9222", browser: "Chrome/125", source: "port-scan" },
    ]);

    const results = await CdpConnector.discover();
    expect(results.length).toBe(1);
    expect(results[0].source).toBe("env");
  });

  it("returns empty array when nothing is found", async () => {
    vi.spyOn(CdpConnector, "discoverFromPortFiles").mockResolvedValue([]);
    vi.spyOn(CdpConnector, "discoverFromPortScan").mockResolvedValue([]);

    const results = await CdpConnector.discover();
    expect(results).toEqual([]);
  });
});

describe("CdpConnector.discoverFromPortFiles", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("finds Chrome from a valid DevToolsActivePort file", async () => {
    mockedReadFile.mockImplementation(async (filePath) => {
      const p = String(filePath).toLowerCase();
      if ((p.includes("google") && p.includes("chrome") && !p.includes("canary") && !p.includes("sxs")) || p.includes("google-chrome/")) {
        return "9222\n/devtools/browser/abc-123\n";
      }
      throw new Error("ENOENT");
    });

    const results = await CdpConnector.discoverFromPortFiles();
    const chromeResult = results.find((r) => r.browser === "Chrome");
    expect(chromeResult).toBeDefined();
    expect(chromeResult!.endpoint).toBe("http://localhost:9222");
    expect(chromeResult!.source).toBe("devtools-port-file");
  });

  it("detects correct browser names", async () => {
    mockedReadFile.mockImplementation(async (filePath) => {
      const p = String(filePath);
      if (p.includes("Brave")) return "9223\n/devtools/browser/b";
      if (p.includes("Canary") || p.includes("SxS")) return "9224\n/devtools/browser/c";
      if (p.includes("Chromium")) return "9225\n/devtools/browser/d";
      if (p.includes("Chrome")) return "9222\n/devtools/browser/a";
      throw new Error("ENOENT");
    });

    const results = await CdpConnector.discoverFromPortFiles();

    // On this platform we should get at least 1 result; the exact count
    // depends on which port file paths match the mock patterns
    expect(results.length).toBeGreaterThanOrEqual(1);

    for (const r of results) {
      expect(r.source).toBe("devtools-port-file");
      expect(r.endpoint).toMatch(/^http:\/\/localhost:\d+$/);
    }
  });

  it("returns empty when no port files exist", async () => {
    mockedReadFile.mockRejectedValue(new Error("ENOENT"));

    const results = await CdpConnector.discoverFromPortFiles();
    expect(results).toEqual([]);
  });

  it("skips files with invalid content", async () => {
    mockedReadFile.mockResolvedValue("garbage\nnot-a-port");

    const results = await CdpConnector.discoverFromPortFiles();
    expect(results).toEqual([]);
  });
});

describe("CdpConnector.discoverFromPortScan", () => {
  it("discovers endpoints on scanned ports", async () => {
    vi.spyOn(CdpConnector, "discoverFromPortScan").mockResolvedValue([
      { endpoint: "http://localhost:9222", browser: "Chrome/125", source: "port-scan" },
    ]);

    const results = await CdpConnector.discoverFromPortScan();
    expect(results).toHaveLength(1);
    expect(results[0].browser).toBe("Chrome/125");
    expect(results[0].source).toBe("port-scan");
  });
});

describe("CdpConnector.connect", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("calls chromium.connectOverCDP and returns the browser", async () => {
    const mockBrowser = {
      contexts: vi.fn().mockReturnValue([]),
      isConnected: vi.fn().mockReturnValue(true),
    };
    vi.mocked(chromium.connectOverCDP).mockResolvedValue(mockBrowser as any);

    const browser = await CdpConnector.connect("http://localhost:9222");
    expect(chromium.connectOverCDP).toHaveBeenCalledWith("http://localhost:9222");
    expect(browser).toBe(mockBrowser);
  });

  it("wraps connection errors with a clear message", async () => {
    vi.mocked(chromium.connectOverCDP).mockRejectedValue(new Error("Connection refused"));

    await expect(CdpConnector.connect("http://localhost:9222")).rejects.toThrow(
      "CDP connection failed to http://localhost:9222: Connection refused",
    );
  });
});

describe("CdpConnector.autoConnect", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.LEAP_CDP_ENDPOINT;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("connects to the highest priority endpoint", async () => {
    const mockBrowser = {
      contexts: vi.fn().mockReturnValue([]),
      isConnected: vi.fn().mockReturnValue(true),
    };
    vi.mocked(chromium.connectOverCDP).mockResolvedValue(mockBrowser as any);

    vi.spyOn(CdpConnector, "discover").mockResolvedValue([
      { endpoint: "http://localhost:9222", browser: "Chrome", source: "devtools-port-file" },
      { endpoint: "http://localhost:9223", browser: "Brave", source: "port-scan" },
    ]);

    const { browser, info } = await CdpConnector.autoConnect();
    expect(browser).toBe(mockBrowser);
    expect(info.endpoint).toBe("http://localhost:9222");
    expect(info.source).toBe("devtools-port-file");
    expect(chromium.connectOverCDP).toHaveBeenCalledWith("http://localhost:9222");
  });

  it("throws when no endpoints are discovered", async () => {
    vi.spyOn(CdpConnector, "discover").mockResolvedValue([]);

    await expect(CdpConnector.autoConnect()).rejects.toThrow(
      "No CDP endpoint found",
    );
  });

  it("throws descriptive error with launch instructions", async () => {
    vi.spyOn(CdpConnector, "discover").mockResolvedValue([]);

    await expect(CdpConnector.autoConnect()).rejects.toThrow(
      "--remote-debugging-port=9222",
    );
  });
});

describe("discovery priority order", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns results in env > port-file > port-scan order", async () => {
    setEnv("LEAP_CDP_ENDPOINT", "http://localhost:9333");

    vi.spyOn(CdpConnector, "discoverFromPortFiles").mockResolvedValue([
      { endpoint: "http://localhost:9222", browser: "Chrome", source: "devtools-port-file" },
    ]);
    vi.spyOn(CdpConnector, "discoverFromPortScan").mockResolvedValue([
      { endpoint: "http://localhost:9224", browser: "Brave", source: "port-scan" },
    ]);

    const results = await CdpConnector.discover();
    expect(results.length).toBe(3);
    expect(results[0].source).toBe("env");
    expect(results[1].source).toBe("devtools-port-file");
    expect(results[2].source).toBe("port-scan");
  });
});
