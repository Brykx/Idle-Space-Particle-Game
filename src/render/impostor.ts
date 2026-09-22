import {
  Container,
  GlProgram,
  Mesh,
  MeshGeometry,
  RendererType,
  Shader,
  UniformGroup,
  type Renderer,
} from 'pixi.js';
import { BODY_SHADERS, VERTEX } from './shading';
import type { BodyKind } from '../sim/stages';

/**
 * Pixi plumbing for the shader bodies. The GLSL lives in `shading.ts`; this file only builds
 * a quad per kind, hands it its uniforms, and keeps them pointing at the right values.
 *
 * One mesh per kind rather than one mesh with a switchable shader: a stage change is a
 * crossfade, so two of them have to be on screen at once, and a program swap mid-fade would
 * cut. They are cheap -- four vertices each -- and Pixi does not compile a program until the
 * first frame that draws it, so the seven you have not reached yet cost nothing.
 */

export interface BodyState {
  /** On-screen radius of the body itself, in pixels. The quad is wider. */
  radius: number;
  /** Packed RGB from the current stage. */
  tint: number;
  /** 0..1, for the crossfade at a promotion. */
  alpha: number;
  /** 0..1, brightening from what the core just absorbed. */
  flash: number;
  /** Seconds. Frozen when the player has asked for reduced motion. */
  time: number;
}

export interface Bodies {
  /** Add this to the stage where the core belongs. */
  view: Container;
  /** Draw one kind at the given strength; anything not named this frame is hidden. */
  show(kind: BodyKind, state: BodyState, depth?: number): void;
  /** Hide everything that `show` was not called for since the last `begin`. */
  begin(): void;
  end(): void;
  destroy(): void;
}

interface Entry {
  mesh: Mesh<MeshGeometry, Shader>;
  uniforms: Record<string, unknown>;
  tint: Float32Array;
  extent: number;
  shader: Shader;
  geometry: MeshGeometry;
}

function build(kind: BodyKind): Entry {
  const spec = BODY_SHADERS[kind];

  // Local space runs to +/- extent so the body's own radius is 1, whatever room the kind
  // needs around it for an atmosphere, a corona or a disc.
  const e = spec.extent;
  const geometry = new MeshGeometry({
    positions: new Float32Array([-e, -e, e, -e, e, e, -e, e]),
    uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
  });

  // A UniformGroup flattens its structures into a `uniforms` map at construction and copies
  // scalars by value, so writing back to the structures uploads nothing. Every frame's
  // update has to land on `group.uniforms`.
  const group = new UniformGroup({
    uTime: { value: 0, type: 'f32' },
    uAlpha: { value: 1, type: 'f32' },
    uFlash: { value: 0, type: 'f32' },
    uEdge: { value: 0.02, type: 'f32' },
    uExtent: { value: e, type: 'f32' },
    uTint: { value: new Float32Array([0.8, 0.7, 0.55]), type: 'vec3<f32>' },
    uSeed: { value: spec.seed, type: 'f32' },
  });

  const shader = new Shader({
    glProgram: GlProgram.from({ vertex: VERTEX, fragment: spec.fragment, name: `body-${kind}` }),
    resources: { bodyUniforms: group },
  });

  const mesh = new Mesh<MeshGeometry, Shader>({ geometry, shader });
  mesh.blendMode = spec.blend;
  mesh.visible = false;

  const uniforms = group.uniforms as Record<string, unknown>;
  return { mesh, uniforms, tint: uniforms.uTint as Float32Array, extent: e, shader, geometry };
}

const KINDS = Object.keys(BODY_SHADERS) as BodyKind[];

/**
 * Build the shader bodies, or return null if this renderer cannot run them.
 *
 * The shaders are GLSL, so a WebGPU renderer has nothing to compile. The app asks for WebGL,
 * but asking is not getting, and a caller that ignored the null would lose the core entirely
 * over what is meant to be a cosmetic upgrade.
 */
export function createBodies(renderer: Renderer): Bodies | null {
  if (renderer.type !== RendererType.WEBGL) return null;

  const view = new Container();
  // During a promotion two bodies are on screen at once, and which one is in front decides
  // whether the fade looks like a dissolve or like a flicker. Depth is set per frame by the
  // caller rather than left to the order these were built in.
  view.sortableChildren = true;
  const entries = new Map<BodyKind, Entry>();
  for (const kind of KINDS) {
    const entry = build(kind);
    entries.set(kind, entry);
    view.addChild(entry.mesh);
  }

  let drawn = new Set<BodyKind>();

  return {
    view,

    begin(): void {
      drawn = new Set();
    },

    show(kind, state, depth = 0): void {
      const entry = entries.get(kind);
      if (!entry) return;
      drawn.add(kind);

      entry.mesh.visible = true;
      entry.mesh.zIndex = depth;
      entry.mesh.scale.set(state.radius);

      const u = entry.uniforms;
      u.uTime = state.time;
      u.uAlpha = state.alpha;
      u.uFlash = state.flash;
      // One screen pixel, expressed in body radii, so every soft edge is a pixel wide
      // whatever size the core has reached.
      u.uEdge = Math.min(0.5, 1.5 / Math.max(2, state.radius));

      entry.tint[0] = ((state.tint >> 16) & 0xff) / 255;
      entry.tint[1] = ((state.tint >> 8) & 0xff) / 255;
      entry.tint[2] = (state.tint & 0xff) / 255;
    },

    end(): void {
      for (const [kind, entry] of entries) {
        if (!drawn.has(kind)) entry.mesh.visible = false;
      }
    },

    destroy(): void {
      for (const entry of entries.values()) {
        entry.mesh.destroy();
        entry.shader.destroy(true);
        entry.geometry.destroy();
      }
      entries.clear();
      view.destroy();
    },
  };
}
