import type { Page } from "playwright-core";
import type { Session, SnapshotOptions, SnapshotResult, ISnapshotEngine } from "./types.js";
interface ParsedNode {
    role: string;
    name: string;
    ariaRef: string;
    attrs: Map<string, string>;
    depth: number;
    children: ParsedNode[];
}
/**
 * Build a case-insensitive fingerprint for a parsed node.
 * Format: "role:lowercased_name" — e.g. "link:home", "button:sign in".
 */
export declare function elementFingerprint(node: ParsedNode): string;
export declare class SnapshotEngine implements ISnapshotEngine {
    snapshot(page: Page, session: Session, opts?: SnapshotOptions): Promise<SnapshotResult>;
}
export default SnapshotEngine;
