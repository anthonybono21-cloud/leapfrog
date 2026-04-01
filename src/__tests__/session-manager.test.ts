import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SessionManager } from '../session-manager.js';

// ---------------------------------------------------------------------------
// Integration tests — uses a REAL Playwright browser (fast enough for CI)
// ---------------------------------------------------------------------------

describe('SessionManager', () => {
  let manager: SessionManager;

  beforeAll(() => {
    manager = new SessionManager({ maxSessions: 3, idleTimeoutMs: 2000 });
  });

  afterAll(async () => {
    await manager.destroyAll();
  });

  // ── Session creation ──────────────────────────────────────────────

  it('creates a session with a valid ID format (s_ + 6 chars)', async () => {
    const session = await manager.createSession();
    expect(session.id).toMatch(/^s_[a-z0-9]{6}$/);
    // Clean up
    await manager.destroySession(session.id);
  });

  it('creates multiple sessions with unique IDs', async () => {
    const s1 = await manager.createSession();
    const s2 = await manager.createSession();
    const s3 = await manager.createSession();

    expect(s1.id).not.toBe(s2.id);
    expect(s2.id).not.toBe(s3.id);
    expect(s1.id).not.toBe(s3.id);

    // Clean up
    await manager.destroySession(s1.id);
    await manager.destroySession(s2.id);
    await manager.destroySession(s3.id);
  });

  // ── Pool limit ────────────────────────────────────────────────────

  it('throws when pool is full (maxSessions: 3)', async () => {
    const s1 = await manager.createSession();
    const s2 = await manager.createSession();
    const s3 = await manager.createSession();

    // Fourth should throw
    await expect(manager.createSession()).rejects.toThrow(/Session pool full/);

    // Clean up
    await manager.destroySession(s1.id);
    await manager.destroySession(s2.id);
    await manager.destroySession(s3.id);
  });

  // ── Destroy ───────────────────────────────────────────────────────

  it('removes session from list after destroy', async () => {
    const session = await manager.createSession();
    const id = session.id;

    expect(manager.getSession(id)).toBeDefined();
    await manager.destroySession(id);
    expect(manager.getSession(id)).toBeUndefined();
  });

  it('does not throw when destroying a nonexistent session', async () => {
    // Should resolve without error
    await expect(manager.destroySession('s_nope00')).resolves.toBeUndefined();
  });

  // ── List ──────────────────────────────────────────────────────────

  it('lists the correct number of sessions', async () => {
    const s1 = await manager.createSession();
    const s2 = await manager.createSession();

    const list = manager.listSessions();
    expect(list.length).toBe(2);

    const ids = list.map(s => s.id);
    expect(ids).toContain(s1.id);
    expect(ids).toContain(s2.id);

    await manager.destroySession(s1.id);
    await manager.destroySession(s2.id);
  });

  it('list is empty after destroying all sessions', async () => {
    const s1 = await manager.createSession();
    await manager.destroySession(s1.id);

    const list = manager.listSessions();
    expect(list.length).toBe(0);
  });

  // ── Stats ─────────────────────────────────────────────────────────

  it('reports accurate pool stats', async () => {
    const totalBefore = manager.getStats().totalCreated;

    const s1 = await manager.createSession();
    const s2 = await manager.createSession();

    const stats = manager.getStats();
    expect(stats.active).toBe(2);
    expect(stats.maxSessions).toBe(3);
    expect(stats.totalCreated).toBe(totalBefore + 2);

    await manager.destroySession(s1.id);

    const stats2 = manager.getStats();
    expect(stats2.active).toBe(1);
    expect(stats2.totalCreated).toBe(totalBefore + 2); // total doesn't decrease

    await manager.destroySession(s2.id);
  });

  // ── Resource usage ────────────────────────────────────────────────

  it('returns valid resource usage numbers', async () => {
    const usage = manager.getResourceUsage();

    expect(usage.heapUsedMB).toBeGreaterThan(0);
    expect(usage.rssMB).toBeGreaterThan(0);
    expect(usage.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(typeof usage.sessionsActive).toBe('number');
  });

  // ── Touch ─────────────────────────────────────────────────────────

  it('updates lastUsedAt when session is touched', async () => {
    const session = await manager.createSession();
    const before = session.lastUsedAt;

    // Small delay to ensure timestamp changes
    await new Promise(r => setTimeout(r, 50));
    manager.touchSession(session.id);

    const after = manager.getSession(session.id)!.lastUsedAt;
    expect(after).toBeGreaterThan(before);

    await manager.destroySession(session.id);
  });

  // ── Session properties ────────────────────────────────────────────

  it('creates sessions with proper initial state', async () => {
    const session = await manager.createSession();

    expect(session.refCounter).toBe(0);
    expect(session.refMap).toBeInstanceOf(Map);
    expect(session.refMap.size).toBe(0);
    expect(session.createdAt).toBeGreaterThan(0);
    expect(session.lastUsedAt).toBe(session.createdAt);
    expect(session.page).toBeDefined();
    expect(session.context).toBeDefined();

    await manager.destroySession(session.id);
  });

  // ── Session page is functional ────────────────────────────────────

  it('session page can navigate to a data URL', async () => {
    const session = await manager.createSession();

    // Navigate to a simple page via data URL — not blocked since it goes through page directly
    await session.page.setContent('<h1>Hello</h1>');
    const title = await session.page.locator('h1').textContent();
    expect(title).toBe('Hello');

    await manager.destroySession(session.id);
  });

  // ── Custom viewport ───────────────────────────────────────────────

  it('creates session with custom viewport', async () => {
    const session = await manager.createSession({
      viewport: { width: 800, height: 600 },
    });

    const size = session.page.viewportSize();
    expect(size).toEqual({ width: 800, height: 600 });

    await manager.destroySession(session.id);
  });

  // ── destroyAll cleans everything ──────────────────────────────────

  it('destroyAll removes all sessions and resets', async () => {
    // Create a fresh manager for this test so we don't affect others
    const mgr2 = new SessionManager({ maxSessions: 5 });
    await mgr2.createSession();
    await mgr2.createSession();

    expect(mgr2.getStats().active).toBe(2);

    await mgr2.destroyAll();
    expect(mgr2.getStats().active).toBe(0);
    expect(mgr2.listSessions().length).toBe(0);
  });
});
