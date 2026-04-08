// ─── Multi-Terminal Tiling Coordinator ─────────────────────────────────────
//
// File-based coordination for multiple Leapfrog MCP instances sharing a
// single screen. Each Claude Code terminal claims a tile slot; positions
// are recalculated whenever the grid changes.
//
// Shared state lives in ~/.leapfrog/tiles.json with a simple file lock
// (~/.leapfrog/tiles.lock) for atomic read-modify-write cycles.
//
// Zero npm dependencies — Node.js built-ins only (fs, path, os).

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ─── Constants ────────────────────────────────────────────────────────────

const LEAPFROG_DIR = path.join(os.homedir(), ".leapfrog");
const TILES_PATH = path.join(LEAPFROG_DIR, "tiles.json");
const LOCK_PATH = path.join(LEAPFROG_DIR, "tiles.lock");

/** Maximum attempts to acquire the file lock before giving up */
const LOCK_MAX_RETRIES = 50;

/** Base delay between lock retries (ms); jittered up to 1.5x */
const LOCK_RETRY_BASE_MS = 50;

/** Lock files older than this are assumed stale and removed */
const STALE_LOCK_THRESHOLD_MS = 30_000;

// ─── Public Types ─────────────────────────────────────────────────────────

/** A single tile slot representing one MCP instance's screen region. */
export interface TileSlot {
  sessionId: string;
  instancePid: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Full grid state persisted to ~/.leapfrog/tiles.json. */
export interface TilesState {
  slots: TileSlot[];
  screenWidth: number;
  screenHeight: number;
  lastUpdated: number;
}

// ─── Internal Helpers ─────────────────────────────────────────────────────

/** Ensure ~/.leapfrog/ exists. */
function ensureDir(): void {
  if (!fs.existsSync(LEAPFROG_DIR)) {
    fs.mkdirSync(LEAPFROG_DIR, { recursive: true });
  }
}

/**
 * Calculate optimal grid dimensions for `count` tiles.
 * Favours a column-heavy layout when the screen is wider than it is tall.
 */
function calculateGrid(
  count: number,
  screenWidth: number,
  screenHeight: number,
): { cols: number; rows: number; cellWidth: number; cellHeight: number } {
  if (count <= 0) {
    return { cols: 1, rows: 1, cellWidth: screenWidth, cellHeight: screenHeight };
  }
  const cols = Math.ceil(Math.sqrt(count * (screenWidth / screenHeight)));
  const rows = Math.ceil(count / cols);
  const cellWidth = Math.floor(screenWidth / cols);
  const cellHeight = Math.floor(screenHeight / rows);
  return { cols, rows, cellWidth, cellHeight };
}

/** Returns true when `pid` corresponds to a running process. */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * If the lock file exists and is older than STALE_LOCK_THRESHOLD_MS,
 * remove it so we don't deadlock on a crashed process.
 */
function clearStaleLock(): void {
  try {
    const stat = fs.statSync(LOCK_PATH);
    if (Date.now() - stat.mtimeMs > STALE_LOCK_THRESHOLD_MS) {
      fs.unlinkSync(LOCK_PATH);
    }
  } catch {
    // Lock file doesn't exist or was already removed — fine.
  }
}

/**
 * Acquire an exclusive file lock, run `fn`, then release.
 * Uses `wx` (exclusive create) on the lock file as a cross-platform mutex.
 */
async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  ensureDir();
  clearStaleLock();

  let fd: number | null = null;

  for (let i = 0; i < LOCK_MAX_RETRIES; i++) {
    try {
      fd = fs.openSync(LOCK_PATH, "wx");
      break;
    } catch {
      await new Promise<void>((r) =>
        setTimeout(r, LOCK_RETRY_BASE_MS + Math.random() * LOCK_RETRY_BASE_MS),
      );
    }
  }

  if (fd === null) {
    throw new Error("Could not acquire tile lock after max retries");
  }

  try {
    return await fn();
  } finally {
    fs.closeSync(fd);
    try {
      fs.unlinkSync(LOCK_PATH);
    } catch {
      // Already gone — race with another process is harmless here.
    }
  }
}

