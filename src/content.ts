// Runs on youtube.com. For each video: start at the channel's known pace if we
// have one, listen to the speaker, then set the speed once. Hands off the
// moment the viewer picks a speed themselves.

import { AudioTap } from "./audio";
import { blendRate, decideSpeed, MIN_CONFIDENCE } from "./decide";
import { estimateRate, type Estimate } from "./estimator";
import { showIndicator } from "./indicator";
import type { Phase, Request, Status } from "./messages";
import { DEFAULTS, getChannelRate, loadSettings, onSettingsChanged, setChannelRate, type Settings } from "./settings";
import { adShowing, currentChannel, currentVideoId, findVideo, onNavigate, type Channel } from "./youtube";

const FRAME_RATE = 50; // loudness readings per second
const FIRST_LOOK_S = 15; // listen this long before the first decision
const RECHECK_S = 5; // then retry this often while unsure
const GIVE_UP_S = 90; // stop listening after this much playback
const USER_INPUT_WINDOW_MS = 1500; // a speed change this soon after a click/key is the viewer's

interface Session {
  videoId: string;
  video: HTMLVideoElement;
  channel?: Channel;
  phase: Phase;
  levels: number[];
  nextCheck: number; // frame count at which to evaluate next
  captureRate: number; // playback speed while the current levels were recorded
  baseline: number; // speed the video had before Pacer touched it
  applied: number | null; // speed Pacer set, if any
  estimate?: Estimate;
  videoOff: boolean;
}

let settings: Settings = DEFAULTS;
let session: Session | null = null;
let lastPacerRate: number | null = null; // last value we wrote, to tell our changes from others
let lastBaseline = 1;
let lastUserInput = 0;
let ticks = 0;
const taps = new WeakMap<HTMLVideoElement, AudioTap>();
const watched = new WeakSet<HTMLVideoElement>();

// ---- lifecycle ---------------------------------------------------------------

async function init(): Promise<void> {
  settings = await loadSettings();
  onSettingsChanged((next, changed) => {
    const wasEnabled = settings.enabled;
    settings = next;
    if (changed.includes("enabled") && wasEnabled !== next.enabled) {
      showIndicator(next.enabled ? "Pacer on" : "Pacer off");
    }
    applyPolicy();
    if (session?.phase === "set") decide(); // target or max speed may have moved
  });

  for (const type of ["pointerdown", "keydown"]) {
    window.addEventListener(type, () => (lastUserInput = performance.now()), true);
  }

  onNavigate(refresh);
  setInterval(tick, 1000 / FRAME_RATE);
  setInterval(refresh, 1000); // safety net for navigations we didn't hear about
  chrome.runtime.onMessage.addListener(onMessage);
  refresh();
}

function refresh(): void {
  const id = currentVideoId();
  const video = id ? findVideo() : null;
  if (!id || !video) {
    session = null;
    return;
  }
  if (!session || session.videoId !== id || session.video !== video) startSession(id, video);
}

function startSession(videoId: string, video: HTMLVideoElement): void {
  const current = video.playbackRate;
  const baseline = current === lastPacerRate ? lastBaseline : current;
  lastBaseline = baseline;

  session = {
    videoId,
    video,
    phase: "measuring",
    levels: [],
    nextCheck: FIRST_LOOK_S * FRAME_RATE,
    captureRate: current,
    baseline,
    applied: current === lastPacerRate && current !== baseline ? current : null,
    videoOff: false,
  };

  if (!watched.has(video)) {
    watched.add(video);
    video.addEventListener("ratechange", () => onRateChange(video));
  }
  let tap = taps.get(video);
  if (!tap) {
    tap = new AudioTap(video);
    taps.set(video, tap);
  }
  void tap.connect();
  applyPolicy();
}

// ---- policy ------------------------------------------------------------------

function isBlocked(s: Session): boolean {
  return (
    !settings.enabled ||
    s.videoOff ||
    (s.channel !== undefined && settings.disabledChannels.includes(s.channel.key))
  );
}

/** Switches the session on or off to match the toggles. */
function applyPolicy(): void {
  const s = session;
  if (!s) return;
  if (isBlocked(s)) {
    if (s.phase !== "off") {
      if (s.applied !== null) setSpeed(s.baseline);
      s.applied = null;
      s.phase = "off";
    }
    return;
  }
  if (s.phase === "off") {
    if (s.estimate && s.estimate.confidence >= MIN_CONFIDENCE) {
      s.phase = "set";
      decide();
    } else {
      s.phase = "measuring";
      resetLevels(s);
      void useChannelCache();
    }
  }
}

function setSpeed(rate: number): void {
  const s = session;
  if (!s) return;
  lastPacerRate = rate;
  s.video.playbackRate = rate;
  if (s.phase === "measuring") resetLevels(s);
}

function resetLevels(s: Session): void {
  s.levels = [];
  s.nextCheck = FIRST_LOOK_S * FRAME_RATE;
  s.captureRate = s.video.playbackRate;
}

