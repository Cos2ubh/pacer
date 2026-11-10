// Runs on youtube.com. For each video: start at the channel's known pace if we
// have one, listen to the speaker, set a speed within a few seconds, then make
// at most one correction once we've heard more. Hands off the moment the
// viewer picks a speed themselves.

import { AudioTap } from "./audio";
import { blendRate, decideSpeed, MIN_CONFIDENCE } from "./decide";
import { combineEstimates, estimateRate, type Estimate } from "./estimator";
import { showIndicator } from "./indicator";
import type { Phase, Request, Status } from "./messages";
import { DEFAULTS, getChannelRate, loadSettings, onSettingsChanged, setChannelRate, type Settings } from "./settings";
import { adShowing, currentChannel, currentVideoId, findVideo, onNavigate, type Channel } from "./youtube";

const FRAME_RATE = 50; // loudness readings per second
const QUICK_SPEECH_S = 4; // seconds of speech before the first speed is set
const FINAL_SPEECH_S = 12; // seconds of speech before the one allowed correction
const CHECK_EVERY_S = 1; // how often to re-run the estimate while listening
const GIVE_UP_S = 90; // stop listening after this much playback
const CORRECTION_MIN = 0.15; // only correct the quick guess if it was off by this much
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
  /** A speed is in place (quick guess or channel memory) and only the final check remains. */
  provisional: boolean;
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
    // Target or max speed may have moved; respond right away.
    const s = session;
    if (s?.estimate && (s.phase === "set" || (s.phase === "measuring" && s.provisional))) decide("update");
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
    segments: [{ captureRate: current, levels: [] }],
    frames: 0,
    nextCheck: CHECK_EVERY_S * FRAME_RATE,
    provisional: false,
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
    // Back on. Whatever we heard earlier in this video still counts.
    s.phase = "measuring";
    if (s.estimate && s.estimate.confidence >= MIN_CONFIDENCE) {
      s.provisional = true;
      decide("update");
    } else {
      void useChannelCache();
    }
  }
}

function setSpeed(rate: number): void {
  const s = session;
  if (!s) return;
  lastPacerRate = rate;
  s.video.playbackRate = rate;
  startSegment(s);
}

/** Starts a new stretch of readings at the current speed; earlier ones are kept. */
function startSegment(s: Session): void {
  const rate = s.video.playbackRate;
  const last = s.segments[s.segments.length - 1];
  if (last && last.levels.length === 0) last.captureRate = rate;
  else s.segments.push({ captureRate: rate, levels: [] });
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
  startSegment(s);

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

  if (s.frames === 0 && !s.provisional) showIndicator("Pacer: listening…");
  s.segments[s.segments.length - 1]!.levels.push(level);
  s.frames++;
  if (s.frames >= s.nextCheck) {
    s.nextCheck += CHECK_EVERY_S * FRAME_RATE;
    evaluate(s);
  }
}

/** Everything heard so far in this video, each stretch scaled by the speed it was heard at. */
function heardSoFar(s: Session, fullConfidenceSpeech: number): Estimate {
  const parts = s.segments
    .filter((seg) => seg.levels.length >= 10)
    .map((seg) => estimateRate(seg.levels, { frameRate: FRAME_RATE, playbackRate: seg.captureRate }));
  return combineEstimates(parts, fullConfidenceSpeech);
}

function evaluate(s: Session): void {
  // Stage 1: a quick decision as soon as we've heard a few seconds of speech.
  if (!s.provisional) {
    const quick = heardSoFar(s, QUICK_SPEECH_S);
    if (quick.speechSeconds >= QUICK_SPEECH_S && quick.confidence >= MIN_CONFIDENCE) {
      s.estimate = quick;
      s.provisional = true;
      decide("quick");
    }
  }

  // Stage 2: one correction, only if the quick guess was clearly off.
  if (s.provisional) {
    const full = heardSoFar(s, FINAL_SPEECH_S);
    if (full.speechSeconds >= FINAL_SPEECH_S && full.confidence >= MIN_CONFIDENCE) {
      s.estimate = full;
      s.phase = "set";
      decide("final");
      void rememberChannel(s, full.rate);
      return;
    }
  }

  if (s.frames >= GIVE_UP_S * FRAME_RATE) {
    if (s.estimate) {
      s.phase = "set"; // keep the quick decision
    } else {
      s.phase = "unsure";
      if (s.applied === null) showIndicator("Pacer: no clear speech, left as is");
    }
  }
}

/**
 * Applies the speed for the current estimate.
 * quick: first decision, always announced.
 * final: the one correction, only if the guess was clearly off.
 * update: settings changed or Pacer was switched back on.
 */
function decide(stage: "quick" | "final" | "update"): void {
  const s = session;
  if (!s?.estimate) return;
  const rate = s.estimate.rate;
  const speed = speedFor(rate, s);
  const current = s.video.playbackRate;
  const minChange = stage === "final" ? CORRECTION_MIN : 0.05;
  const changed = Math.abs(speed - current) >= minChange - 1e-9;

  if (changed) {
    setSpeed(speed);
    s.applied = speed === s.baseline ? null : speed;
  }
  if (stage === "final" && !changed) return; // quietly confirmed
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

/** Start at the channel's usual pace so there's no wait at all. */
async function useChannelCache(): Promise<void> {
  const s = session;
  if (!s?.channel || s.phase !== "measuring" || s.provisional) return;
  const cached = await getChannelRate(s.channel.key);
  if (!cached || session !== s || s.phase !== "measuring" || s.provisional) return;
  s.provisional = true; // the final check still runs and can correct it
  const speed = speedFor(cached.rate, s);
  if (speed !== s.video.playbackRate) {
    setSpeed(speed);
    s.applied = speed === s.baseline ? null : speed;
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
  if (session && !session.channel) resolveChannel(session);
  reply(status());
}

void init();
