/**
 * Sound, if you want it.
 *
 * Generated, not recorded: a drone that follows what is in the middle of the screen, a few
 * sparse notes over it, and a bell when something changes. No files to load, nothing that
 * loops audibly, and nothing at all until the player asks — a game that makes noise
 * uninvited is a game asking for attention, which is the thing this one is trying not to do.
 *
 * Every piece of the graph is built against a `BaseAudioContext`, so the same code that plays
 * it can also render it offline, which is how it is tested: a few seconds into an
 * `OfflineAudioContext`, then the samples checked for silence, clipping and NaN.
 */

/**
 * The drone's root for each step of the ladder, as semitones below A3. A minor pentatonic,
 * descending: the heavier the body, the lower it hums, and a pentatonic has no interval in it
 * that sounds wrong against any other, so the notes above it can be chosen at random.
 */
const LADDER_SEMITONES = [0, -3, -5, -7, -10, -12, -15, -17, -19, -22, -24, -27, -29, -31, -34, -36];
const A3 = 220;
/** Notes above the drone: the same scale, an octave or two up. */
const SCALE = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22];

const semitone = (n: number) => Math.pow(2, n / 12);

/** Ambience level at full volume. Low on purpose: this sits under whatever else is playing. */
const MASTER = 0.35;

export interface DroneState {
  /** Ladder index, 0 for dust. */
  stage: number;
  /** A body that shines: the drone opens up and brightens. */
  luminous: boolean;
  /** Whether there is a star being made at all. Between stars the drone all but stops. */
  present: boolean;
}

/** A generated reverb: noise with an exponential tail, which is all a large space is. */
function makeImpulse(ctx: BaseAudioContext, seconds: number, decay: number): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  let seed = 12345;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296 - 0.5;
  };
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i++) data[i] = random() * 2 * Math.pow(1 - i / length, decay);
  }
  return buffer;
}

/** The graph, built against any context so it can be heard or rendered offline. */
export interface Voice {
  setState(state: DroneState, at?: number): void;
  setLevel(level: number, at?: number): void;
  /** One of the sparse notes, now. */
  note(at?: number): void;
  /** Something changed. */
  bell(at?: number): void;
  stop(): void;
}

export function buildVoice(ctx: BaseAudioContext, destination: AudioNode): Voice {
  const master = ctx.createGain();
  master.gain.value = 0;
  // A gentle limiter last, so nothing the bells and the drone do together can clip.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -12;
  limiter.knee.value = 12;
  limiter.ratio.value = 6;
  master.connect(limiter).connect(destination);

  const reverb = ctx.createConvolver();
  reverb.buffer = makeImpulse(ctx, 4.5, 2.6);
  const wet = ctx.createGain();
  wet.gain.value = 0.45;
  reverb.connect(wet).connect(master);

  // --- the drone ----------------------------------------------------------------------
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 500;
  filter.Q.value = 0.6;
  const droneGain = ctx.createGain();
  droneGain.gain.value = 0;
  filter.connect(droneGain);
  droneGain.connect(master);
  droneGain.connect(reverb);

  // Three partials, each a pair slightly apart so they beat slowly against each other: the
  // movement in a drone that keeps it from sounding like a test tone.
  const partials: Array<{ osc: OscillatorNode; ratio: number; detune: number }> = [];
  const voices: Array<[number, OscillatorType, number]> = [
    [1, 'sine', 0.5],
    [1.5, 'triangle', 0.16],
    [2, 'sine', 0.12],
  ];
  for (const [ratio, type, level] of voices) {
    for (const detune of [-3, 4]) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = A3 * ratio;
      osc.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = level / 2;
      osc.connect(g).connect(filter);
      osc.start();
      partials.push({ osc, ratio, detune });
    }
  }

  // A very slow breath on the filter: the drone opens and closes over half a minute.
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 1 / 31;
  const lfoDepth = ctx.createGain();
  lfoDepth.gain.value = 180;
  lfo.connect(lfoDepth).connect(filter.frequency);
  lfo.start();

  let root = A3;
  let random = 0x2545f491;
  const roll = () => {
    random ^= random << 13;
    random ^= random >>> 17;
    random ^= random << 5;
    return (random >>> 0) / 4294967296;
  };

  function strike(frequency: number, partialRatios: number[], decay: number, level: number, at: number): void {
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, at);
    out.gain.linearRampToValueAtTime(level, at + 0.02);
    out.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    out.connect(master);
    out.connect(reverb);
    partialRatios.forEach((ratio, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = frequency * ratio;
      const g = ctx.createGain();
      g.gain.value = 1 / (i + 1.6);
      osc.connect(g).connect(out);
      osc.start(at);
      osc.stop(at + decay + 0.1);
    });
  }

  return {
    setState(state, at = ctx.currentTime): void {
      const step = LADDER_SEMITONES[Math.max(0, Math.min(LADDER_SEMITONES.length - 1, state.stage))] ?? 0;
      root = A3 * semitone(step);
      for (const p of partials) p.osc.frequency.setTargetAtTime(root * p.ratio, at, 3);
      // A star opens the filter: brighter, as it is. Rock and dust stay dark and close.
      filter.frequency.setTargetAtTime(state.luminous ? 1100 : 480, at, 4);
      droneGain.gain.setTargetAtTime(state.present ? 0.55 : 0.04, at, state.present ? 3 : 2);
    },

    setLevel(level, at = ctx.currentTime): void {
      master.gain.setTargetAtTime(Math.max(0, Math.min(1, level)) * MASTER, at, 0.6);
    },

    note(at = ctx.currentTime): void {
      // An octave or two above the drone, from the same scale, so it never clashes.
      const degree = SCALE[Math.floor(roll() * SCALE.length)] ?? 0;
      const frequency = root * 2 * semitone(degree) * (roll() < 0.3 ? 2 : 1);
      strike(frequency, [1, 2.01, 3.02], 3.2, 0.06, at);
    },

    bell(at = ctx.currentTime): void {
      // A bell's partials are not harmonic, which is what makes it a bell. These are the
      // ratios of a struck bar, close enough to a small bell.
      strike(root * 4, [1, 2.76, 5.4, 8.93], 5.5, 0.11, at);
    },

    stop(): void {
      for (const p of partials) p.osc.stop();
      lfo.stop();
      master.disconnect();
    },
  };
}

