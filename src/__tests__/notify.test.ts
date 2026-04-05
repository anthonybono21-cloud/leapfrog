import { describe, it, expect, afterEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Unit tests for notify.ts — guard logic only, no actual audio playback
//
// IS_MAC is captured at module load time, so platform tests use
// vi.resetModules() + dynamic import to re-evaluate the constant.
// ---------------------------------------------------------------------------

describe("notify", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
    vi.resetModules();
  });

  // Helper: dynamically import notify after env/platform changes
  async function loadNotify() {
    const mod = await import("../notify.js");
    return mod;
  }

  // ── isSoundEnabled ──────────────────────────────────────────────────

  describe("isSoundEnabled()", () => {
    it("returns false when LEAP_SOUND is not set (on darwin)", async () => {
      delete process.env.LEAP_SOUND;
      const { isSoundEnabled } = await loadNotify();
      expect(isSoundEnabled()).toBe(false);
    });

    it("returns false when LEAP_SOUND is 'false'", async () => {
      process.env.LEAP_SOUND = "false";
      const { isSoundEnabled } = await loadNotify();
      expect(isSoundEnabled()).toBe(false);
    });

    it("returns false on non-darwin platform even when LEAP_SOUND is 'true'", async () => {
      process.env.LEAP_SOUND = "true";
      Object.defineProperty(process, "platform", { value: "linux", configurable: true });
      const { isSoundEnabled } = await loadNotify();
      expect(isSoundEnabled()).toBe(false);
      // restore platform so afterEach env restore doesn't break
      Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
    });

    it("returns true when LEAP_SOUND is 'true' and platform is darwin", async () => {
      process.env.LEAP_SOUND = "true";
      Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
      const { isSoundEnabled } = await loadNotify();
      expect(isSoundEnabled()).toBe(true);
    });
  });

  // ── isNotifyEnabled ─────────────────────────────────────────────────

  describe("isNotifyEnabled()", () => {
    it("returns false when LEAP_NOTIFY is not set", async () => {
      delete process.env.LEAP_NOTIFY;
      const { isNotifyEnabled } = await loadNotify();
      expect(isNotifyEnabled()).toBe(false);
    });

    it("returns false when LEAP_NOTIFY is 'false'", async () => {
      process.env.LEAP_NOTIFY = "false";
      const { isNotifyEnabled } = await loadNotify();
      expect(isNotifyEnabled()).toBe(false);
    });

    it("returns false on non-darwin platform even when LEAP_NOTIFY is 'true'", async () => {
      process.env.LEAP_NOTIFY = "true";
      Object.defineProperty(process, "platform", { value: "linux", configurable: true });
      const { isNotifyEnabled } = await loadNotify();
      expect(isNotifyEnabled()).toBe(false);
      Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
    });

    it("returns true when LEAP_NOTIFY is 'true' and platform is darwin", async () => {
      process.env.LEAP_NOTIFY = "true";
      Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
      const { isNotifyEnabled } = await loadNotify();
      expect(isNotifyEnabled()).toBe(true);
    });
  });

  // ── chime ───────────────────────────────────────────────────────────

  describe("chime()", () => {
    it("does not throw when sound is disabled (LEAP_SOUND unset)", async () => {
      delete process.env.LEAP_SOUND;
      const { chime } = await loadNotify();
      expect(() => chime()).not.toThrow();
    });

    it("does not throw when LEAP_SOUND is 'false'", async () => {
      process.env.LEAP_SOUND = "false";
      const { chime } = await loadNotify();
      expect(() => chime()).not.toThrow();
    });

    it("does not throw with explicit volume when sound is disabled", async () => {
      delete process.env.LEAP_SOUND;
      const { chime } = await loadNotify();
      expect(() => chime(0.8)).not.toThrow();
    });
  });

  // ── alert ───────────────────────────────────────────────────────────

  describe("alert()", () => {
    it("does not throw when notifications are disabled (LEAP_NOTIFY unset)", async () => {
      delete process.env.LEAP_NOTIFY;
      const { alert } = await loadNotify();
      expect(() => alert("Test Title", "Test Message")).not.toThrow();
    });

    it("does not throw when LEAP_NOTIFY is 'false'", async () => {
      process.env.LEAP_NOTIFY = "false";
      const { alert } = await loadNotify();
      expect(() => alert("Title", "Body")).not.toThrow();
    });

    it("does not throw with special characters when notifications are disabled", async () => {
      delete process.env.LEAP_NOTIFY;
      const { alert } = await loadNotify();
      expect(() => alert('He said "hello"', "It's a test")).not.toThrow();
    });
  });

  // ── playSound ───────────────────────────────────────────────────────

  describe("playSound()", () => {
    it("does not throw with a nonexistent file when sound is disabled", async () => {
      delete process.env.LEAP_SOUND;
      const { playSound } = await loadNotify();
      expect(() => playSound("/nonexistent/sound.mp3")).not.toThrow();
    });

    it("does not throw with custom volume when sound is disabled", async () => {
      process.env.LEAP_SOUND = "false";
      const { playSound } = await loadNotify();
      expect(() => playSound("/nonexistent/sound.mp3", 0.3)).not.toThrow();
    });

    it("returns undefined (no-op) when sound is disabled", async () => {
      delete process.env.LEAP_SOUND;
      const { playSound } = await loadNotify();
      const result = playSound("/tmp/fake.wav");
      expect(result).toBeUndefined();
    });
  });
});
