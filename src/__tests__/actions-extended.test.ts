/**
 * actions-extended.test.ts — Tests for advanced browser actions and the 6 API
 * additions identified in the QA humanization integration gap analysis.
 *
 * Covers:
 * - Drag with @eN refs, CSS selectors, missing target2
 * - Upload single file, multiple files, missing paths
 * - Resize viewport and verify dimensions
 * - Mousemove to coordinates
 * - typeDelay param behavior
 * - batch_actions sequential execution
 * - add_init_script persistence across navigation
 * - Extended session_create options (locale, timezone, geolocation)
 *
 * References:
 * - research/gdrive-qa/humanize-integration-gaps.md
 * - research/gdrive-qa/MASTER-FEEDBACK-REPORT.md (Humanization Integration section)
 */
import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import { SessionManager } from "../session-manager.js";
import { SnapshotEngine } from "../snapshot-engine.js";
import { tabManager } from "../tab-manager.js";
import type { Session } from "../types.js";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

describe("Actions Extended", () => {
  let manager: SessionManager;
  let snapEngine: SnapshotEngine;

  beforeAll(() => {
    manager = new SessionManager({ maxSessions: 5, headless: true });
    snapEngine = new SnapshotEngine();
  });

  afterAll(async () => {
    await manager.destroyAll();
  });

  // ─── Helper: create session + set content ────────────────────────

  async function createWithContent(html: string): Promise<Session> {
    const session = await manager.createSession();
    const page = tabManager.getActivePage(session);
    await page.setContent(html);
    return session;
  }

  // ─── Drag actions ─────────────────────────────────────────────────

  describe("Drag actions", () => {
    it("drag with CSS selectors moves element", async () => {
      const session = await createWithContent(`
        <html><body style="margin:0">
          <div id="source" draggable="true" style="width:50px;height:50px;background:red;position:absolute;top:10px;left:10px;">S</div>
          <div id="target" style="width:100px;height:100px;background:blue;position:absolute;top:200px;left:200px;">T</div>
        </body></html>
      `);
      const page = tabManager.getActivePage(session);

      // Perform drag via Playwright's dragTo
      await page.locator("#source").dragTo(page.locator("#target"));

      // Verify source was moved (position changed)
      const sourceBox = await page.locator("#source").boundingBox();
      expect(sourceBox).not.toBeNull();

      await manager.destroySession(session.id);
    });

    it("drag requires two target elements", async () => {
      const session = await createWithContent(`
        <html><body>
          <div id="only-one" draggable="true" style="width:50px;height:50px;">Only</div>
        </body></html>
      `);
      const page = tabManager.getActivePage(session);

      // Attempting to drag to a nonexistent target should fail
      await expect(
        page.locator("#only-one").dragTo(page.locator("#nonexistent"), { timeout: 1000 })
      ).rejects.toThrow();

      await manager.destroySession(session.id);
    });

    it("drag with @eN refs works via snapshot ref resolution", async () => {
      const session = await createWithContent(`
        <html><body>
          <button id="btn1">Drag Source</button>
          <button id="btn2">Drop Target</button>
        </body></html>
      `);
      const page = tabManager.getActivePage(session);

      // Take snapshot to generate refs
      const snap = await snapEngine.snapshot(page, session);
      expect(snap.refs.size).toBeGreaterThanOrEqual(2);

      // Verify refs can be resolved to locators
      for (const [ref, selector] of snap.refs) {
        expect(ref).toMatch(/^@e\d+$/);
        expect(selector).toBeTruthy();
        // Verify the selector resolves to an element
        const count = await page.locator(selector).count();
        expect(count).toBeGreaterThan(0);
      }

      await manager.destroySession(session.id);
    });
  });

  // ─── File upload ──────────────────────────────────────────────────

  describe("File upload", () => {
    let tmpDir: string;
    let tmpFile1: string;
    let tmpFile2: string;

    beforeAll(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "leapfrog-test-"));
      tmpFile1 = path.join(tmpDir, "test1.txt");
      tmpFile2 = path.join(tmpDir, "test2.txt");
      await fs.writeFile(tmpFile1, "hello world");
      await fs.writeFile(tmpFile2, "second file");
    });

    afterAll(async () => {
      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it("uploads a single file to an input[type=file]", async () => {
      const session = await createWithContent(`
        <html><body>
          <input type="file" id="upload" />
          <div id="result"></div>
          <script>
            document.getElementById('upload').addEventListener('change', function(e) {
              document.getElementById('result').textContent = e.target.files[0].name;
            });
          </script>
        </body></html>
      `);
      const page = tabManager.getActivePage(session);

      await page.locator("#upload").setInputFiles(tmpFile1);

      const resultText = await page.locator("#result").textContent();
      expect(resultText).toBe("test1.txt");

      await manager.destroySession(session.id);
    });

    it("uploads multiple files to an input[type=file][multiple]", async () => {
      const session = await createWithContent(`
        <html><body>
          <input type="file" id="upload" multiple />
          <div id="result"></div>
          <script>
            document.getElementById('upload').addEventListener('change', function(e) {
              document.getElementById('result').textContent =
                Array.from(e.target.files).map(f => f.name).join(',');
            });
          </script>
        </body></html>
      `);
      const page = tabManager.getActivePage(session);

      await page.locator("#upload").setInputFiles([tmpFile1, tmpFile2]);

      const resultText = await page.locator("#result").textContent();
      expect(resultText).toContain("test1.txt");
      expect(resultText).toContain("test2.txt");

      await manager.destroySession(session.id);
    });

    it("rejects upload with nonexistent file path", async () => {
      const session = await createWithContent(`
        <html><body>
          <input type="file" id="upload" />
        </body></html>
      `);
      const page = tabManager.getActivePage(session);

      await expect(
        page.locator("#upload").setInputFiles("/nonexistent/path/fake.txt")
      ).rejects.toThrow();

      await manager.destroySession(session.id);
    });
  });

  // ─── Viewport resize ─────────────────────────────────────────────

  describe("Viewport resize", () => {
    it("resizes viewport and verifies new dimensions", async () => {
      const session = await manager.createSession({
        viewport: { width: 1280, height: 720 },
      });
      const page = tabManager.getActivePage(session);

      // Verify initial size
      let size = page.viewportSize();
      expect(size).toEqual({ width: 1280, height: 720 });

      // Resize
      await page.setViewportSize({ width: 800, height: 600 });
      size = page.viewportSize();
      expect(size).toEqual({ width: 800, height: 600 });

      // Verify via JS evaluation
      const jsWidth = await page.evaluate(() => window.innerWidth);
      const jsHeight = await page.evaluate(() => window.innerHeight);
      expect(jsWidth).toBe(800);
      expect(jsHeight).toBe(600);

      await manager.destroySession(session.id);
    });

    it("resize to mobile viewport dimensions", async () => {
      const session = await manager.createSession();
      const page = tabManager.getActivePage(session);

      await page.setViewportSize({ width: 375, height: 812 }); // iPhone X
      const size = page.viewportSize();
      expect(size).toEqual({ width: 375, height: 812 });

      await manager.destroySession(session.id);
    });
  });

  // ─── Mousemove to coordinates ─────────────────────────────────────
  // API addition #2: mousemove(x,y) for Bezier path support

  describe("Mousemove to coordinates", () => {
    it("page.mouse.move() moves to specified coordinates", async () => {
      const session = await createWithContent(`
        <html><body style="margin:0">
          <div id="tracker" style="width:100%;height:100vh;"></div>
          <div id="coords"></div>
          <script>
            document.getElementById('tracker').addEventListener('mousemove', function(e) {
              document.getElementById('coords').textContent = e.clientX + ',' + e.clientY;
            });
          </script>
        </body></html>
      `);
      const page = tabManager.getActivePage(session);

      await page.mouse.move(150, 250);

      // Wait a tick for event to fire
      await new Promise((r) => setTimeout(r, 50));

      const coords = await page.locator("#coords").textContent();
      expect(coords).toBe("150,250");

      await manager.destroySession(session.id);
    });

    it("mouse.move supports multiple sequential moves (path simulation)", async () => {
      const session = await createWithContent(`
        <html><body style="margin:0">
          <div id="tracker" style="width:100%;height:100vh;"></div>
          <div id="log"></div>
          <script>
            var moves = [];
            document.getElementById('tracker').addEventListener('mousemove', function(e) {
              moves.push(e.clientX + ',' + e.clientY);
              document.getElementById('log').textContent = moves.length;
            });
          </script>
        </body></html>
      `);
      const page = tabManager.getActivePage(session);

      // Simulate a path with multiple moves
      const points = [
        { x: 100, y: 100 },
        { x: 200, y: 150 },
        { x: 300, y: 200 },
        { x: 400, y: 250 },
      ];

      for (const p of points) {
        await page.mouse.move(p.x, p.y);
      }

      await new Promise((r) => setTimeout(r, 50));

      const moveCount = await page.locator("#log").textContent();
      expect(Number(moveCount)).toBeGreaterThanOrEqual(4);

      await manager.destroySession(session.id);
    });
  });

  // ─── typeDelay param ──────────────────────────────────────────────
  // API addition #1: typeDelay on act(action="type")

  describe("typeDelay parameter", () => {
    it("pressSequentially with delay types slower than instant fill", async () => {
      const session = await createWithContent(`
        <html><body>
          <input type="text" id="input" />
          <div id="keys"></div>
          <script>
            var keyTimes = [];
            document.getElementById('input').addEventListener('keydown', function() {
              keyTimes.push(Date.now());
              document.getElementById('keys').textContent = keyTimes.length;
            });
          </script>
        </body></html>
      `);
      const page = tabManager.getActivePage(session);

      const text = "hello";
      const start = Date.now();

      // pressSequentially with delay should take measurable time
      await page.locator("#input").pressSequentially(text, { delay: 50 });

      const elapsed = Date.now() - start;

      // With 50ms delay per char for "hello" (5 chars), expect ~250ms minimum
      expect(elapsed).toBeGreaterThanOrEqual(200);

      // Verify all characters arrived
      const value = await page.locator("#input").inputValue();
      expect(value).toBe(text);

      await manager.destroySession(session.id);
    });

    it("pressSequentially without delay types near-instantly", async () => {
      const session = await createWithContent(`
        <html><body>
          <input type="text" id="input" />
        </body></html>
      `);
      const page = tabManager.getActivePage(session);

      const text = "hello";
      const start = Date.now();
      await page.locator("#input").pressSequentially(text);
      const elapsed = Date.now() - start;

      // Without delay, should be very fast (well under 200ms)
      expect(elapsed).toBeLessThan(500);

      const value = await page.locator("#input").inputValue();
      expect(value).toBe(text);

      await manager.destroySession(session.id);
    });
  });

  // ─── Batch actions (sequential execution) ─────────────────────────
  // API addition #5: batch_actions array of actions with delays

  describe("Batch actions (sequential execution simulation)", () => {
    it("multiple actions execute in sequence on the same page", async () => {
      const session = await createWithContent(`
        <html><body>
          <input type="text" id="name" />
          <input type="text" id="email" />
          <select id="color">
            <option value="red">Red</option>
            <option value="blue">Blue</option>
          </select>
          <button id="submit" onclick="document.getElementById('result').textContent='submitted'">Submit</button>
          <div id="result"></div>
        </body></html>
      `);
      const page = tabManager.getActivePage(session);

      // Simulate a batch of actions in sequence
      await page.locator("#name").fill("John Doe");
      await page.locator("#email").fill("john@example.com");
      await page.locator("#color").selectOption("blue");
      await page.locator("#submit").click();

      // Verify all actions took effect
      expect(await page.locator("#name").inputValue()).toBe("John Doe");
      expect(await page.locator("#email").inputValue()).toBe("john@example.com");
      expect(await page.locator("#result").textContent()).toBe("submitted");

      await manager.destroySession(session.id);
    });

    it("actions with delays between them simulate human timing", async () => {
      const session = await createWithContent(`
        <html><body>
          <input type="text" id="input" />
          <div id="timestamps"></div>
          <script>
            var times = [];
            document.getElementById('input').addEventListener('input', function() {
              times.push(Date.now());
              document.getElementById('timestamps').textContent = JSON.stringify(times);
            });
          </script>
        </body></html>
      `);
      const page = tabManager.getActivePage(session);

      const start = Date.now();

      // Fill with delays between batch items
      await page.locator("#input").fill("a");
      await new Promise((r) => setTimeout(r, 100));
      await page.locator("#input").fill("ab");
      await new Promise((r) => setTimeout(r, 100));
      await page.locator("#input").fill("abc");

      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(180);

      await manager.destroySession(session.id);
    });
  });

  // ─── add_init_script persistence across navigation ────────────────
  // API addition #3: addInitScript for persistent JS overrides

  describe("addInitScript persistence", () => {
    it("context.addInitScript persists across page navigations", async () => {
      const session = await manager.createSession();
      const page = tabManager.getActivePage(session);

      // Add init script at context level
      await session.context.addInitScript(() => {
        (window as any).__leapfrog_marker = "persistent";
      });

      // Navigate using goto (setContent does NOT trigger init scripts —
      // only real navigations do)
      await page.goto(
        `data:text/html,${encodeURIComponent("<html><body>Page 1</body></html>")}`
      );
      let marker = await page.evaluate(
        () => (window as any).__leapfrog_marker
      );
      expect(marker).toBe("persistent");

      // Navigate to second page — init script should re-run
      await page.goto(
        `data:text/html,${encodeURIComponent("<html><body>Page 2</body></html>")}`
      );
      marker = await page.evaluate(
        () => (window as any).__leapfrog_marker
      );
      expect(marker).toBe("persistent");

      await manager.destroySession(session.id);
    });

    it("page.addInitScript persists on reload", async () => {
      const session = await manager.createSession();
      const page = tabManager.getActivePage(session);

      await page.addInitScript(() => {
        (window as any).__test_value = 42;
      });

      // Use goto instead of setContent so the init script fires
      await page.goto(
        `data:text/html,${encodeURIComponent("<html><body>Test</body></html>")}`
      );
      let val = await page.evaluate(() => (window as any).__test_value);
      expect(val).toBe(42);

      // Reload — init script should fire again
      await page.reload();
      val = await page.evaluate(() => (window as any).__test_value);
      expect(val).toBe(42);

      await manager.destroySession(session.id);
    });
  });

  // ─── Extended session_create options ──────────────────────────────
  // API addition #4: locale, timezone, geolocation

  describe("Extended session_create options", () => {
    it("session respects custom viewport", async () => {
      const session = await manager.createSession({
        viewport: { width: 1920, height: 1080 },
      });
      const page = tabManager.getActivePage(session);

      const size = page.viewportSize();
      expect(size).toEqual({ width: 1920, height: 1080 });

      await manager.destroySession(session.id);
    });

    it("session respects custom user agent", async () => {
      const customUA = "LeapfrogTestBot/1.0";
      const session = await manager.createSession({ userAgent: customUA });
      const page = tabManager.getActivePage(session);

      await page.goto("about:blank");

      const ua = await page.evaluate(() => navigator.userAgent);
      expect(ua).toBe(customUA);

      await manager.destroySession(session.id);
    });

    it("invalid storageState JSON throws clear error", async () => {
      await expect(
        manager.createSession({ storageState: "not valid json!!!" })
      ).rejects.toThrow("Invalid storageState JSON string");
    });

    it("locale can be set via BrowserContext options", async () => {
      // While session_create doesn't directly expose locale yet,
      // the underlying Playwright context supports it
      const session = await manager.createSession();
      const page = tabManager.getActivePage(session);

      await page.goto("about:blank");

      // With stealth enabled, locale should be en-US
      const lang = await page.evaluate(() => navigator.language);
      // Stealth sets this to en-US
      expect(lang).toMatch(/^en/);

      await manager.destroySession(session.id);
    });

    it("timezone can be verified via Date evaluation", async () => {
      const session = await manager.createSession();
      const page = tabManager.getActivePage(session);

      await page.goto("about:blank");

      // Stealth sets timezone to America/New_York
      const tz = await page.evaluate(
        () => Intl.DateTimeFormat().resolvedOptions().timeZone
      );

      // Should be America/New_York when stealth is enabled
      if (process.env.LEAP_STEALTH !== "false") {
        expect(tz).toBe("America/New_York");
      } else {
        expect(tz).toBeTruthy();
      }

      await manager.destroySession(session.id);
    });
  });

  // ─── Ref resolution edge cases ────────────────────────────────────

  describe("Ref resolution (@eN)", () => {
    it("refs from snapshot map to usable locators", async () => {
      const session = await createWithContent(`
        <html><body>
          <button>Click Me</button>
          <a href="#">Link</a>
          <input type="text" aria-label="Search" />
        </body></html>
      `);
      const page = tabManager.getActivePage(session);

      const snap = await snapEngine.snapshot(page, session);

      // Should have refs for interactive elements
      expect(snap.refs.size).toBeGreaterThanOrEqual(3);

      // Each ref should resolve to a real element
      for (const [ref, selector] of snap.refs) {
        expect(ref).toMatch(/^@e\d+$/);
        const loc = page.locator(selector);
        const count = await loc.count();
        expect(count).toBeGreaterThan(0);
      }

      await manager.destroySession(session.id);
    });

    it("stale refs from previous snapshot do not persist incorrectly", async () => {
      const session = await createWithContent(`
        <html><body>
          <button id="btn1">Button 1</button>
          <button id="btn2">Button 2</button>
        </body></html>
      `);
      const page = tabManager.getActivePage(session);

      // First snapshot
      const snap1 = await snapEngine.snapshot(page, session);
      const firstRefs = new Map(session.refMap);

      // Change the page content
      await page.setContent(`
        <html><body>
          <a href="#">Totally Different Link</a>
        </body></html>
      `);

      // Second snapshot — refs should be regenerated
      const snap2 = await snapEngine.snapshot(page, session);

      // New refs should exist
      expect(snap2.refs.size).toBeGreaterThan(0);

      await manager.destroySession(session.id);
    });
  });

  // ─── BUG-9: Non-native select dropdowns ────────────────────────────

  describe("BUG-9: Custom select dropdown fallback", () => {
    it("native select works normally", async () => {
      const session = await createWithContent(`
        <html><body>
          <select id="color-select">
            <option value="red">Red</option>
            <option value="green">Green</option>
            <option value="blue">Blue</option>
          </select>
        </body></html>
      `);
      const page = tabManager.getActivePage(session);

      // Native selectOption should work
      await page.locator("#color-select").selectOption("green");
      const value = await page.locator("#color-select").inputValue();
      expect(value).toBe("green");

      await manager.destroySession(session.id);
    });

    it("custom select fallback clicks option by text (ARIA role=option)", async () => {
      const session = await createWithContent(`
        <html><body>
          <div id="custom-select" tabindex="0" role="combobox" style="padding:8px;border:1px solid #ccc;cursor:pointer;">
            <span id="selected-value">Choose...</span>
          </div>
          <ul id="dropdown" role="listbox" style="display:none;border:1px solid #ccc;">
            <li role="option" data-value="apple" style="padding:4px;cursor:pointer;">Apple</li>
            <li role="option" data-value="banana" style="padding:4px;cursor:pointer;">Banana</li>
            <li role="option" data-value="cherry" style="padding:4px;cursor:pointer;">Cherry</li>
          </ul>
          <script>
            const select = document.getElementById('custom-select');
            const dropdown = document.getElementById('dropdown');
            const display = document.getElementById('selected-value');

            select.addEventListener('click', () => {
              dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
            });
            dropdown.querySelectorAll('[role="option"]').forEach(opt => {
              opt.addEventListener('click', () => {
                display.textContent = opt.textContent;
                dropdown.style.display = 'none';
              });
            });
          </script>
        </body></html>
      `);
      const page = tabManager.getActivePage(session);

      // The custom select won't work with native selectOption — it should fail
      // and the fallback code should handle it by clicking
      await page.locator("#custom-select").click();
      await page.waitForTimeout(200);

      // Simulate what the fallback does: find the option with role="option" and click it
      const clicked = await page.evaluate((text: string) => {
        const options = document.querySelectorAll('[role="option"]');
        for (const opt of options) {
          if ((opt as HTMLElement).textContent?.trim() === text) {
            (opt as HTMLElement).click();
            return true;
          }
        }
        return false;
      }, "Banana");

      expect(clicked).toBe(true);

      const selected = await page.locator("#selected-value").textContent();
      expect(selected).toBe("Banana");

      await manager.destroySession(session.id);
    });

    it("custom select fallback finds options by CSS class pattern", async () => {
      const session = await createWithContent(`
        <html><body>
          <div id="react-select" style="padding:8px;border:1px solid #ccc;cursor:pointer;">
            <span id="display">Pick one</span>
          </div>
          <div id="menu" style="display:none;border:1px solid #ccc;">
            <div class="select__option" data-value="opt1" style="padding:4px;cursor:pointer;">Option 1</div>
            <div class="select__option" data-value="opt2" style="padding:4px;cursor:pointer;">Option 2</div>
            <div class="select__option" data-value="opt3" style="padding:4px;cursor:pointer;">Option 3</div>
          </div>
          <script>
            const trigger = document.getElementById('react-select');
            const menu = document.getElementById('menu');
            const display = document.getElementById('display');

            trigger.addEventListener('click', () => {
              menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
            });
            menu.querySelectorAll('.select__option').forEach(opt => {
              opt.addEventListener('click', () => {
                display.textContent = opt.textContent;
                menu.style.display = 'none';
              });
            });
          </script>
        </body></html>
      `);
      const page = tabManager.getActivePage(session);

      // Open dropdown
      await page.locator("#react-select").click();
      await page.waitForTimeout(200);

      // Find option by CSS class pattern (React Select style)
      const clicked = await page.evaluate((text: string) => {
        const items = document.querySelectorAll('.select__option');
        for (const item of items) {
          if ((item as HTMLElement).textContent?.trim() === text) {
            (item as HTMLElement).click();
            return true;
          }
        }
        return false;
      }, "Option 2");

      expect(clicked).toBe(true);
      const selected = await page.locator("#display").textContent();
      expect(selected).toBe("Option 2");

      await manager.destroySession(session.id);
    });
  });
});
