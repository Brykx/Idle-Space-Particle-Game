import { Container, Sprite, type Texture } from 'pixi.js';
import type { Fate } from '../sim/stages';

/**
 * Letting a star go, as something you watch.
 *
 * The sequence is decided by physics rather than taste, the same way the fates are. Under
 * eight solar masses a star puffs its envelope off as a shell of glowing gas — oxygen teal
 * inside, hydrogen rose outside, the colours planetary nebulae photograph as — and leaves a
 * white dwarf in the middle of it. Over it, the core collapses: a flash, a fast shell, a
 * neutron star. A red dwarf does neither; none has ever died. It simply goes up.
 *
 * Then, whatever the fate, a point of light in the star's own colour rises from the centre to
 * the place in your sky it will keep. That last part is the whole point of the sequence: the
 * thing you made does not vanish, it moves.
 */

export interface ReleaseSpec {
  fate: Fate;
  /** The class's colour, packed RGB. */
  colour: number;
  /** The record the rising point is carrying to its place. */
  starId: number;
}

interface Timeline {
  /** When the point leaves the centre, and how long it takes to arrive. */
  riseAt: number;
  riseFor: number;
  /** How long the remnant at the centre lingers. */
  remnantFor: number;
  /** How long the shell takes to expand and fade, and how far it goes. 0 for none. */
  shellFor: number;
  shellReach: (coreRadius: number, screenRadius: number) => number;
  flash: boolean;
  remnant: number;
  inner: number;
  outer: number;
}

const TIMELINES: Record<Fate, Timeline> = {
  ember: {
    riseAt: 1.2,
    riseFor: 4.2,
    remnantFor: 1.6,
    shellFor: 0,
    shellReach: () => 0,
    flash: false,
    remnant: 0,
    inner: 0,
    outer: 0,
  },
  nebula: {
    riseAt: 3.6,
    riseFor: 4.4,
    remnantFor: 11,
    shellFor: 9,
    shellReach: (core) => core * 4.6,
    flash: false,
    remnant: 0xe8f0ff,
    inner: 0x7fe8d8,
    outer: 0xff8fa8,
  },
  supernova: {
    riseAt: 3.2,
    riseFor: 4.4,
    remnantFor: 11,
    shellFor: 8,
    shellReach: (_core, screen) => screen * 0.62,
    flash: true,
    remnant: 0xdfefff,
    inner: 0xbcd4ff,
    outer: 0xffb070,
  },
};

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export interface ReleaseShow {
  view: Container;
  readonly running: boolean;
  start(spec: ReleaseSpec, coreRadius: number): void;
  /**
   * Advance. `target` is where the star now is on screen, since the sky turns while the point
   * travels; `arrive` is called once, when it gets there.
   */
  frame(dt: number, centre: { x: number; y: number }, screenRadius: number, target: { x: number; y: number } | null, arrive: () => void): void;
}

