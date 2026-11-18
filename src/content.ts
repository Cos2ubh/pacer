// Runs on youtube.com. For each video: start at the channel's known pace if we
// have one, listen to the speaker, set a speed within a few seconds, then make
// at most one correction once we've heard more. Hands off the moment the
// viewer picks a speed themselves.

import { AudioTap } from "./audio";
import { onButtonClick, syncButton } from "./button";
import { blendRate, decideSpeed, measuredAtNormalSpeed, MIN_CONFIDENCE } from "./decide";
import { combineEstimates, estimateRate, type Estimate } from "./estimator";
import { showIndicator } from "./indicator";
import type { Phase, Request, Status } from "./messages";
import {
  DEFAULTS,
  getChannelRate,
  loadSettings,
  onSettingsChanged,
  saveSettings,
  setChannelRate,
  type Settings,
} from "./settings";
import { adShowing, currentChannel, currentVideoId, findVideo, onNavigate, type Channel } from "./youtube";

const FRAME_RATE = 50; // loudness readings per second
const DECIDE_SPEECH_S = 4; // seconds of speech (heard at 1x) before the speed is set
const CHECK_EVERY_S = 1; // how often to re-run the estimate while listening
const GIVE_UP_S = 90; // stop listening after this much playback
const USER_INPUT_WINDOW_MS = 1500; // a speed change this soon after a click/key is the viewer's

/** A stretch of loudness readings all captured at the same playback speed. */
interface Segment {
  captureRate: number;
  levels: number[];
}

interface Session {
  videoId: string;
  video: HTMLVideoElement;
  channel?: Channel;
  phase: Phase;
  segments: Segment[];
  frames: number; // total readings across segments
  nextCheck: number; // frame count at which to evaluate next
  /** The estimate came from channel memory, not from listening to this video. */
  fromChannel: boolean;
  /** Speed to put back if Pacer switches off for this video (what it arrived at). */
  restoreTo: number;
  /** Pacer has changed this video's speed. */
  touched: boolean;
  /** Speed Pacer decided on (1 = pace is fine), or null before a decision. */
  applied: number | null;
  estimate?: Estimate;
  /** Switched off for this video, by the button or by the viewer picking a speed. */
  videoOff: boolean;
  /** Switched on for this video even though its channel is turned off. */
  forceOn: boolean;
}

let settings: Settings = DEFAULTS;
let session: Session | null = null;
let lastPacerRate: number | null = null; // last value we wrote, to tell our changes from others
let lastRestore = 1; // restoreTo of the previous video, for speeds Pacer left behind
let lastUserInput = 0;
let ticks = 0;
let retired = false; // set once this copy of the script has been orphaned
const timers: ReturnType<typeof setInterval>[] = [];
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
    // Target or max speed may have moved; respond right away.
    const s = session;
    if (s?.estimate && s.phase === "set") decide();
    updateButton();
  });

  onButtonClick(() => {
    if (alive() && session) setVideoActive(!isActive(session));
  });

  for (const type of ["pointerdown", "keydown"]) {
    window.addEventListener(type, () => (lastUserInput = performance.now()), true);
  }

  onNavigate(refresh);
  timers.push(setInterval(tick, 1000 / FRAME_RATE));
  timers.push(setInterval(refresh, 1000)); // safety net for navigations we didn't hear about
  chrome.runtime.onMessage.addListener(onMessage);
  refresh();
}

/**
 * When the extension is reloaded or updated, this copy of the script keeps
 * running in the open tab but loses its link to Chrome, and every chrome.*
 * call throws "Extension context invalidated". Detect that and bow out.
 */
function alive(): boolean {
  if (retired) return false;
  let ok = false;
  try {
    ok = Boolean(chrome.runtime?.id);
  } catch {
    /* invalidated */
  }
  if (!ok) retire();
  return ok;
}

function retire(): void {
  retired = true;
  for (const t of timers) clearInterval(t);
  timers.length = 0;
  session = null;
  syncButton(null);
}

function refresh(): void {
  if (!alive()) return;
  const id = currentVideoId();
  const video = id ? findVideo() : null;
  if (!id || !video) {
    session = null;
    updateButton();
    return;
  }
  if (!session || session.videoId !== id || session.video !== video) startSession(id, video);
  updateButton(); // YouTube rebuilds its controls now and then; put the button back
}

