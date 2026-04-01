import type { Page } from "playwright";
import type { Session, SnapshotOptions, SnapshotResult, ISnapshotEngine } from "./types.js";
export declare class SnapshotEngine implements ISnapshotEngine {
    snapshot(page: Page, session: Session, opts?: SnapshotOptions): Promise<SnapshotResult>;
}
export default SnapshotEngine;
