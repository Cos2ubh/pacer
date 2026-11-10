import { calibrateIfNeeded, playPace, stopDemo } from "./demo";
import type { Request, Status } from "./messages";
import { loadSettings, saveSettings, type Settings } from "./settings";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const statusEl = $<HTMLParagraphElement>("status");
const enabledEl = $<HTMLInputElement>("enabled");
const channelEl = $<HTMLInputElement>("channel");
const channelLabel = $<HTMLSpanElement>("channel-label");
const videoEl = $<HTMLInputElement>("video");
const targetEl = $<HTMLInputElement>("target");
const targetOut = $<HTMLOutputElement>("target-out");
const maxEl = $<HTMLSelectElement>("max");
const demoEl = $<HTMLButtonElement>("demo");
const demoNote = $<HTMLSpanElement>("demo-note");

let settings: Settings;
let tabId: number | undefined;
let current: Status | null = null;

async function ask(req: Request): Promise<Status | null> {
  if (tabId === undefined) return null;
  try {
    return (await chrome.tabs.sendMessage(tabId, req)) as Status | null;
  } catch {
    return null; // not a YouTube tab, or the page loaded before Pacer was installed
  }
}

function describe(s: Status | null): string {
  if (!s) return "Open a YouTube video to see what Pacer is doing.";
  if (s.audio === "waiting") return "Click the video once so Pacer can hear it.";
  if (s.audio === "unavailable")
    return "Pacer can't hear this tab. Another audio extension may be using it; channel memory still works.";
  const pace = s.rate ? `${s.rate.toFixed(1)} syllables/s` : "";
  switch (s.phase) {
    case "off":
      return "Off for this video.";
    case "measuring":
      if (s.rate) return `Speaker at ${pace}, running at ${s.speed}x. Fine-tuning…`;
      return s.speed !== 1 ? `Running at ${s.speed}x from this channel's usual pace. Fine-tuning…` : "Listening to the speaker…";
    case "set":
      return s.speed > 1 ? `Speaker at ${pace}, sped up to ${s.speed}x.` : `Speaker at ${pace}, already at your pace.`;
    case "unsure":
      return "No clear speech (music or noise?), so the speed was left alone.";
    case "overridden":
      return `You picked ${s.speed}x, so Pacer switched off for this video. Tick "This video" or click the speedometer button in the player to turn it back on.`;
  }
}

function render(): void {
  enabledEl.checked = settings.enabled;
  // Don't move a control out from under the viewer while they're using it.
  if (document.activeElement !== targetEl) {
    targetEl.value = String(settings.target);
    targetOut.textContent = `${settings.target.toFixed(1)} syllables/s`;
  }
  if (document.activeElement !== maxEl) maxEl.value = String(settings.maxSpeed);

  const key = current?.channelKey;
  channelEl.disabled = !key;
  channelEl.checked = key ? !settings.disabledChannels.includes(key) : false;
  channelLabel.textContent = current?.channelName ? `This channel (${current.channelName})` : "This channel";

  videoEl.disabled = !current;
  videoEl.checked = current ? !current.videoOff : false;

  statusEl.textContent = settings.enabled ? describe(current) : "Pacer is off everywhere.";
}

async function save(patch: Partial<Settings>): Promise<void> {
  settings = { ...settings, ...patch };
  await saveSettings(patch);
  render();
}

enabledEl.addEventListener("change", () => void save({ enabled: enabledEl.checked }));

channelEl.addEventListener("change", () => {
  const key = current?.channelKey;
  if (!key) return;
  const others = settings.disabledChannels.filter((k) => k !== key);
  void save({ disabledChannels: channelEl.checked ? others : [...others, key] });
});

videoEl.addEventListener("change", async () => {
  current = await ask({ type: "setVideoOff", value: !videoEl.checked });
  render();
});

targetEl.addEventListener("input", () => {
  targetOut.textContent = `${Number(targetEl.value).toFixed(1)} syllables/s`;
});
targetEl.addEventListener("change", () => {
  void save({ target: Number(targetEl.value) });
  if (playing) void startDemo(); // replay at the new pace
});

// ---- "Hear this pace" ----------------------------------------------------------

let playing = false;
let playId = 0;

function setPlaying(on: boolean): void {
  playing = on;
  demoEl.setAttribute("aria-pressed", String(on));
  demoEl.textContent = on ? "■ Stop" : "▶ Hear this pace";
}

async function startDemo(): Promise<void> {
  const id = ++playId;
  const target = Number(targetEl.value);
  setPlaying(true);
  demoNote.textContent = "";
  const actual = await playPace(target);
  if (id !== playId) return; // a newer playback took over
  setPlaying(false);
  if (actual) demoNote.textContent = `Played at about ${actual.toFixed(1)} syllables/s`;
}

demoEl.addEventListener("click", () => {
  if (playing) {
    playId++;
    stopDemo();
    setPlaying(false);
  } else {
    void startDemo();
  }
});
maxEl.addEventListener("change", () => void save({ maxSpeed: Number(maxEl.value) }));

async function main(): Promise<void> {
  settings = await loadSettings();
  void calibrateIfNeeded(); // silently time the voice so the first demo is accurate
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id;
  current = await ask({ type: "status" });
  render();
  // Keep the status line live while the popup is open.
  setInterval(async () => {
    current = await ask({ type: "status" });
    render();
  }, 1000);
}

void main();
