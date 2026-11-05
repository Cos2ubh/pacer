// Reads the loudness of a <video>'s sound without changing what the viewer hears.
//
// Web Audio can only take over a media element once, and from then on the
// sound plays through our AudioContext. If that context is suspended (Chrome
// does this until the page has had a click or key press) the video goes
// silent. So we never take over the element until the context is running.

import type { AudioState } from "./messages";

export class AudioTap {
  state: AudioState = "idle";
  private analyser?: AnalyserNode;
  private buffer?: Float32Array<ArrayBuffer>;

  constructor(private readonly video: HTMLVideoElement) {}

  async connect(): Promise<void> {
    if (this.state !== "idle") return;
    this.state = "waiting";

    const ctx = new AudioContext();
    if (!(await tryResume(ctx))) {
      await nextUserGesture();
      if (!(await tryResume(ctx))) return this.fail(ctx);
    }

    let source: MediaElementAudioSourceNode;
    try {
      source = ctx.createMediaElementSource(this.video);
    } catch {
      // Another extension (equaliser, volume booster) already owns the element.
      return this.fail(ctx);
    }

    // What the viewer hears: unchanged.
    source.connect(ctx.destination);

    // What we measure: the speech band, where vowels carry their energy.
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 1000;
    band.Q.value = 0.6;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    // Analysers only run while connected to the output, so feed it a silent gain.
    const silent = ctx.createGain();
    silent.gain.value = 0;
    source.connect(band).connect(analyser).connect(silent).connect(ctx.destination);

    ctx.addEventListener("statechange", () => {
      if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    });

    this.analyser = analyser;
    this.buffer = new Float32Array(analyser.fftSize);
    this.state = "ok";
  }

  /** Current loudness in dB, or undefined if we aren't connected. */
  level(): number | undefined {
    if (!this.analyser || !this.buffer) return undefined;
    this.analyser.getFloatTimeDomainData(this.buffer);
    let sum = 0;
    for (const v of this.buffer) sum += v * v;
    return 20 * Math.log10(Math.sqrt(sum / this.buffer.length) + 1e-6);
  }

  private fail(ctx: AudioContext): void {
    this.state = "unavailable";
    void ctx.close().catch(() => {});
  }
}

async function tryResume(ctx: AudioContext): Promise<boolean> {
  if (ctx.state !== "running") {
    try {
      await ctx.resume();
    } catch {
      /* not allowed yet */
    }
  }
  return (ctx.state as string) === "running";
}

function nextUserGesture(): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      window.removeEventListener("pointerdown", done, true);
      window.removeEventListener("keydown", done, true);
      resolve();
    };
    window.addEventListener("pointerdown", done, true);
    window.addEventListener("keydown", done, true);
  });
}
