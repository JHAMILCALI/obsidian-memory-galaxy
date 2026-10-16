import type { TFile } from "obsidian";

export const RECENT_LIMIT = 12;
const RECENT_WINDOW_DAYS = 30;

/**
 * The most recently edited notes (up to RECENT_LIMIT, within the last month) mapped to a 0–1 glow.
 * The newest edit shines brightest; older notes are absent from the map.
 */
export function recencyByPath(files: TFile[], now = Date.now()): Map<string, number> {
  const recent = files
    .map((file) => ({ path: file.path, ageDays: (now - (file.stat?.mtime ?? 0)) / 86_400_000 }))
    .filter((item) => item.ageDays >= 0 && item.ageDays <= RECENT_WINDOW_DAYS)
    .sort((a, b) => a.ageDays - b.ageDays)
    .slice(0, RECENT_LIMIT);
  return new Map(recent.map((item, rank) => [
    item.path,
    Math.max(0.35, Math.exp(-item.ageDays / 10) * (1 - rank / (RECENT_LIMIT * 1.6)))
  ]));
}
