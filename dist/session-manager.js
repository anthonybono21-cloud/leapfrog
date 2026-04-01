import { chromium } from "playwright";
const DEFAULT_CONFIG = {
    maxSessions: 10,
    idleTimeoutMs: 5 * 60 * 1000,
    cleanupIntervalMs: 30 * 1000,
    defaultViewport: { width: 1280, height: 720 },
    headless: true,
};
function generateId() {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let result = "s_";
    for (let i = 0; i < 6; i++) {
        result += chars[Math.floor(Math.random() * chars.length)];
    }
    return result;
}
export class SessionManager {
    config;
    sessions = new Map();
    browser = null;
    cleanupTimer = null;
    totalCreated = 0;
    constructor(config) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    // ── Browser lifecycle ──────────────────────────────────────────────
    async ensureBrowser() {
        if (this.browser?.isConnected()) {
            return this.browser;
        }
        // Previous browser crashed or was never launched — clean up stale state
        if (this.browser) {
            this.sessions.clear();
            this.browser = null;
        }
        this.browser = await chromium.launch({ headless: this.config.headless });
        this.startCleanupTimer();
        return this.browser;
    }
    startCleanupTimer() {
        if (this.cleanupTimer)
            return;
        this.cleanupTimer = setInterval(() => {
            this.sweepIdle().catch(() => {
                // Sweep errors are non-fatal — next tick will retry
            });
        }, this.config.cleanupIntervalMs);
        // Don't prevent Node from exiting
        if (this.cleanupTimer.unref) {
            this.cleanupTimer.unref();
        }
    }
    stopCleanupTimer() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
    }
    // ── Idle sweep ─────────────────────────────────────────────────────
    async sweepIdle() {
        const now = Date.now();
        const expired = [];
        for (const [id, session] of this.sessions) {
            if (now - session.lastUsedAt > this.config.idleTimeoutMs) {
                expired.push(id);
            }
        }
        await Promise.allSettled(expired.map((id) => this.destroySession(id)));
    }
    // ── Public API ─────────────────────────────────────────────────────
    async createSession(opts) {
        if (this.sessions.size >= this.config.maxSessions) {
            throw new Error(`Session pool full (${this.config.maxSessions}/${this.config.maxSessions}). ` +
                `Destroy an existing session first.`);
        }
        const browser = await this.ensureBrowser();
        const viewport = opts?.viewport ?? this.config.defaultViewport;
        // Build context options
        const contextOpts = { viewport };
        if (opts?.userAgent) {
            contextOpts.userAgent = opts.userAgent;
        }
        if (opts?.storageState) {
            try {
                contextOpts.storageState = JSON.parse(opts.storageState);
            }
            catch {
                throw new Error("Invalid storageState JSON string");
            }
        }
        else if (opts?.profilePath) {
            contextOpts.storageState = opts.profilePath;
        }
        const context = await browser.newContext(contextOpts);
        const page = await context.newPage();
        // Generate a unique short ID
        let id;
        do {
            id = generateId();
        } while (this.sessions.has(id));
        const now = Date.now();
        const session = {
            id,
            context,
            page,
            createdAt: now,
            lastUsedAt: now,
            refCounter: 0,
            refMap: new Map(),
            profilePath: opts?.profilePath,
        };
        this.sessions.set(id, session);
        this.totalCreated++;
        return session;
    }
    getSession(id) {
        return this.sessions.get(id);
    }
    touchSession(id) {
        const session = this.sessions.get(id);
        if (session) {
            session.lastUsedAt = Date.now();
        }
    }
    async destroySession(id) {
        const session = this.sessions.get(id);
        if (!session)
            return;
        this.sessions.delete(id);
        try {
            await session.context.close();
        }
        catch {
            // Context may already be closed (browser crash, manual close) — safe to ignore
        }
    }
    async destroyAll() {
        // Destroy all sessions first (closes contexts)
        await Promise.allSettled([...this.sessions.keys()].map((id) => this.destroySession(id)));
        this.stopCleanupTimer();
        if (this.browser) {
            try {
                await this.browser.close();
            }
            catch {
                // Browser may already be gone
            }
            this.browser = null;
        }
    }
    listSessions() {
        const result = [];
        for (const session of this.sessions.values()) {
            let url = "";
            try {
                url = session.page.url();
            }
            catch {
                // Page may have crashed — return empty string
            }
            result.push({
                id: session.id,
                createdAt: session.createdAt,
                lastUsedAt: session.lastUsedAt,
                url,
                // page.title() is async in Playwright; this interface is sync.
                // Callers needing the title should use getSession(id).page.title().
                title: "",
                ...(session.profilePath ? { profilePath: session.profilePath } : {}),
            });
        }
        return result;
    }
    getStats() {
        return {
            active: this.sessions.size,
            maxSessions: this.config.maxSessions,
            totalCreated: this.totalCreated,
        };
    }
}
export default SessionManager;
