/**
 * BENCHMARK — Real-World Website Token Measurement
 *
 * Tests against real websites to get realistic token counts.
 * These numbers are the ones that matter for the "12x" claim.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { SessionManager } from "../session-manager.js";
import { SnapshotEngine } from "../snapshot-engine.js";
import { tabManager } from "../tab-manager.js";
import type { Session } from "../types.js";

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

describe("BENCHMARK: Real-World Token Efficiency", () => {
  let manager: SessionManager;
  let engine: SnapshotEngine;
  let session: Session;

  beforeAll(async () => {
    manager = new SessionManager({ headless: true });
    engine = new SnapshotEngine();
    session = await manager.createSession();
  }, 30000);

  afterAll(async () => {
    await manager.destroyAll();
  });

  const realPages = [
    { name: "example.com (minimal)", url: "https://example.com" },
    { name: "Hacker News (content-heavy)", url: "https://news.ycombinator.com" },
    { name: "GitHub.com (complex SPA)", url: "https://github.com" },
  ];

  for (const { name, url } of realPages) {
    it(`REAL: ${name}`, async () => {
      const page = tabManager.getActivePage(session);

      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
        // Brief settle
        await new Promise(r => setTimeout(r, 1000));
      } catch (e: any) {
        console.log(`  [SKIP] ${name}: ${e.message}`);
        return;
      }

      // 1. Raw Playwright aria snapshot
      let rawYaml: string;
      try {
        rawYaml = await page.ariaSnapshot({ mode: "ai" });
      } catch {
        console.log(`  [SKIP] ${name}: ariaSnapshot failed`);
        return;
      }
      const rawChars = rawYaml.length;
      const rawTokens = estimateTokens(rawYaml);

      // 2. Leapfrog interactive snapshot
      const leapResult = await engine.snapshot(page, session, {
        interactiveOnly: true,
        maxChars: 10000,
      });
      const leapChars = leapResult.text.length;
      const leapTokens = estimateTokens(leapResult.text);

      // 3. Full page HTML
      const fullHtml = await page.content();
      const htmlChars = fullHtml.length;
      const htmlTokens = estimateTokens(fullHtml);

      // 4. Playwright MCP simulated output
      const title = await page.title();
      const playwrightMcpOutput = `- Page URL: ${url}\n- Page Title: ${title}\n\n### Accessibility snapshot\n\n${rawYaml}`;
      const pwmcpChars = playwrightMcpOutput.length;
      const pwmcpTokens = estimateTokens(playwrightMcpOutput);

      // 5. Leapfrog full output
      const leapfrogOutput = `[${session.id}] ${title}\n${url}\n${leapResult.nodeCount} elements\n\n${leapResult.text}`;
      const lfOutChars = leapfrogOutput.length;
      const lfOutTokens = estimateTokens(leapfrogOutput);

      const ratioRaw = rawChars / leapChars;
      const ratioHtml = htmlChars / leapChars;
      const ratioPwMcp = pwmcpChars / lfOutChars;

      console.log(`\n[REAL] ${name} (${url}):`);
      console.log(`  Full HTML:              ${htmlChars.toLocaleString()} chars (~${htmlTokens.toLocaleString()} tokens)`);
      console.log(`  Raw ARIA snapshot:      ${rawChars.toLocaleString()} chars (~${rawTokens.toLocaleString()} tokens)`);
      console.log(`  Playwright MCP output:  ${pwmcpChars.toLocaleString()} chars (~${pwmcpTokens.toLocaleString()} tokens)`);
      console.log(`  Leapfrog output:        ${lfOutChars.toLocaleString()} chars (~${lfOutTokens.toLocaleString()} tokens) [${leapResult.nodeCount} nodes]`);
      console.log(`  ---`);
      console.log(`  vs Raw ARIA:            ${ratioRaw.toFixed(1)}x compression`);
      console.log(`  vs Full HTML:           ${ratioHtml.toFixed(1)}x compression`);
      console.log(`  vs Playwright MCP:      ${ratioPwMcp.toFixed(1)}x compression`);

      expect(leapChars).toBeLessThan(rawChars);
    }, 30000);
  }

  it("REAL: large page simulation (Wikipedia-scale content)", async () => {
    // Build a page that simulates a real-world website with:
    // - Large navigation (20+ links)
    // - Content sections with paragraphs
    // - Sidebars
    // - Forms
    // - Tables
    // - Footer
    // This approximates what a real Wikipedia/news article page looks like to the a11y tree.
    const page = tabManager.getActivePage(session);

    const navLinks = Array.from({ length: 25 }, (_, i) =>
      `<a href="#nav-${i}">Nav Item ${i}</a>`
    ).join("\n");

    const articles = Array.from({ length: 10 }, (_, i) => `
      <article>
        <h2>Article Section ${i}</h2>
        <p>${"Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(5)}</p>
        <p>${"Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ".repeat(3)}</p>
        <a href="#article-${i}">Read more about section ${i}</a>
        <button>Share Article ${i}</button>
      </article>`).join("\n");

    const tableRows = Array.from({ length: 20 }, (_, i) =>
      `<tr><td>Row ${i} Col 1</td><td>Row ${i} Col 2</td><td>Row ${i} Col 3</td><td><a href="#edit-${i}">Edit</a></td></tr>`
    ).join("\n");

    const sidebarLinks = Array.from({ length: 15 }, (_, i) =>
      `<a href="#side-${i}">Related Topic ${i}</a>`
    ).join("<br>\n");

    const footerLinks = Array.from({ length: 12 }, (_, i) =>
      `<a href="#footer-${i}">Footer Link ${i}</a>`
    ).join("\n");

    const largeHtml = `<!DOCTYPE html>
<html><head><title>Simulated Large Page — Wiki-scale Content</title></head>
<body>
  <header>
    <h1>Large Content Page Simulation</h1>
    <nav aria-label="Main navigation">${navLinks}</nav>
    <form role="search">
      <input type="search" aria-label="Search" placeholder="Search...">
      <button type="submit">Search</button>
    </form>
  </header>
  <main>
    <nav aria-label="Table of contents">
      ${Array.from({ length: 10 }, (_, i) => `<a href="#section-${i}">Section ${i}</a>`).join("\n")}
    </nav>
    ${articles}
    <section>
      <h2>Data Table</h2>
      <table aria-label="Data table">
        <thead><tr><th>Column 1</th><th>Column 2</th><th>Column 3</th><th>Actions</th></tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
      <nav aria-label="Pagination">
        <button>First</button>
        <button>Previous</button>
        ${Array.from({ length: 5 }, (_, i) => `<button aria-label="Page ${i + 1}">${i + 1}</button>`).join("")}
        <button>Next</button>
        <button>Last</button>
      </nav>
    </section>
    <aside aria-label="Sidebar">
      <h3>Related Topics</h3>
      ${sidebarLinks}
    </aside>
    <section>
      <h2>Contact Form</h2>
      <form>
        <input type="text" aria-label="Name" placeholder="Name">
        <input type="email" aria-label="Email" placeholder="Email">
        <textarea aria-label="Message" placeholder="Your message"></textarea>
        <select aria-label="Department">
          <option>General</option><option>Support</option><option>Sales</option><option>Press</option>
        </select>
        <input type="checkbox" aria-label="Subscribe to newsletter">
        <input type="checkbox" aria-label="Accept privacy policy">
        <button type="submit">Send Message</button>
        <button type="reset">Clear</button>
      </form>
    </section>
  </main>
  <footer>
    <nav aria-label="Footer navigation">${footerLinks}</nav>
    <p>Copyright 2026 Example Corp. All rights reserved.</p>
  </footer>
</body></html>`;

    await page.setContent(largeHtml);
    await page.waitForLoadState("domcontentloaded");

    // Measure all representations
    const rawYaml = await page.ariaSnapshot({ mode: "ai" });
    const fullHtml = await page.content();
    const title = await page.title();

    const leapResult = await engine.snapshot(page, session, { interactiveOnly: true, maxChars: 10000 });
    const leapFullResult = await engine.snapshot(page, session, { interactiveOnly: false, maxChars: 50000 });

    const playwrightMcpOutput = `- Page URL: ${page.url()}\n- Page Title: ${title}\n\n### Accessibility snapshot\n\n${rawYaml}`;
    const leapfrogOutput = `[${session.id}] ${title}\n${page.url()}\n${leapResult.nodeCount} elements\n\n${leapResult.text}`;

    const data = {
      fullHtml: { chars: fullHtml.length, tokens: estimateTokens(fullHtml) },
      rawAria: { chars: rawYaml.length, tokens: estimateTokens(rawYaml) },
      playwrightMcp: { chars: playwrightMcpOutput.length, tokens: estimateTokens(playwrightMcpOutput) },
      leapfrogInteractive: { chars: leapResult.text.length, tokens: estimateTokens(leapResult.text), nodes: leapResult.nodeCount },
      leapfrogFull: { chars: leapFullResult.text.length, tokens: estimateTokens(leapFullResult.text), nodes: leapFullResult.nodeCount },
      leapfrogOutput: { chars: leapfrogOutput.length, tokens: estimateTokens(leapfrogOutput) },
    };

    const ratioVsRawAria = data.rawAria.chars / data.leapfrogInteractive.chars;
    const ratioVsHtml = data.fullHtml.chars / data.leapfrogInteractive.chars;
    const ratioVsPwMcp = data.playwrightMcp.chars / data.leapfrogOutput.chars;

    console.log(`\n[LARGE PAGE SIMULATION] Wikipedia-scale (~100 interactive elements):`);
    console.log(`  Full HTML:              ${data.fullHtml.chars.toLocaleString()} chars (~${data.fullHtml.tokens.toLocaleString()} tokens)`);
    console.log(`  Raw ARIA snapshot:      ${data.rawAria.chars.toLocaleString()} chars (~${data.rawAria.tokens.toLocaleString()} tokens)`);
    console.log(`  Playwright MCP output:  ${data.playwrightMcp.chars.toLocaleString()} chars (~${data.playwrightMcp.tokens.toLocaleString()} tokens)`);
    console.log(`  Leapfrog (interactive): ${data.leapfrogInteractive.chars.toLocaleString()} chars (~${data.leapfrogInteractive.tokens.toLocaleString()} tokens) [${data.leapfrogInteractive.nodes} nodes]`);
    console.log(`  Leapfrog (full):        ${data.leapfrogFull.chars.toLocaleString()} chars (~${data.leapfrogFull.tokens.toLocaleString()} tokens) [${data.leapfrogFull.nodes} nodes]`);
    console.log(`  ---`);
    console.log(`  vs Raw ARIA:            ${ratioVsRawAria.toFixed(1)}x`);
    console.log(`  vs Full HTML:           ${ratioVsHtml.toFixed(1)}x`);
    console.log(`  vs Playwright MCP:      ${ratioVsPwMcp.toFixed(1)}x`);
    console.log(`  ---`);
    console.log(`  TOKEN HEADLINE NUMBER:  Playwright MCP ~${data.playwrightMcp.tokens.toLocaleString()} tokens → Leapfrog ~${data.leapfrogOutput.tokens ? estimateTokens(leapfrogOutput).toLocaleString() : "N/A"} tokens`);

    expect(data.leapfrogInteractive.chars).toBeLessThan(data.rawAria.chars);
  }, 30000);
});