/** Read and parse tiles.json, returning a default empty state on any failure. */
function readState(screenWidth: number, screenHeight: number): TilesState {
  try {
    const raw = fs.readFileSync(TILES_PATH, "utf-8");
    const parsed = JSON.parse(raw) as TilesState;

    // Basic shape validation
    if (!Array.isArray(parsed.slots) || typeof parsed.lastUpdated !== "number") {
      throw new Error("corrupt");
    }
    return parsed;
  } catch {
    return { slots: [], screenWidth, screenHeight, lastUpdated: Date.now() };
  }
}

/** Write tiles.json atomically (write-to-tmp then rename). */
function writeState(state: TilesState): void {
  ensureDir();
  state.lastUpdated = Date.now();
  const tmp = TILES_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf-8");
  fs.renameSync(tmp, TILES_PATH);
}

/**
 * Assign (x, y, width, height) to every slot in-place based on current
 * grid dimensions and slot ordering.
 */
function recalculatePositions(state: TilesState): void {
  const { cols, cellWidth, cellHeight } = calculateGrid(
    state.slots.length,
    state.screenWidth,
    state.screenHeight,
  );

  for (let i = 0; i < state.slots.length; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    state.slots[i].x = col * cellWidth;
    state.slots[i].y = row * cellHeight;
    state.slots[i].width = cellWidth;
    state.slots[i].height = cellHeight;
  }
}

// ─── TilesCoordinator ─────────────────────────────────────────────────────

/**
 * Coordinates screen real estate across multiple Leapfrog MCP instances
 * running in separate terminals.
 *
 * All coordination happens through the filesystem — no sockets, no ports,
 * no IPC. State is stored in `~/.leapfrog/tiles.json` and protected by
 * a simple file lock (`~/.leapfrog/tiles.lock`).
 *
 * @example
 * ```ts
 * const tiles = new TilesCoordinator(1920, 1080);
 * const pos = await tiles.claimSlot("session-abc");
 * // pos = { x: 0, y: 0, width: 960, height: 540 }
 *
 * // On shutdown:
 * await tiles.releaseAll();
 * ```
 */
export class TilesCoordinator {
  private screenWidth: number;
  private screenHeight: number;
  private mySessions = new Set<string>();
  private watcher: fs.FSWatcher | null = null;

  /**
   * Create a new TilesCoordinator.
   * Creates `~/.leapfrog/` if it doesn't already exist.
   *
   * @param screenWidth  Total screen width in pixels.
   * @param screenHeight Total screen height in pixels.
   */
  constructor(screenWidth: number, screenHeight: number) {
    this.screenWidth = screenWidth;
    this.screenHeight = screenHeight;
    ensureDir();
  }

  /**
   * Update the screen dimensions used for grid calculations.
   * Call this after detecting the real screen size (e.g., via CDP maximize).
   * Triggers a recalculation of all slot positions in the shared state.
   */
  async updateScreenSize(width: number, height: number): Promise<void> {
    if (width === this.screenWidth && height === this.screenHeight) return;
    this.screenWidth = width;
    this.screenHeight = height;
    return withLock(async () => {
      const state = readState(this.screenWidth, this.screenHeight);
      state.screenWidth = width;
      state.screenHeight = height;
      recalculatePositions(state);
      writeState(state);
    });
  }

  /**
   * Claim a grid slot for the given session.
   *
   * Dead-PID slots are reaped first, then the new session is appended
   * and all positions are recalculated to fill the grid evenly.
   *
   * @param sessionId Unique identifier for this session.
   * @returns The assigned tile position and dimensions.
   */
  async claimSlot(
    sessionId: string,
  ): Promise<{ x: number; y: number; width: number; height: number }> {
    return withLock(async () => {
      const state = readState(this.screenWidth, this.screenHeight);

      // Update screen dimensions in case they changed
      state.screenWidth = this.screenWidth;
      state.screenHeight = this.screenHeight;

      // Reap dead PIDs first
      state.slots = state.slots.filter((s) => isPidAlive(s.instancePid));

      // Remove any existing slot for this sessionId (re-claim scenario)
      state.slots = state.slots.filter((s) => s.sessionId !== sessionId);

      // Add the new slot (position is temporary — recalculated next)
      state.slots.push({
        sessionId,
        instancePid: process.pid,
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      });

      recalculatePositions(state);
      writeState(state);

      this.mySessions.add(sessionId);

      const slot = state.slots.find((s) => s.sessionId === sessionId)!;
      return { x: slot.x, y: slot.y, width: slot.width, height: slot.height };
    });
  }

