import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SnapshotEngine } from '../snapshot-engine.js';
import type { Session } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal Session object for snapshot testing. */
function makeSession(overrides?: Partial<Session>): Session {
  return {
    id: 's_test01',
    context: {} as any,
    page: {} as any,
    pages: [],
    activePageIndex: 0,
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
    refCounter: 0,
    refMap: new Map(),
    networkLog: [],
    consoleLog: [],
    interceptRules: [],
    ...overrides,
  };
}

/** Build a mock Page whose ariaSnapshot returns the given YAML. */
function mockPage(yaml: string) {
  return {
    ariaSnapshot: vi.fn().mockResolvedValue(yaml),
    locator: vi.fn().mockReturnValue({
      first: () => ({
        ariaSnapshot: vi.fn().mockResolvedValue(yaml),
      }),
    }),
  } as any;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SnapshotEngine', () => {
  let engine: SnapshotEngine;

  beforeEach(() => {
    engine = new SnapshotEngine();
  });

  // ── Basic parsing ─────────────────────────────────────────────────

  it('parses simple YAML and returns correct refs and node count', async () => {
    const yaml = [
      '- button "Save" [ref=e1]',
      '- link "Home" [ref=e2]',
      '- textbox "Email" [ref=e3]',
    ].join('\n');

    const session = makeSession();
    const page = mockPage(yaml);
    const result = await engine.snapshot(page, session);

    expect(result.nodeCount).toBe(3);
    expect(result.refs.size).toBe(3);
    // Refs should be @e1, @e2, @e3 (refCounter started at 0, increments per kept node)
    expect(result.refs.has('@e1')).toBe(true);
    expect(result.refs.has('@e2')).toBe(true);
    expect(result.refs.has('@e3')).toBe(true);
    // Text should contain all three
    expect(result.text).toContain('button "Save"');
    expect(result.text).toContain('link "Home"');
    expect(result.text).toContain('textbox "Email"');
  });

  // ── Nested structure ──────────────────────────────────────────────

  it('parses nested YAML with correct parent-child indentation', async () => {
    const yaml = [
      '- navigation "Main" [ref=e1]:',
      '  - link "Home" [ref=e2]',
      '  - link "About" [ref=e3]',
    ].join('\n');

    const session = makeSession();
    const page = mockPage(yaml);
    // interactiveOnly=false to see the navigation group too
    const result = await engine.snapshot(page, session, { interactiveOnly: false });

    expect(result.nodeCount).toBeGreaterThanOrEqual(2);
    // Links should be indented in the output
    expect(result.text).toContain('link "Home"');
    expect(result.text).toContain('link "About"');
  });

  // ── Interactive-only filtering ────────────────────────────────────

  it('filters to interactive elements only by default', async () => {
    const yaml = [
      '- generic "wrapper" [ref=e1]:',
      '  - button "OK" [ref=e2]',
      '  - paragraph "Some description" [ref=e3]',
      '  - link "More" [ref=e4]',
    ].join('\n');

    const session = makeSession();
    const page = mockPage(yaml);
    // Default: interactiveOnly = true
    const result = await engine.snapshot(page, session);

    // Button and link should be kept, generic wrapper and paragraph should be skipped
    expect(result.text).toContain('button "OK"');
    expect(result.text).toContain('link "More"');
    expect(result.text).not.toContain('generic');
    // paragraph is not interactive and not structural, so filtered out in interactiveOnly
    expect(result.text).not.toContain('paragraph');
  });

  // ── Heading levels ────────────────────────────────────────────────

  it('parses heading levels correctly', async () => {
    const yaml = [
      '- heading "Welcome" [level=1] [ref=e1]',
      '- heading "Section" [level=2] [ref=e2]',
      '- heading "Subsection" [level=3] [ref=e3]',
    ].join('\n');

    const session = makeSession();
    const page = mockPage(yaml);
    const result = await engine.snapshot(page, session);

    expect(result.text).toContain('heading "Welcome" (h1)');
    expect(result.text).toContain('heading "Section" (h2)');
    expect(result.text).toContain('heading "Subsection" (h3)');
    expect(result.nodeCount).toBe(3);
  });

  // ── Value attributes preserved ────────────────────────────────────

  it('preserves value attributes on textbox nodes', async () => {
    const yaml = '- textbox "Username" [ref=e1]: "johndoe"';

    const session = makeSession();
    const page = mockPage(yaml);
    const result = await engine.snapshot(page, session);

    expect(result.text).toContain('textbox "Username"');
    expect(result.text).toContain('value="johndoe"');
    expect(result.nodeCount).toBe(1);
  });

  // ── Ref counter increments across calls ───────────────────────────

  it('increments ref counter across multiple snapshot calls', async () => {
    const yaml = '- button "One" [ref=e1]';

    const session = makeSession();
    const page = mockPage(yaml);

    // First snapshot
    const r1 = await engine.snapshot(page, session);
    expect(r1.refs.has('@e1')).toBe(true);
    expect(session.refCounter).toBe(1);

    // Second snapshot — refCounter continues from 1
    const r2 = await engine.snapshot(page, session);
    expect(r2.refs.has('@e2')).toBe(true);
    expect(session.refCounter).toBe(2);

    // Third snapshot
    const r3 = await engine.snapshot(page, session);
    expect(r3.refs.has('@e3')).toBe(true);
    expect(session.refCounter).toBe(3);
  });

  // ── maxChars truncation ───────────────────────────────────────────

  it('truncates output at maxChars limit', async () => {
    // Build a YAML with lots of buttons to exceed a small char limit
    const lines: string[] = [];
    for (let i = 1; i <= 50; i++) {
      lines.push(`- button "Button number ${i} with a fairly long label" [ref=e${i}]`);
    }
    const yaml = lines.join('\n');

    const session = makeSession();
    const page = mockPage(yaml);
    const result = await engine.snapshot(page, session, { maxChars: 200 });

    expect(result.text.length).toBeLessThanOrEqual(220); // 200 + "... (truncated)" line
    expect(result.text).toContain('... (truncated)');
    // Not all 50 buttons should appear
    expect(result.nodeCount).toBeLessThan(50);
  });

  // ── Empty / blank YAML ────────────────────────────────────────────

  it('handles empty YAML gracefully', async () => {
    const session = makeSession();
    const page = mockPage('');
    const result = await engine.snapshot(page, session);

    expect(result.text).toBe('(page not loaded or empty)');
    expect(result.nodeCount).toBe(0);
  });

  it('handles whitespace-only YAML gracefully', async () => {
    const session = makeSession();
    const page = mockPage('   \n  \n  ');
    const result = await engine.snapshot(page, session);

    expect(result.text).toBe('(page not loaded or empty)');
    expect(result.nodeCount).toBe(0);
  });

  it('handles ariaSnapshot throwing an error gracefully', async () => {
    const page = {
      ariaSnapshot: vi.fn().mockRejectedValue(new Error('Page crashed')),
      locator: vi.fn(),
    } as any;

    const session = makeSession();
    const result = await engine.snapshot(page, session);

    expect(result.text).toBe('(page not loaded or empty)');
    expect(result.nodeCount).toBe(0);
  });

  // ── Scoped snapshot via selector ──────────────────────────────────

  it('uses locator for scoped snapshot when selector is provided', async () => {
    const yaml = '- button "Scoped" [ref=e1]';

    const scopedAriaSnapshot = vi.fn().mockResolvedValue(yaml);
    const page = {
      ariaSnapshot: vi.fn().mockResolvedValue('- button "Full page" [ref=e99]'),
      locator: vi.fn().mockReturnValue({
        first: () => ({
          ariaSnapshot: scopedAriaSnapshot,
        }),
      }),
    } as any;

    const session = makeSession();
    const result = await engine.snapshot(page, session, { selector: '#my-form' });

    // Should have used the locator path, not the page-level snapshot
    expect(page.locator).toHaveBeenCalledWith('#my-form');
    expect(scopedAriaSnapshot).toHaveBeenCalled();
    expect(page.ariaSnapshot).not.toHaveBeenCalled();
    expect(result.text).toContain('button "Scoped"');
  });

  // ── Checkbox/radio checked state ──────────────────────────────────

  it('renders checked state for checkboxes', async () => {
    const yaml = [
      '- checkbox "Accept" [checked=true] [ref=e1]',
      '- checkbox "Optional" [ref=e2]',
    ].join('\n');

    const session = makeSession();
    const page = mockPage(yaml);
    const result = await engine.snapshot(page, session);

    expect(result.text).toContain('checkbox "Accept" checked');
    expect(result.text).toContain('checkbox "Optional"');
    // "Optional" should NOT have "checked" in its line
    const lines = result.text.split('\n');
    const optionalLine = lines.find(l => l.includes('Optional'));
    expect(optionalLine).not.toContain('checked');
  });

  // ── Disabled state ────────────────────────────────────────────────

  it('renders disabled state', async () => {
    const yaml = '- button "Submit" [disabled=true] [ref=e1]';

    const session = makeSession();
    const page = mockPage(yaml);
    const result = await engine.snapshot(page, session);

    expect(result.text).toContain('button "Submit" disabled');
  });

  // ── Expanded / collapsed ──────────────────────────────────────────

  it('renders expanded and collapsed states', async () => {
    const yaml = [
      '- button "Menu" [expanded=true] [ref=e1]',
      '- button "Drawer" [expanded=false] [ref=e2]',
    ].join('\n');

    const session = makeSession();
    const page = mockPage(yaml);
    const result = await engine.snapshot(page, session);

    expect(result.text).toContain('button "Menu" expanded');
    expect(result.text).toContain('button "Drawer" collapsed');
  });

  // ── No interactive elements ───────────────────────────────────────

  it('returns descriptive message when no interactive elements found', async () => {
    const yaml = [
      '- generic [ref=e1]',
      '- presentation [ref=e2]',
    ].join('\n');

    const session = makeSession();
    const page = mockPage(yaml);
    const result = await engine.snapshot(page, session);

    expect(result.text).toBe('(no interactive elements found)');
    expect(result.nodeCount).toBe(0);
  });

  // ── Named image kept ──────────────────────────────────────────────

  it('keeps named img elements even in interactive-only mode', async () => {
    const yaml = [
      '- img "Company Logo" [ref=e1]',
      '- img [ref=e2]',
      '- button "Click" [ref=e3]',
    ].join('\n');

    const session = makeSession();
    const page = mockPage(yaml);
    const result = await engine.snapshot(page, session);

    expect(result.text).toContain('img "Company Logo"');
    expect(result.text).toContain('button "Click"');
    // Unnamed img should be filtered in interactive-only mode
    expect(result.nodeCount).toBe(2);
  });

  // ── Combobox, select, switch — diverse interactive roles ──────────

  it('keeps combobox, switch, and slider roles', async () => {
    const yaml = [
      '- combobox "Country" [ref=e1]',
      '- switch "Dark mode" [ref=e2]',
      '- slider "Volume" [ref=e3]',
    ].join('\n');

    const session = makeSession();
    const page = mockPage(yaml);
    const result = await engine.snapshot(page, session);

    expect(result.nodeCount).toBe(3);
    expect(result.text).toContain('combobox "Country"');
    expect(result.text).toContain('switch "Dark mode"');
    expect(result.text).toContain('slider "Volume"');
  });

  // ── Ref map contains correct Playwright selectors ─────────────────

  it('maps refs to aria-ref selectors from the YAML', async () => {
    const yaml = [
      '- button "Save" [ref=e5]',
      '- link "Home" [ref=e12]',
    ].join('\n');

    const session = makeSession();
    const page = mockPage(yaml);
    const result = await engine.snapshot(page, session);

    // The ref map should map our @eN to the Playwright aria-ref=eN selector
    expect(result.refs.get('@e1')).toBe('aria-ref=e5');
    expect(result.refs.get('@e2')).toBe('aria-ref=e12');
  });

  // ── Deep nesting respects maxDepth ────────────────────────────────

  it('respects maxDepth and does not render nodes beyond it', async () => {
    // 4 levels deep
    const yaml = [
      '- group "L0" [ref=e1]:',
      '  - group "L1" [ref=e2]:',
      '    - group "L2" [ref=e3]:',
      '      - button "Deep" [ref=e4]',
    ].join('\n');

    const session = makeSession();
    const page = mockPage(yaml);
    // maxDepth=1 should cut off before the button at depth 3
    const result = await engine.snapshot(page, session, { interactiveOnly: false, maxDepth: 1 });

    expect(result.text).not.toContain('button "Deep"');
  });
});