function startSession(videoId: string, video: HTMLVideoElement): void {
  const current = video.playbackRate;
  // YouTube carries the speed over between videos. If it's one Pacer set,
  // the speed to restore is whatever the earlier video arrived at.
  const leftover = current === lastPacerRate;
  const restoreTo = leftover ? lastRestore : current;
  lastRestore = restoreTo;

  session = {
    videoId,
    video,
    phase: "measuring",
    segments: [{ captureRate: current, levels: [] }],
    frames: 0,
    nextCheck: CHECK_EVERY_S * FRAME_RATE,
    fromChannel: false,
    restoreTo,
    touched: leftover,
    applied: null,
    videoOff: false,
    forceOn: false,
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
  if (session.phase === "measuring") beginListening(session);
}

// ---- policy ------------------------------------------------------------------

function isBlocked(s: Session): boolean {
  const channelOff = s.channel !== undefined && settings.disabledChannels.includes(s.channel.key);
  return !settings.enabled || s.videoOff || (channelOff && !s.forceOn);
}

/** What the player button shows. */
function isActive(s: Session): boolean {
  return !isBlocked(s) && s.phase !== "off" && s.phase !== "overridden";
}

function updateButton(): void {
  syncButton(session ? isActive(session) : null);
}

/** The player button and the popup's "This video" box both land here. */
function setVideoActive(on: boolean): void {
  const s = session;
  if (!s) return;
  if (!on) {
    s.videoOff = true;
    applyPolicy(); // puts the speed back to what it was before Pacer
    showIndicator("Pacer off for this video");
  } else {
    s.videoOff = false;
    s.forceOn = true;
    if (!settings.enabled) {
      settings = { ...settings, enabled: true };
      saveSettings({ enabled: true }).catch(() => alive());
    }
    restart(s);
    showIndicator("Pacer on · listening…");
  }
  updateButton();
}

/** Forget this video's readings and listen again from scratch. */
function restart(s: Session): void {
  s.phase = "measuring";
  s.segments = [{ captureRate: s.video.playbackRate, levels: [] }];
  s.frames = 0;
  s.nextCheck = CHECK_EVERY_S * FRAME_RATE;
  s.estimate = undefined;
  s.fromChannel = false;
  s.applied = null;
  beginListening(s);
}

/** Pacer can only measure reliably at normal speed, so it listens at 1x. */
function beginListening(s: Session): void {
  s.phase = "measuring";
  if (s.video.playbackRate !== 1) setSpeed(1);
}

/** Switches the session on or off to match the toggles. */
function applyPolicy(): void {
  const s = session;
  if (!s) return;
  if (isBlocked(s)) {
    if (s.phase !== "off" && s.phase !== "overridden") {
      if (s.touched) setSpeed(s.restoreTo);
      s.touched = false;
      s.applied = null;
      s.phase = "off";
    }
    updateButton();
    return;
  }
  if (s.phase === "off") {
    // Back on. Whatever we heard earlier in this video still counts.
    if (s.estimate && s.estimate.confidence >= MIN_CONFIDENCE) {
      s.phase = "set";
      decide();
    } else {
      beginListening(s);
      void useChannelCache();
    }
  }
  updateButton();
}

function setSpeed(rate: number): void {
  const s = session;
  if (!s) return;
  lastPacerRate = rate;
  s.video.playbackRate = rate;
  s.touched = rate !== s.restoreTo;
  startSegment(s);
}

/** Starts a new stretch of readings at the current speed; earlier ones are kept. */
function startSegment(s: Session): void {
  const rate = s.video.playbackRate;
  const last = s.segments[s.segments.length - 1];
  if (last && last.levels.length === 0) last.captureRate = rate;
  else s.segments.push({ captureRate: rate, levels: [] });
}

function onRateChange(video: HTMLVideoElement): void {
  const s = session;
  if (!s || s.video !== video) return;
  const rate = video.playbackRate;
  if (rate === lastPacerRate) return; // our own change
  startSegment(s);

  const byViewer = performance.now() - lastUserInput < USER_INPUT_WINDOW_MS;
  if (byViewer) {
    // The viewer picked a speed: switch off for this video and keep their choice.
    if (s.phase !== "off" && s.phase !== "overridden") {
      s.phase = "overridden";
      s.videoOff = true;
      s.applied = null;
      showIndicator(`Pacer off · you picked ${rate}x`);
      updateButton();
    }
    s.restoreTo = rate;
    s.touched = false;
    lastRestore = rate;
    return;
  }

  // YouTube itself changed it (new video, end of an ad): put Pacer's speed back.
  if (s.phase === "measuring") {
    if (rate !== 1) setSpeed(1);
  } else if (s.phase === "set" && s.applied !== null) {
    if (rate !== s.applied) setSpeed(s.applied);
  } else {
    s.restoreTo = rate;
    lastRestore = rate;
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

  // Only audio heard at 1x is usable (see heardAtNormalSpeed).
  if (!measuredAtNormalSpeed(v.playbackRate)) return;
  if (s.frames === 0) showIndicator("Pacer: listening…");
  s.segments[s.segments.length - 1]!.levels.push(level);
  s.frames++;
  if (s.frames >= s.nextCheck) {
    s.nextCheck += CHECK_EVERY_S * FRAME_RATE;
    evaluate(s);
  }
}

/**
 * Everything heard at normal speed so far in this video.
 *
 * Audio heard after a speed-up is ignored: the browser time-stretches it, which
 * smears syllables together. Tested offline (Windows voices + SoundTouch), the
 * same speaker read 8% slow at 1.25x, 19% at 1.5x, 31% at 2x, and a too-slow
 * reading made Pacer speed up even more.
 */
function heardAtNormalSpeed(s: Session): Estimate {
  const parts = s.segments
    .filter((seg) => seg.levels.length >= 10 && measuredAtNormalSpeed(seg.captureRate))
    .map((seg) => estimateRate(seg.levels, { frameRate: FRAME_RATE }));
  return combineEstimates(parts, DECIDE_SPEECH_S);
}

function evaluate(s: Session): void {
  const est = heardAtNormalSpeed(s);
  if (est.speechSeconds >= DECIDE_SPEECH_S && est.confidence >= MIN_CONFIDENCE) {
    s.estimate = est;
    s.fromChannel = false;
    s.phase = "set"; // decided once; no more listening for this video
    decide(true);
    void rememberChannel(s, est.rate);
    return;
  }

  if (s.frames >= GIVE_UP_S * FRAME_RATE) {
    s.phase = "unsure";
    if (s.applied === null) showIndicator("Pacer: no clear speech, left as is");
  }
}

/** Applies the speed for the current estimate; announces it when `announce` or when it changes. */
function decide(announce = false): void {
  const s = session;
  if (!s?.estimate) return;
  const rate = s.estimate.rate;
  const speed = decideSpeed(rate, settings); // never below 1x
  const changed = Math.abs(speed - s.video.playbackRate) >= 0.05 - 1e-9;

  s.applied = speed;
  if (changed) setSpeed(speed);
  if (!announce && !changed) return;
  showIndicator(
    speed > 1 ? `Pacer ${speed}x · speaker ${rate.toFixed(1)} syl/s` : `Pacer: pace is fine (${rate.toFixed(1)} syl/s)`,
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

/** Start at the channel's usual pace so there's no wait at all. */
async function useChannelCache(): Promise<void> {
  const s = session;
  if (!s?.channel || s.phase !== "measuring" || s.estimate) return;
  let cached;
  try {
    cached = await getChannelRate(s.channel.key);
  } catch {
    alive(); // storage fails when we've been orphaned
    return;
  }
  if (!cached || session !== s || s.phase !== "measuring" || s.estimate) return;
  const speed = decideSpeed(cached.rate, settings);
  // If the channel is usually fine at 1x, keep listening: this video gets measured properly.
  if (speed <= 1) return;
  // Otherwise trust the channel's usual pace. Once sped up we can't measure reliably,
  // so this is the decision for this video (the player button re-checks from 1x).
  s.estimate = { rate: cached.rate, syllables: 0, speechSeconds: 0, quality: 1, confidence: 1 };
  s.fromChannel = true;
  s.phase = "set";
  s.applied = speed;
  setSpeed(speed);
  showIndicator(`Pacer ${speed}x · this channel's usual pace`);
}

async function rememberChannel(s: Session, rate: number): Promise<void> {
  if (!s.channel) return;
  try {
    const prev = await getChannelRate(s.channel.key);
    await setChannelRate(s.channel.key, {
      rate: blendRate(prev?.rate, prev?.samples ?? 0, rate),
      samples: (prev?.samples ?? 0) + 1,
      name: s.channel.name,
    });
  } catch {
    alive(); // storage fails when we've been orphaned
  }
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
    fromChannel: s.fromChannel,
    videoOff: s.videoOff,
    audio: taps.get(s.video)?.state ?? "idle",
  };
}

function onMessage(msg: Request, _sender: chrome.runtime.MessageSender, reply: (r: Status | null) => void): void {
  if (msg.type === "setVideoOff" && session) setVideoActive(!msg.value);
  if (session && !session.channel) resolveChannel(session);
  reply(status());
}

void init();
