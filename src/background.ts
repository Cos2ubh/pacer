// Handles the on/off keyboard shortcut and keeps the toolbar badge honest.

import { loadSettings, saveSettings } from "./settings";

async function syncBadge(): Promise<void> {
  const { enabled } = await loadSettings();
  await chrome.action.setBadgeText({ text: enabled ? "" : "off" });
  await chrome.action.setBadgeBackgroundColor({ color: "#555" });
}

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle-enabled") return;
  const { enabled } = await loadSettings();
  await saveSettings({ enabled: !enabled });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && "enabled" in changes) void syncBadge();
});

chrome.runtime.onStartup.addListener(() => void syncBadge());
chrome.runtime.onInstalled.addListener(() => void syncBadge());