/** Speed for a speaking rate: never below what the viewer had chosen. */
function speedFor(rate: number, s: Session): number {
  return Math.max(decideSpeed(rate, settings), s.baseline);
}

function onRateChange(video: HTMLVideoElement): void {
  const s = session;
  if (!s || s.video !== video) return;
  const rate = video.playbackRate;
  if (rate === lastPacerRate) return; // our own change

  const byViewer = performance.now() - lastUserInput < USER_INPUT_WINDOW_MS;
  if (byViewer) {
    if (s.phase === "measuring" || s.phase === "set") {
      s.phase = "overridden";
      s.applied = null;
      showIndicator(`Pacer: leaving this video at ${rate}x`);
    }
    s.baseline = rate;
    lastBaseline = rate;
    return;
  }

  // YouTube itself (new video, end of an ad) put the speed back.
  if (s.applied !== null && (s.phase === "measuring" || s.phase === "set")) {
    setSpeed(s.applied);
  } else {
    s.baseline = rate;
    lastBaseline = rate;
    if (s.phase === "measuring") resetLevels(s);
  }
}

// ---- measuring ---------------------------------------------------------------

function tick(): void {
  const s = session;
  if (!s || s.phase !== "measuring") return;
  ticks++;

  if (!s.channel && ticks % 25 === 0) resolveChannel(s);

  const v = s.video;
  if (v.paused || v.ended || v.seeking || document.hidden || adShowing()) return;
  const tap = taps.get(v);
  const level = tap?.state === "ok" ? tap.level() : undefined;
  if (level === undefined) return;

  s.levels.push(level);
  if (s.levels.length >= s.nextCheck) evaluate(s);
}

function evaluate(s: Session): void {
  const est = estimateRate(s.levels, { frameRate: FRAME_RATE, playbackRate: s.captureRate });
  if (est.confidence >= MIN_CONFIDENCE) {
    s.estimate = est;
    s.phase = "set";
    decide();
    void rememberChannel(s, est.rate);
    return;
  }
  if (s.levels.length >= GIVE_UP_S * FRAME_RATE) {
    s.estimate = est;
    s.phase = "unsure";
    if (s.applied === null) showIndicator("Pacer: no clear speech, left as is");
    return;
  }
  s.nextCheck += RECHECK_S * FRAME_RATE;
}

/** Applies the speed for the current estimate. */
function decide(): void {
  const s = session;
  if (!s?.estimate || s.phase !== "set") return;
  const rate = s.estimate.rate;
  const speed = speedFor(rate, s);
  const current = s.applied ?? s.video.playbackRate;
  if (s.applied === null || Math.abs(speed - current) >= 0.1) {
    setSpeed(speed);
    s.applied = speed === s.baseline ? null : speed;
  }
  showIndicator(
    s.applied === null
      ? `Pacer: pace is fine (${rate.toFixed(1)} syl/s)`
      : `Pacer ${s.applied}x · speaker ${rate.toFixed(1)} syl/s`,
  );
}

// ---- channel memory ----------------------------------------------------------

function resolveChannel(s: Session): void {
  const channel = currentChannel(s.videoId);
  if (!channel) return;
  s.channel = channel;
  applyPolicy();
  void useChannelCache();
}

/** Start at the channel's usual pace so the first seconds aren't wasted. */
async function useChannelCache(): Promise<void> {
  const s = session;
  if (!s?.channel || s.phase !== "measuring" || s.applied !== null) return;
  const cached = await getChannelRate(s.channel.key);
  if (!cached || session !== s || s.phase !== "measuring") return;
  const speed = speedFor(cached.rate, s);
  if (speed !== s.video.playbackRate) {
    setSpeed(speed);
    s.applied = speed;
    showIndicator(`Pacer ${speed}x · this channel's usual pace`);
  }
}

async function rememberChannel(s: Session, rate: number): Promise<void> {
  if (!s.channel) return;
  const prev = await getChannelRate(s.channel.key);
  await setChannelRate(s.channel.key, {
    rate: blendRate(prev?.rate, prev?.samples ?? 0, rate),
    samples: (prev?.samples ?? 0) + 1,
    name: s.channel.name,
  });
}

// ---- popup -------------------------------------------------------------------

function status(): Status | null {
  const s = session;
  if (!s) return null;
  return {
    videoId: s.videoId,
    channelKey: s.channel?.key,
    channelName: s.channel?.name,
    phase: s.phase,
    speed: s.video.playbackRate,
    rate: s.estimate?.rate,
    confidence: s.estimate?.confidence,
    videoOff: s.videoOff,
    audio: taps.get(s.video)?.state ?? "idle",
  };
}

function onMessage(msg: Request, _sender: chrome.runtime.MessageSender, reply: (r: Status | null) => void): void {
  if (msg.type === "setVideoOff" && session) {
    session.videoOff = msg.value;
    applyPolicy();
  }
  if (!session?.channel && session) resolveChannel(session);
  reply(status());
}

void init();
