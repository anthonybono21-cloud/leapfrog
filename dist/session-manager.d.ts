import type { Page } from "playwright-core";
import type { Session, SessionCreateOptions, SessionInfo, SessionManagerConfig, ISessionManager, PoolStats } from "./types.js";
export declare class SessionManager implements ISessionManager {
    private readonly config;
    private readonly sessions;
    private browser;
    private cleanupTimer;
    private totalCreated;
    constructor(config?: Partial<SessionManagerConfig>);
    private ensureBrowser;
    private startCleanupTimer;
    private stopCleanupTimer;
    private sweepIdle;
    createSession(opts?: SessionCreateOptions): Promise<Session>;
    getSession(id: string): Session | undefined;
    touchSession(id: string): void;
    destroySession(id: string): Promise<void>;
    destroyAll(): Promise<void>;
    listSessions(): SessionInfo[];
    getStats(): PoolStats;
    getClientSessionCount(clientId: string): number;
    getSessions(): Map<string, Session>;
    /**
     * Rotate a session: destroy the old one and create a fresh session with
     * a new fingerprint and humanization enabled. Used by stealth escalation
     * when a site blocks the current session.
     *
     * Returns the new session and its active page, plus the URL the old session
     * was on (so the caller can navigate back).
     *
     * SAFETY: Never call this on profile/auth sessions — the caller must guard.
     */
    rotateSession(oldSessionId: string): Promise<{
        session: Session;
        page: Page;
        previousUrl: string;
    }>;
    getResourceUsage(): {
        heapUsedMB: number;
        rssMB: number;
        sessionsActive: number;
        uptimeSeconds: number;
    };
}
export default SessionManager;