  /**
   * Release a slot, removing it from the shared grid.
   * Remaining slots are repositioned to fill the gap.
   *
   * @param sessionId The session to release.
   */
  async releaseSlot(sessionId: string): Promise<void> {
    return withLock(async () => {
      const state = readState(this.screenWidth, this.screenHeight);
      state.slots = state.slots.filter((s) => s.sessionId !== sessionId);
      recalculatePositions(state);
      writeState(state);
      this.mySessions.delete(sessionId);
    });
  }

  /**
   * Get the current grid layout including all live instances.
   *
   * @returns A snapshot of the shared tiling state.
   */
  async getLayout(): Promise<TilesState> {
    return withLock(async () => {
      const state = readState(this.screenWidth, this.screenHeight);
      return state;
    });
  }

  /**
   * Remove slots whose owning process is no longer running.
   * Called automatically on `claimSlot`, but can be invoked directly
   * for periodic housekeeping.
   *
   * @returns Session IDs of the reaped (dead) slots.
   */
  async reapDeadSlots(): Promise<string[]> {
    return withLock(async () => {
      const state = readState(this.screenWidth, this.screenHeight);
      const before = state.slots.length;
      const deadIds: string[] = [];

      state.slots = state.slots.filter((s) => {
        if (!isPidAlive(s.instancePid)) {
          deadIds.push(s.sessionId);
          return false;
        }
        return true;
      });

      if (state.slots.length !== before) {
        recalculatePositions(state);
        writeState(state);
      }

      // Clean up local tracking for reaped sessions that were ours
      for (const id of deadIds) {
        this.mySessions.delete(id);
      }

      return deadIds;
    });
  }

  /**
   * Purge all slots NOT owned by the current process.pid.
   * Called on startup to clear ghost slots from previous instances
   * that may still be alive (e.g., after /mcp reconnect).
   */
  async purgeOtherPids(): Promise<number> {
    return withLock(async () => {
      const state = readState(this.screenWidth, this.screenHeight);
      const before = state.slots.length;
      state.slots = state.slots.filter((s) => s.instancePid === process.pid);
      if (state.slots.length !== before) {
        recalculatePositions(state);
        writeState(state);
      }
      return before - state.slots.length;
    });
  }

  /**
   * Watch `tiles.json` for changes made by other instances.
   * The callback fires with the new state whenever the file changes.
   *
   * @param onChange Callback invoked with the updated tiling state.
   */
  watch(onChange: (state: TilesState) => void): void {
    this.unwatch(); // Prevent duplicate watchers

    // Ensure the file exists before watching
    if (!fs.existsSync(TILES_PATH)) {
      writeState({
        slots: [],
        screenWidth: this.screenWidth,
        screenHeight: this.screenHeight,
        lastUpdated: Date.now(),
      });
    }

    let debounce: ReturnType<typeof setTimeout> | null = null;
    let lastMtime = 0;
    try { lastMtime = fs.statSync(TILES_PATH).mtimeMs; } catch { /* ok */ }

    // Watch the DIRECTORY, not the file. fs.watch on a file breaks when
    // atomic writes (rename .tmp → tiles.json) replace the inode.
    // Directory watchers see rename events reliably on all platforms.
    this.watcher = fs.watch(LEAPFROG_DIR, (_event, filename) => {
      if (filename !== "tiles.json") return;

      // Debounce rapid successive writes
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        try {
          // Skip if mtime hasn't actually changed (self-write echo)
          const mtime = fs.statSync(TILES_PATH).mtimeMs;
          if (mtime === lastMtime) return;
          lastMtime = mtime;

          const state = readState(this.screenWidth, this.screenHeight);
          onChange(state);
        } catch {
          // File may be mid-write; next event will pick it up.
        }
      }, 100);
    });

    // Don't let the watcher keep the process alive
    this.watcher.unref();
  }

  /**
   * Stop watching for tile changes from other instances.
   */
  unwatch(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  /**
   * Release all slots owned by this process.
   * Call this on SIGINT / SIGTERM to clean up before exit.
   */
  async releaseAll(): Promise<void> {
    return withLock(async () => {
      const state = readState(this.screenWidth, this.screenHeight);
      state.slots = state.slots.filter(
        (s) => !this.mySessions.has(s.sessionId),
      );
      recalculatePositions(state);
      writeState(state);
      this.mySessions.clear();
    });
  }
}
