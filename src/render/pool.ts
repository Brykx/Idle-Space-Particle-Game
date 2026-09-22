/**
 * The particle pool: fixed capacity, parallel typed arrays, zero allocation after construction.
 *
 * GC pauses are what actually break 60 fps in a field like this, not draw calls — so nothing
 * is ever `new`-ed per spawn. A dead particle is a slot pushed back onto the free list.
 *
 * No Pixi in here, and no game state either. This is cosmetics with a physics flavour: the
 * economy decides income, and this decides what that income looks like.
 */

export interface FieldGeometry {
  centreX: number;
  centreY: number;
  /** Particles appear out here. */
  spawnRadius: number;
  /** Absorbed once inside this. */
  coreRadius: number;
}

export interface PoolTuning {
  /** GM, in px^3/s^2. Sets how briskly things fall in. */
  gravity: number;
  /** Per-second velocity damping applied to particles on a capture trajectory. */
  captureDrag: number;
  /**
   * Tangential speed of a capture trajectory as a fraction of the local circular-orbit speed,
   * sampled between the two. Near 1 it holds an orbit and loiters; near 0 it drops straight in.
   * Comes from the current stage, which is what makes dust drift and a supergiant swallow.
   */
  captureTangential: [number, number];
  /** Seconds before an unabsorbed particle gives up and fades. */
  lifetime: number;
}

export const DEFAULT_TUNING: PoolTuning = {
  gravity: 2.6e7,
  captureDrag: 0.3,
  captureTangential: [0.12, 0.46],
  lifetime: 11,
};

/** Stops acceleration going to infinity as r approaches zero. */
const MIN_RADIUS = 18;

export class ParticlePool {
  capacity = 0;

  x!: Float32Array;
  y!: Float32Array;
  vx!: Float32Array;
  vy!: Float32Array;
  /** Seconds of life remaining. */
  ttl!: Float32Array;
  /** 0..1, fades in on spawn and out on death. */
  alpha!: Float32Array;
  /** Visual size multiplier. */
  size!: Float32Array;
  active!: Uint8Array;
  /** Capture trajectories get drag; flybys do not. */
  captured!: Uint8Array;

  private free!: Int32Array;
  private freeCount = 0;

  /** Absorptions since the last `drainAbsorbed()`. Drives the core's flash. */
  private absorbed = 0;
  /** Fractional particles carried between frames, so low spawn rates still spawn. */
  private spawnCredit = 0;

  constructor(capacity: number) {
    this.resize(capacity);
  }

  get liveCount(): number {
    return this.capacity - this.freeCount;
  }

  /** Rebuild at a new capacity. Called when the player moves the budget slider, not per frame. */
  resize(capacity: number): void {
    const n = Math.max(0, Math.floor(capacity));
    this.capacity = n;
    this.x = new Float32Array(n);
    this.y = new Float32Array(n);
    this.vx = new Float32Array(n);
    this.vy = new Float32Array(n);
    this.ttl = new Float32Array(n);
    this.alpha = new Float32Array(n);
    this.size = new Float32Array(n);
    this.active = new Uint8Array(n);
    this.captured = new Uint8Array(n);

    this.free = new Int32Array(n);
    for (let i = 0; i < n; i++) this.free[i] = i;
    this.freeCount = n;
    this.spawnCredit = 0;
    this.absorbed = 0;
  }

  private take(): number {
    if (this.freeCount === 0) return -1;
    this.freeCount -= 1;
    return this.free[this.freeCount] ?? -1;
  }

  private release(i: number): void {
    if (this.active[i] === 0) return;
    this.active[i] = 0;
    this.alpha[i] = 0;
    this.free[this.freeCount] = i;
    this.freeCount += 1;
  }

  drainAbsorbed(): number {
    const n = this.absorbed;
    this.absorbed = 0;
    return n;
  }

