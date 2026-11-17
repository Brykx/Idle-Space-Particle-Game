import { Container, Particle, ParticleContainer, Sprite, type Texture } from 'pixi.js';

/**
 * The night sky, and your stars in it.
 *
 * Two layers in one turning frame. The background is generated and never changes; the stars
 * you made are records, drawn brighter and in their own colours, and they turn with the rest
 * — once every couple of hours, which is slow enough that you only notice by looking away and
 * back. The turn is read from the wall clock, not from the frame counter, so the sky is where
 * you left it after a reload rather than starting again from the same angle every time.
 */

/** One of your stars, as the renderer needs it. */
export interface SkyStar {
  id: number;
  /** 0..1 records from the sim; mapped onto a ring around the centre here. */
  x: number;
  y: number;
  /** Packed RGB: the class's colour. */
  colour: number;
  /** 0 for a red dwarf through 6 for a blue supergiant. Hotter stars are brighter. */
  heat: number;
}

/** Seconds for the whole sky to turn once. */
const TURN_SECONDS = 2 * 3600;

/**
 * The sky is generated, not authored, but it should not reshuffle itself every time the
 * window is resized — a night sky that changes when you drag the corner of the browser stops
 * being a place. One seeded sequence, restarted on every rebuild.
 */
function starRandom(): () => number {
  let seed = 0x9e3779b9;
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function mixColour(a: number, b: number, t: number): number {
  const ch = (c: number, s: number) => (c >> s) & 0xff;
  const m = (s: number) => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * t);
  return (m(16) << 16) | (m(8) << 8) | m(0);
}

export interface SkyLayer {
  /** The turning frame. Add it to the stage under everything else. */
  view: Container;
  layout(width: number, height: number, reducedMotion: boolean): void;
  setStars(stars: SkyStar[]): void;
  /** Hide a star until something has brought it to its place. */
  hold(id: number | null): void;
  /** Where a star currently is on screen, in the stage's coordinates. */
  screenPositionOf(id: number): { x: number; y: number } | null;
  frame(dt: number, reducedMotion: boolean): void;
}

