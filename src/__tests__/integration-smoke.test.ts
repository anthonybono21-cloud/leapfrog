/**
 * Integration smoke test — verifies the real Playwright ariaSnapshot API works
 * end-to-end with SessionManager + SnapshotEngine after a Playwright version upgrade.
 *
 * This test launches a real headless browser, navigates to a data: URL, takes a
 * snapshot, verifies refs are generated, and tears down the session.
 */
import { describe, it, expect, afterAll } from "vitest";
import { SessionManager } from "../session-manager.js";
import { SnapshotEngine } from "../snapshot-engine.js";
import { tabManager } from "../tab-manager.js";

describe("Integration smoke test", () => {
  const manager = new SessionManager({ headless: true });
  const engine = new SnapshotEngine();

  afterAll(async () => {
    await manager.destroyAll();
  });

  it("creates a session, navigates to a data: URL, takes a snapshot with real refs", async () => {
    // 1. Create a session
    const session = await manager.createSession();
    expect(session.id).toBeTruthy();

    // 2. Navigate to a data: URL with button + link + textbox
    const page = tabManager.getActivePage(session);
    const html = `
      <!DOCTYPE html>
      <html><head><title>Smoke Test</title></head>
      <body>
        <h1>Smoke Test</h1>
        <a href="#home">Home Link</a>
        <button>Click Me</button>
        <input type="text" aria-label="Username" value="ted">
        <input type="checkbox" aria-label="Remember me">
      </body></html>
    `;
    await page.goto(`data:text/html,${encodeURIComponent(html)}`);
    await page.waitForLoadState("domcontentloaded");

    // 3. Take a snapshot
    const result = await engine.snapshot(page, session);

    // 4. Verify results
    // Should find interactive elements: link, button, textbox, checkbox, heading
    expect(result.nodeCount).toBeGreaterThanOrEqual(4);

    // Refs should be generated
    expect(result.refs.size).toBeGreaterThanOrEqual(4);

    // Text should contain our elements
    expect(result.text).toContain("link");
    expect(result.text).toContain("Home Link");
    expect(result.text).toContain("button");
    expect(result.text).toContain("Click Me");
    expect(result.text).toContain("textbox");
    expect(result.text).toContain("Username");
    expect(result.text).toContain("checkbox");

    // Refs should map to aria-ref selectors (meaning real ariaSnapshot mode: "ai" returned refs)
    const refValues = Array.from(result.refs.values());
    const hasAriaRefs = refValues.some((v) => v.startsWith("aria-ref="));
    expect(hasAriaRefs).toBe(true);

    // Note: value attribute may or may not appear depending on how the browser
    // serializes the aria snapshot for default input values vs user-typed values.
    // The critical assertion is that the textbox itself was found.

    // 5. Destroy the session
    await manager.destroySession(session.id);
    expect(manager.getSession(session.id)).toBeUndefined();
  }, 15000); // generous timeout for browser launch
});
