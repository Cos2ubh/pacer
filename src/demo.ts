// "Hear this pace": speaks a sample sentence at the chosen syllables/second,
// using the browser's built-in voice. Voices differ in their natural speed,
// so each one is timed once (silently) and the result is remembered.

const SAMPLE = "This is how fast your videos will sound when Pacer speeds up a slow talker to the pace you picked.";
/** Counted by hand: this(1) is(1) how(1) fast(1) your(1) vid-e-os(3) will(1) sound(1) when(1) Pa-cer(2)
 *  speeds(1) up(1) a(1) slow(1) talk-er(2) to(1) the(1) pace(1) you(1) picked(1). */
export const SAMPLE_SYLLABLES = 24;
/** A typical built-in voice at normal speed (measured on Windows voices: ~4.7). */
const FALLBACK_BASE = 4.5;

/** Speech-rate multiplier that makes a voice with this natural pace hit the target. */
export function utteranceRate(target: number, base: number): number {
  return Math.min(3, Math.max(0.5, target / base));
}

/** A voice's natural pace (syllables/s at rate 1), worked out from one timed playback. */
export function baseFromPlayback(seconds: number, rate: number): number | undefined {
  if (!(seconds > 0) || !(rate > 0)) return undefined;
  const base = SAMPLE_SYLLABLES / seconds / rate;
  return base >= 2 && base <= 9 ? base : undefined;
}

const storageKey = (voice: SpeechSynthesisVoice) => `voice:${voice.name}`;

async function voice(): Promise<SpeechSynthesisVoice | undefined> {
  if (speechSynthesis.getVoices().length === 0) {
    await new Promise<void>((resolve) => {
      speechSynthesis.addEventListener("voiceschanged", () => resolve(), { once: true });
      setTimeout(resolve, 1000);
    });
  }
  const all = speechSynthesis.getVoices();
  const english = all.filter((v) => v.lang.toLowerCase().startsWith("en"));
  // Local voices work offline and report timing reliably.
  return (
    english.find((v) => v.localService && v.default) ??
    english.find((v) => v.localService) ??
    english[0] ??
    all[0]
  );
}

async function storedBase(v: SpeechSynthesisVoice): Promise<number | undefined> {
  const got = await chrome.storage.local.get(storageKey(v));
  return got[storageKey(v)] as number | undefined;
}

/** Speaks the sample; resolves with how long it took, rejects if interrupted. */
function speak(v: SpeechSynthesisVoice | undefined, rate: number, volume: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const u = new SpeechSynthesisUtterance(SAMPLE);
    if (v) u.voice = v;
    u.lang = v?.lang ?? "en-US";
    u.rate = rate;
    u.volume = volume;
    let start = 0;
    u.onstart = () => (start = performance.now());
    u.onend = () => resolve(start ? (performance.now() - start) / 1000 : 0);
    u.onerror = (e) => reject(new Error(e.error));
    speechSynthesis.speak(u);
  });
}

async function learn(v: SpeechSynthesisVoice, seconds: number, rate: number): Promise<number | undefined> {
  const base = baseFromPlayback(seconds, rate);
  if (base !== undefined) await chrome.storage.local.set({ [storageKey(v)]: base });
  return base;
}

let busy = false;

/** Times the voice silently the first time, so the first real playback is accurate. */
export async function calibrateIfNeeded(): Promise<void> {
  const v = await voice();
  if (!v || busy || (await storedBase(v)) !== undefined) return;
  busy = true;
  try {
    await learn(v, await speak(v, 1, 0), 1);
  } catch {
    /* interrupted by a real playback; try again next time */
  } finally {
    busy = false;
  }
}

/**
 * Plays the sample at the target pace. Resolves with the pace it actually
 * played at (measured), or undefined if it was stopped.
 */
export async function playPace(target: number): Promise<number | undefined> {
  speechSynthesis.cancel();
  const v = await voice();
  const base = (v && (await storedBase(v))) ?? FALLBACK_BASE;
  const rate = utteranceRate(target, base);
  busy = true;
  try {
    const seconds = await speak(v, rate, 1);
    // Every playback refines our idea of this voice's natural pace.
    if (v) await learn(v, seconds, rate);
    return seconds > 0 ? SAMPLE_SYLLABLES / seconds : undefined;
  } catch {
    return undefined;
  } finally {
    busy = false;
  }
}

export function stopDemo(): void {
  speechSynthesis.cancel();
}
