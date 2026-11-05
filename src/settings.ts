// User settings live in storage.sync (follow the user across browsers);
// per-channel measurements live in storage.local (can grow, stay on this machine).

export interface Settings {
  enabled: boolean;
  /** Comfortable speaking rate, syllables/second. Slower speakers get sped up to this. */
  target: number;
  maxSpeed: number;
  /** Channel keys (e.g. "/@somechannel") Pacer should never adjust. */
  disabledChannels: string[];
}

export const DEFAULTS: Settings = {
  enabled: true,
  target: 4.5,
  maxSpeed: 2,
  disabledChannels: [],
};

export async function loadSettings(): Promise<Settings> {
  return (await chrome.storage.sync.get(DEFAULTS)) as Settings;
}

export function saveSettings(patch: Partial<Settings>): Promise<void> {
  return chrome.storage.sync.set(patch);
}

export function onSettingsChanged(cb: (s: Settings, changed: string[]) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    const changed = Object.keys(changes);
    void loadSettings().then((s) => cb(s, changed));
  });
}

export interface ChannelRate {
  rate: number;
  samples: number;
  name: string;
}

const channelKey = (key: string) => `channel:${key}`;

export async function getChannelRate(key: string): Promise<ChannelRate | undefined> {
  const k = channelKey(key);
  const got = await chrome.storage.local.get(k);
  return got[k] as ChannelRate | undefined;
}

export function setChannelRate(key: string, value: ChannelRate): Promise<void> {
  return chrome.storage.local.set({ [channelKey(key)]: value });
}
