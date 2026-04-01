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
    getResourceUsage(): {
        heapUsedMB: number;
        rssMB: number;
        sessionsActive: number;
        uptimeSeconds: number;
    };
}
export default SessionManager;