/**
 * The ambience as the game uses it: one live context, created on the first gesture after
 * sound is turned on, suspended while the tab is hidden, and sparse notes on a slow clock.
 */
export interface Ambience {
  setEnabled(on: boolean): void;
  setVolume(volume: number): void;
  setState(state: DroneState): void;
  bell(): void;
  /** Browsers only start audio from a gesture; call this from one. */
  unlock(): void;
  destroy(): void;
}

export function createAmbience(): Ambience {
  let ctx: AudioContext | null = null;
  let voice: Voice | null = null;
  let enabled = false;
  let volume = 0.6;
  let state: DroneState = { stage: 0, luminous: false, present: true };
  let noteTimer: ReturnType<typeof setTimeout> | undefined;

  function ensure(): void {
    if (ctx || !enabled) return;
    const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return;
    ctx = new Context();
    voice = buildVoice(ctx, ctx.destination);
    voice.setState(state);
    voice.setLevel(volume);
    scheduleNote();
  }

  function scheduleNote(): void {
    clearTimeout(noteTimer);
    // Sparse: somewhere between six and sixteen seconds apart, and never on a beat.
    noteTimer = setTimeout(() => {
      if (enabled && voice && ctx?.state === 'running' && state.present) voice.note();
      scheduleNote();
    }, 6000 + Math.random() * 10000);
  }

  function onVisibility(): void {
    if (!ctx) return;
    if (document.visibilityState === 'hidden') void ctx.suspend();
    else if (enabled) void ctx.resume();
  }
  document.addEventListener('visibilitychange', onVisibility);

  return {
    setEnabled(on: boolean): void {
      enabled = on;
      if (on) {
        ensure();
        void ctx?.resume();
        voice?.setLevel(volume);
      } else {
        voice?.setLevel(0);
        clearTimeout(noteTimer);
        // Let the fade finish before going quiet for good.
        setTimeout(() => {
          if (!enabled) void ctx?.suspend();
        }, 1500);
      }
    },

    setVolume(next: number): void {
      volume = next;
      if (enabled) voice?.setLevel(volume);
    },

    setState(next: DroneState): void {
      const changed =
        next.stage !== state.stage || next.luminous !== state.luminous || next.present !== state.present;
      state = next;
      if (changed) voice?.setState(state);
    },

    bell(): void {
      if (enabled && ctx?.state === 'running') voice?.bell();
    },

    unlock(): void {
      if (!enabled) return;
      ensure();
      if (ctx && ctx.state !== 'running') void ctx.resume();
    },

    destroy(): void {
      clearTimeout(noteTimer);
      document.removeEventListener('visibilitychange', onVisibility);
      voice?.stop();
      void ctx?.close();
      ctx = null;
      voice = null;
    },
  };
}

/**
 * Render a few seconds offline and report what came out. Used by the browser tests: the only
 * honest check of a synthesiser is to listen to it, and the closest a test can come is the
 * samples.
 */
export async function renderSample(seconds = 4): Promise<{ peak: number; rms: number; nan: boolean }> {
  const sampleRate = 22050;
  const ctx = new OfflineAudioContext(2, Math.floor(sampleRate * seconds), sampleRate);
  const voice = buildVoice(ctx, ctx.destination);
  voice.setState({ stage: 11, luminous: true, present: true }, 0);
  voice.setLevel(1, 0);
  voice.note(0.6);
  voice.bell(1.2);
  const buffer = await ctx.startRendering();

  let peak = 0;
  let sum = 0;
  let nan = false;
  let count = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i++) {
      const v = data[i] as number;
      if (!Number.isFinite(v)) {
        nan = true;
        continue;
      }
      peak = Math.max(peak, Math.abs(v));
      sum += v * v;
      count += 1;
    }
  }
  return { peak, rms: Math.sqrt(sum / Math.max(1, count)), nan };
}