export function createRelease(textures: { glow: Texture; star: Texture; shell: Texture }): ReleaseShow {
  const view = new Container();

  const add = (texture: Texture): Sprite => {
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5);
    sprite.blendMode = 'add';
    sprite.visible = false;
    view.addChild(sprite);
    return sprite;
  };

  const outer = add(textures.shell);
  const inner = add(textures.shell);
  const flash = add(textures.glow);
  const remnantGlow = add(textures.glow);
  const remnant = add(textures.star);
  const riserGlow = add(textures.glow);
  const riser = add(textures.star);

  let spec: ReleaseSpec | null = null;
  let timeline: Timeline = TIMELINES.nebula;
  let t = 0;
  let core = 40;
  let arrived = false;

  function hideAll(): void {
    for (const sprite of [outer, inner, flash, remnantGlow, remnant, riserGlow, riser]) sprite.visible = false;
  }

  return {
    view,

    get running(): boolean {
      return spec !== null;
    },

    start(next: ReleaseSpec, coreRadius: number): void {
      spec = next;
      timeline = TIMELINES[next.fate];
      t = 0;
      core = Math.max(10, coreRadius);
      arrived = false;
      hideAll();
    },

    frame(dt, centre, screenRadius, target, arrive): void {
      if (!spec) return;
      t += dt;
      const tl = timeline;

      // --- the shell -------------------------------------------------------------------
      if (tl.shellFor > 0 && t < tl.shellFor) {
        const p = t / tl.shellFor;
        const reach = tl.shellReach(core, screenRadius);
        const r = core * 1.05 + (reach - core) * easeOut(p);
        const alpha = Math.min(1, t / 0.5) * Math.pow(1 - p, 1.6);
        // The texture's edge sits at 124 of its 128 pixels of radius.
        outer.visible = inner.visible = true;
        outer.position.set(centre.x, centre.y);
        inner.position.set(centre.x, centre.y);
        outer.scale.set(r / 124);
        inner.scale.set((r * 0.8) / 124);
        outer.rotation = 0.3;
        inner.rotation = 1.9 + t * 0.01;
        outer.tint = tl.outer;
        inner.tint = tl.inner;
        outer.alpha = alpha * 0.55;
        inner.alpha = alpha * 0.7;
      } else {
        outer.visible = inner.visible = false;
      }

      // --- the flash, for the stars that end at once -----------------------------------
      if (tl.flash && t < 1.8) {
        const p = t / 1.8;
        flash.visible = true;
        flash.position.set(centre.x, centre.y);
        flash.scale.set((core * (2.5 + p * 9)) / 128);
        flash.alpha = Math.pow(1 - p, 2.2) * 0.95;
        flash.tint = 0xffffff;
      } else {
        flash.visible = false;
      }

      // --- what is left at the centre ---------------------------------------------------
      if (tl.remnant && t < tl.remnantFor) {
        const fade = Math.min(1, t / 0.8) * (1 - Math.max(0, (t - tl.remnantFor + 3) / 3));
        remnant.visible = remnantGlow.visible = true;
        remnant.position.set(centre.x, centre.y);
        remnantGlow.position.set(centre.x, centre.y);
        remnant.scale.set(0.085);
        remnantGlow.scale.set(Math.max(0.12, core / 260));
        remnant.tint = remnantGlow.tint = tl.remnant;
        remnant.alpha = fade;
        remnantGlow.alpha = fade * 0.5;
      } else {
        remnant.visible = remnantGlow.visible = false;
      }

      // --- the point that rises to its place ------------------------------------------
      const riseT = (t - tl.riseAt) / tl.riseFor;
      if (riseT >= 0 && riseT < 1 && target) {
        const e = easeInOut(riseT);
        // A gentle arc rather than a straight line: things that rise into a sky curve.
        const mx = (centre.x + target.x) / 2;
        const my = Math.min(centre.y, target.y) - screenRadius * 0.12;
        const x = (1 - e) * (1 - e) * centre.x + 2 * (1 - e) * e * mx + e * e * target.x;
        const y = (1 - e) * (1 - e) * centre.y + 2 * (1 - e) * e * my + e * e * target.y;
        riser.visible = riserGlow.visible = true;
        riser.position.set(x, y);
        riserGlow.position.set(x, y);
        riser.scale.set(0.11 - 0.035 * e);
        riserGlow.scale.set(0.16 - 0.06 * e);
        riser.tint = riserGlow.tint = spec.colour;
        riser.alpha = Math.min(1, riseT * 6);
        riserGlow.alpha = 0.45 * Math.min(1, riseT * 6);
      } else {
        riser.visible = riserGlow.visible = false;
      }

      if (!arrived && (riseT >= 1 || !target)) {
        arrived = true;
        arrive();
      }

      const end = Math.max(tl.riseAt + tl.riseFor, tl.shellFor, tl.remnant ? tl.remnantFor : 0, tl.flash ? 1.8 : 0);
      if (t >= end) {
        spec = null;
        hideAll();
      }
    },
  };
}