export function createSky(textures: { star: Texture; glow: Texture }): SkyLayer {
  const view = new Container();
  const background = new ParticleContainer({ dynamicProperties: {} });
  background.blendMode = 'add';
  const mine = new Container();
  view.addChild(background, mine);

  let width = 1;
  let height = 1;
  let stars: SkyStar[] = [];
  let held: number | null = null;
  const placed = new Map<number, { glow: Sprite; point: Sprite; reveal: number }>();

  /**
   * How far out your stars may sit: the whole of the turning disc, as the background does.
   *
   * Keeping them inside the circle that never leaves the screen was tried first, and it drew
   * them as a ring round the middle — an arrangement no sky has. A real one has stars rise
   * past the edge and set again, and so does this: at any moment most of yours are in view,
   * and the rest come round.
   */
  const reach = () => (Math.hypot(width, height) / 2) * 0.97;

  /**
   * A record's place. Spread by area rather than by radius, so the outside is not sparse, and
   * never in the very middle, which belongs to the star being made.
   */
  function place(star: SkyStar): { x: number; y: number } {
    const u = Math.min(1, Math.max(0, (star.x - 0.08) / 0.84));
    const v = Math.min(1, Math.max(0, (star.y - 0.08) / 0.84));
    const angle = u * Math.PI * 2;
    const r = reach() * Math.sqrt(0.03 + 0.97 * v);
    return { x: width / 2 + Math.cos(angle) * r, y: height / 2 + Math.sin(angle) * r };
  }

  /**
   * The background.
   *
   * Brightness is a power law, colour is temperature, and a third of it lies along a band —
   * the three things that make a sky read as a sky rather than as noise on the lens. It is
   * built over a disc that covers the screen at any angle, so the turn never shows an edge.
   */
  function rebuildBackground(reducedMotion: boolean): void {
    background.particleChildren.length = 0;
    const cx = width / 2;
    const cy = height / 2;
    const reach = Math.hypot(width, height) / 2 + 8;
    // The same density on screen as before the sky turned: scaled by the area actually drawn.
    const areaRatio = (Math.PI * reach * reach) / Math.max(1, width * height);
    const count = Math.round((reducedMotion ? 900 : 1800) * (reducedMotion ? 1 : areaRatio));
    const random = starRandom();

    const bandAngle = -0.42;
    const bandCos = Math.cos(bandAngle);
    const bandSin = Math.sin(bandAngle);
    const bandWidth = Math.min(width, height) * 0.32;

    for (let i = 0; i < count; i++) {
      const inBand = random() < 0.34;
      let x: number;
      let y: number;
      if (inBand) {
        const along = (random() - 0.5) * reach * 2;
        const across = (random() + random() - 1) * bandWidth;
        x = cx + bandCos * along - bandSin * across;
        y = cy + bandSin * along + bandCos * across;
      } else {
        const a = random() * Math.PI * 2;
        const r = Math.sqrt(random()) * reach;
        x = cx + Math.cos(a) * r;
        y = cy + Math.sin(a) * r;
      }
      if (Math.hypot(x - cx, y - cy) > reach) continue;

      const magnitude = Math.pow(random(), 3.4);
      const heat = Math.pow(random(), 1.8);
      const p = new Particle({
        texture: textures.star,
        x,
        y,
        anchorX: 0.5,
        anchorY: 0.5,
        alpha: 0.05 + magnitude * 0.95,
      });
      p.scaleX = p.scaleY = 0.012 + magnitude * 0.05;
      p.tint = mixColour(0xffd2a1, 0xcfe0ff, heat);
      background.addParticle(p);
    }
    background.update();
  }

  function rebuildMine(): void {
    const keep = new Set(stars.map((s) => s.id));
    for (const [id, sprites] of placed) {
      if (keep.has(id)) continue;
      mine.removeChild(sprites.glow, sprites.point);
      sprites.glow.destroy();
      sprites.point.destroy();
      placed.delete(id);
    }

    for (const star of stars) {
      let sprites = placed.get(star.id);
      if (!sprites) {
        const glow = new Sprite(textures.glow);
        glow.anchor.set(0.5);
        glow.blendMode = 'add';
        const point = new Sprite(textures.star);
        point.anchor.set(0.5);
        point.blendMode = 'add';
        mine.addChild(glow, point);
        sprites = { glow, point, reveal: star.id === held ? 0 : 1 };
        placed.set(star.id, sprites);
      }
      const at = place(star);
      // Brighter than anything in the background, and brighter still the hotter the class:
      // a blue supergiant should be the first thing your eye finds in your own sky.
      const size = 0.075 + star.heat * 0.008;
      sprites.point.position.set(at.x, at.y);
      sprites.point.scale.set(size);
      sprites.point.tint = mixColour(star.colour, 0xffffff, 0.25);
      sprites.glow.position.set(at.x, at.y);
      sprites.glow.scale.set(0.09 + star.heat * 0.012);
      sprites.glow.tint = star.colour;
    }
  }

  function applyReveal(): void {
    for (const [, sprites] of placed) {
      sprites.point.alpha = sprites.reveal;
      sprites.glow.alpha = sprites.reveal * 0.32;
    }
  }

  return {
    view,

    layout(w: number, h: number, reducedMotion: boolean): void {
      width = w;
      height = h;
      view.pivot.set(w / 2, h / 2);
      view.position.set(w / 2, h / 2);
      rebuildBackground(reducedMotion);
      rebuildMine();
      applyReveal();
    },

    setStars(next: SkyStar[]): void {
      stars = next;
      rebuildMine();
      applyReveal();
    },

    hold(id: number | null): void {
      if (held !== null && held !== id) {
        const previous = placed.get(held);
        if (previous) previous.reveal = Math.max(previous.reveal, 0.001);
      }
      held = id;
      const sprites = id === null ? undefined : placed.get(id);
      if (sprites) sprites.reveal = 0;
      applyReveal();
    },

    screenPositionOf(id: number): { x: number; y: number } | null {
      const star = stars.find((s) => s.id === id);
      if (!star) return null;
      const at = place(star);
      const global = view.toGlobal({ x: at.x, y: at.y });
      return { x: global.x, y: global.y };
    },

    frame(dt: number, reducedMotion: boolean): void {
      view.rotation = reducedMotion ? 0 : ((Date.now() / 1000) % TURN_SECONDS) / TURN_SECONDS * Math.PI * 2;
      // A star that has arrived fades in; one still held stays dark until it is released.
      let changed = false;
      for (const [id, sprites] of placed) {
        if (id === held || sprites.reveal >= 1) continue;
        sprites.reveal = Math.min(1, sprites.reveal + dt * 0.8);
        changed = true;
      }
      if (changed) applyReveal();
    },
  };
}
