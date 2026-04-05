// ─── Sound & Notification Module ──────────────────────────────────────────
//
// Fire-and-forget macOS notifications and sound effects.
// Silent no-op on non-macOS. Zero npm dependencies.
//
// Env: LEAP_SOUND=true, LEAP_SOUND_VOLUME=0.5, LEAP_NOTIFY=true

import { execFile } from "child_process";
import * as path from "path";
import { fileURLToPath } from "url";
import { logger } from "./logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHIME_PATH = path.join(__dirname, "..", "assets", "chime.mp3");
const IS_MAC = process.platform === "darwin";

export function isSoundEnabled(): boolean {
  return IS_MAC && process.env.LEAP_SOUND === "true";
}

export function isNotifyEnabled(): boolean {
  return IS_MAC && process.env.LEAP_NOTIFY === "true";
}

export function playSound(soundPath: string, volume?: number): void {
  if (!isSoundEnabled()) return;
  const vol = volume ?? parseFloat(process.env.LEAP_SOUND_VOLUME || "0.5");
  logger.debug("notify.playSound", { soundPath, volume: vol });
  execFile("afplay", ["-v", String(vol), soundPath], (err) => {
    if (err) logger.debug("notify.playSound.error", { error: err.message });
  });
}

export function chime(volume?: number): void {
  if (!isSoundEnabled()) return;
  const vol = volume ?? parseFloat(process.env.LEAP_SOUND_VOLUME || "0.5");
  logger.debug("notify.chime", { volume: vol });
  execFile("afplay", ["-v", String(vol), CHIME_PATH], (err) => {
    if (err) logger.debug("notify.chime.error", { error: err.message });
  });
}

export function alert(title: string, message: string): void {
  if (!isNotifyEnabled()) return;
  logger.debug("notify.alert", { title });
  const t = title.replace(/"/g, '\\"');
  const m = message.replace(/"/g, '\\"');
  execFile(
    "osascript",
    ["-e", `display notification "${m}" with title "${t}"`],
    (err) => {
      if (err) logger.debug("notify.alert.error", { error: err.message });
    },
  );
}
