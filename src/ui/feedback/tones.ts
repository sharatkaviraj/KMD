/**
 * The sounds behind `cue()` (D-497), drawn by the phone itself with Web Audio:
 * no audio files to download, nothing to cache, a few hundred bytes of code.
 * Every sound is under half a second and quiet; on an iPhone the ring/silent
 * switch mutes Web Audio, which is what a teacher in a classroom expects.
 *
 * The audio context is made and resumed inside a tap (iOS refuses otherwise)
 * and suspended again a few seconds after the last sound, so the phone's
 * audio hardware is not kept awake between saves.
 */

export type Note = {
  /** Start frequency in Hz. */
  f: number;
  /** End frequency for a glide (listen, stop, undo). */
  to?: number;
  /** Start, seconds after the cue. */
  at: number;
  /** Length in seconds, including the fade. */
  dur: number;
  /** Peak loudness, 0..1 before the master volume. */
  gain: number;
  type?: OscillatorType;
};

/** C5 E5 G5 C6 and friends: a calm major vocabulary, nothing that sounds like an alarm. */
export const TONES = {
  success: [
    { f: 659.25, at: 0, dur: 0.12, gain: 0.5 },
    { f: 987.77, at: 0.075, dur: 0.16, gain: 0.45 },
  ],
  done: [
    { f: 523.25, at: 0, dur: 0.12, gain: 0.45 },
    { f: 659.25, at: 0.085, dur: 0.12, gain: 0.45 },
    { f: 783.99, at: 0.17, dur: 0.12, gain: 0.45 },
    { f: 1046.5, at: 0.255, dur: 0.22, gain: 0.4 },
  ],
  warn: [{ f: 349.23, at: 0, dur: 0.16, gain: 0.5, type: "triangle" }],
  error: [
    { f: 392, at: 0, dur: 0.13, gain: 0.55, type: "triangle" },
    { f: 293.66, at: 0.12, dur: 0.2, gain: 0.55, type: "triangle" },
  ],
  undo: [{ f: 740, to: 440, at: 0, dur: 0.13, gain: 0.35 }],
  listen: [{ f: 520, to: 880, at: 0, dur: 0.14, gain: 0.4 }],
  stop: [{ f: 880, to: 520, at: 0, dur: 0.14, gain: 0.4 }],
  ready: [
    { f: 1046.5, at: 0, dur: 0.38, gain: 0.32 },
    { f: 2093, at: 0, dur: 0.22, gain: 0.08 },
  ],
} satisfies Record<string, Note[]>;

export type ToneName = keyof typeof TONES;

/** The master volume. Quiet on purpose: a staff room, a classroom, a parent at the counter. */
export const MASTER_VOLUME = 0.16;

/** How long a sound takes, so the context is not suspended under it. */
export function toneLength(name: ToneName): number {
  return Math.max(...TONES[name].map((n) => n.at + n.dur));
}

type Ctx = AudioContext;
let ctx: Ctx | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
const IDLE_MS = 6000;

function makeContext(): Ctx | null {
  if (ctx) return ctx;
  if (typeof window === "undefined") return null;
  const w = window as unknown as { AudioContext?: new () => Ctx; webkitAudioContext?: new () => Ctx };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    ctx = null;
  }
  return ctx;
}

function scheduleIdle(extraMs = 0) {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (ctx && ctx.state === "running") void ctx.suspend().catch(() => undefined);
  }, IDLE_MS + extraMs);
}

/**
 * Called from inside a tap: make the context if sounds are on and wake it.
 * iOS only lets audio start inside a person's gesture, so a save that answers
 * two seconds after the tap can still play its chime.
 */
export function wakeAudio() {
  const c = makeContext();
  if (!c) return;
  if (c.state !== "running") void c.resume().catch(() => undefined);
  scheduleIdle();
}

/** Play one named sound. Returns false when there is no audio here. */
export function playTone(name: ToneName): boolean {
  const c = makeContext();
  if (!c) return false;
  try {
    if (c.state !== "running") void c.resume().catch(() => undefined);
    const master = c.createGain();
    master.gain.value = MASTER_VOLUME;
    master.connect(c.destination);
    const t0 = c.currentTime + 0.01;
    for (const n of TONES[name] as Note[]) {
      const osc = c.createOscillator();
      const env = c.createGain();
      osc.type = n.type ?? "sine";
      osc.frequency.setValueAtTime(n.f, t0 + n.at);
      if (n.to) osc.frequency.exponentialRampToValueAtTime(n.to, t0 + n.at + n.dur);
      env.gain.setValueAtTime(0.0001, t0 + n.at);
      env.gain.exponentialRampToValueAtTime(n.gain, t0 + n.at + 0.012);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + n.at + n.dur);
      osc.connect(env);
      env.connect(master);
      osc.start(t0 + n.at);
      osc.stop(t0 + n.at + n.dur + 0.02);
    }
    scheduleIdle(toneLength(name) * 1000);
    return true;
  } catch {
    return false;
  }
}
