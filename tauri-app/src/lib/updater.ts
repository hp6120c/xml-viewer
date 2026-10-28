import type { DownloadEvent, Update } from "@tauri-apps/plugin-updater";
import { isDesktopApp } from "./api";

export interface UpdateDetails {
  currentVersion: string;
  version: string;
  date: string;
  body: string;
  raw: Update;
}

export async function checkForUpdate(): Promise<UpdateDetails | null> {
  if (!isDesktopApp()) return null;
  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check();
  if (!update) return null;
  return {
    currentVersion: update.currentVersion,
    version: update.version,
    date: update.date ?? "",
    body: update.body ?? "",
    raw: update,
  };
}

export async function installUpdate(
  update: Update,
  onEvent: (event: DownloadEvent) => void,
): Promise<void> {
  await update.downloadAndInstall(onEvent);
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}