  /**
   * Spawn one particle at the rim.
   *
   * `willBeCaptured` is rolled by the caller from the economy's capture fraction, so the
   * screen shows the same ratio of catches to near-misses that the number is built from.
   */
  spawn(geo: FieldGeometry, tuning: PoolTuning, willBeCaptured: boolean): void {
    const i = this.take();
    if (i < 0) return;

    const angle = Math.random() * Math.PI * 2;
    const r = geo.spawnRadius * (0.92 + Math.random() * 0.16);

    this.x[i] = geo.centreX + Math.cos(angle) * r;
    this.y[i] = geo.centreY + Math.sin(angle) * r;

    // Circular-orbit speed at this radius; everything else is expressed relative to it.
    const orbital = Math.sqrt(tuning.gravity / r);

    // Tangential component decides the shape of the path: under orbital speed it spirals in,
    // over it swings past and leaves.
    // Captured particles start well under orbital speed and aimed inward, so they visibly
    // fall rather than loitering in a wide orbit off-screen. Flybys start above it and swing
    // past — the near-misses are what make the capture fraction legible.
    const [tanMin, tanMax] = tuning.captureTangential;
    const tangential = willBeCaptured
      ? orbital * (tanMin + Math.random() * Math.max(0, tanMax - tanMin))
      : orbital * (0.5 + Math.random() * 0.35);
    const radial = willBeCaptured
      ? -orbital * (0.35 + Math.random() * 0.4)
      : -orbital * (0.4 + Math.random() * 0.4);

    const spin = Math.random() < 0.5 ? 1 : -1;
    const tx = -Math.sin(angle) * spin;
    const ty = Math.cos(angle) * spin;
    const rx = Math.cos(angle);
    const ry = Math.sin(angle);

    this.vx[i] = tx * tangential + rx * radial;
    this.vy[i] = ty * tangential + ry * radial;

    this.ttl[i] = tuning.lifetime * (0.7 + Math.random() * 0.6);
    this.alpha[i] = 0;
    this.size[i] = 0.55 + Math.random() * 0.75;
    this.active[i] = 1;
    this.captured[i] = willBeCaptured ? 1 : 0;
  }

  /** Queue `rate` particles per second, carrying the fraction across frames. */
  emit(dt: number, rate: number, geo: FieldGeometry, tuning: PoolTuning, captureFraction: number): void {
    if (!(rate > 0)) return;
    this.spawnCredit += rate * dt;

    // Never let a huge rate and a long frame try to fill the whole pool at once.
    let budget = Math.min(this.spawnCredit, this.freeCount, 400);
    while (budget >= 1) {
      this.spawn(geo, tuning, Math.random() < captureFraction);
      this.spawnCredit -= 1;
      budget -= 1;
    }
    if (this.spawnCredit > 4) this.spawnCredit = 4;
  }

  /**
   * Integrate one frame.
   *
   * `pulseStrength` multiplies gravity for the brief moment after a Gravity Pulse, which is
   * what makes the click look like it did something.
   */
  update(dt: number, geo: FieldGeometry, tuning: PoolTuning, pulseStrength = 1): void {
    const gm = tuning.gravity * pulseStrength;
    const coreR2 = geo.coreRadius * geo.coreRadius;
    const killR = geo.spawnRadius * 1.9;
    const killR2 = killR * killR;
    const minR2 = MIN_RADIUS * MIN_RADIUS;

    for (let i = 0; i < this.capacity; i++) {
      if (this.active[i] === 0) continue;

      const dx = geo.centreX - (this.x[i] as number);
      const dy = geo.centreY - (this.y[i] as number);
      const r2 = dx * dx + dy * dy;

      if (r2 <= coreR2) {
        this.release(i);
        this.absorbed += 1;
        continue;
      }

      const r = Math.sqrt(r2);
      const accel = gm / Math.max(r2, minR2);
      let vx = (this.vx[i] as number) + (dx / r) * accel * dt;
      let vy = (this.vy[i] as number) + (dy / r) * accel * dt;

      if (this.captured[i] === 1) {
        const damp = Math.max(0, 1 - tuning.captureDrag * dt);
        vx *= damp;
        vy *= damp;
      }

      this.vx[i] = vx;
      this.vy[i] = vy;
      this.x[i] = (this.x[i] as number) + vx * dt;
      this.y[i] = (this.y[i] as number) + vy * dt;

      const ttl = (this.ttl[i] as number) - dt;
      this.ttl[i] = ttl;

      if (ttl <= 0 || r2 > killR2) {
        this.release(i);
        continue;
      }

      // Fade in quickly, fade out over the last second, and brighten as it nears the core.
      const fadeIn = Math.min(1, (tuning.lifetime - ttl) * 4);
      const fadeOut = Math.min(1, ttl);
      // Brighten steeply on approach: the last stretch into the core is the part worth watching.
      const proximity = 0.45 + 0.55 * Math.min(1, (geo.spawnRadius * 0.5) / Math.max(r, 1));
      this.alpha[i] = Math.min(1, fadeIn * fadeOut * proximity);
    }
  }

  /** Give every live particle a hard shove inward. The visible half of a Gravity Pulse. */
  kick(geo: FieldGeometry, strength: number): void {
    for (let i = 0; i < this.capacity; i++) {
      if (this.active[i] === 0) continue;
      const dx = geo.centreX - (this.x[i] as number);
      const dy = geo.centreY - (this.y[i] as number);
      const r = Math.sqrt(dx * dx + dy * dy) || 1;
      this.vx[i] = (this.vx[i] as number) + (dx / r) * strength;
      this.vy[i] = (this.vy[i] as number) + (dy / r) * strength;
      // A pulse drags everything onto a capture trajectory; that is the point of it.
      this.captured[i] = 1;
    }
  }

  clear(): void {
    for (let i = 0; i < this.capacity; i++) this.release(i);
  }
}
