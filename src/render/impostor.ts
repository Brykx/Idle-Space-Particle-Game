import {
  GlProgram,
  Mesh,
  MeshGeometry,
  RendererType,
  Shader,
  UniformGroup,
  type Renderer,
} from 'pixi.js';

/**
 * Sphere impostors: one quad, and a fragment shader that pretends it is a ball.
 *
 * The canvas textures in `textures.ts` paint a *picture* of a body — the lighting is baked
 * into pixels at start-up, so the terminator never moves, the bands never flow, and the
 * silhouette is whatever the 256px canvas could resolve. That is why a gas giant reads as a
 * sticker rather than an object.
 *
 * Here the disc is computed per pixel instead. For each fragment inside the unit circle we
 * recover the sphere's surface normal (`z = sqrt(1 - x² - y²)`), and from that normal we get
 * real lighting: a terminator that curves the way a sphere's does, limb darkening towards the
 * edge, a fresnel atmosphere on the rim, and surface detail sampled in *body* space so it
 * rotates with the planet and compresses correctly towards the limb. Nothing is pre-baked and
 * nothing is stretched — the resolution is the screen's, so it stays sharp at any core size.
 *
 * The cost is one quad. The whole body is a single draw call either way; the difference is
 * that this one thinks.
 *
 * This is a spike: only the gas giant is built this way. Everything else still comes from
 * `textures.ts`, and the field falls back to the texture if the renderer is not WebGL.
 */

/** The light is upper-left and slightly behind the viewer, matching the canvas bodies. */
const LIGHT = 'vec3(-0.52, -0.58, 0.63)';

const VERTEX = `#version 300 es
in vec2 aPosition;
in vec2 aUV;

out vec2 vUV;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;

void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vUV = aUV;
}
`;

const FRAGMENT = `#version 300 es
precision highp float;

in vec2 vUV;
out vec4 finalColor;

uniform float uTime;
uniform float uAlpha;
uniform float uFlash;
/** Half-width of the antialiased rim, in units where the disc has radius 1. */
uniform float uEdge;
uniform vec3 uTint;

/** Value noise. Hash from iq; cheap, seamless in 3D, and good enough under a fbm. */
float hash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i + vec3(0, 0, 0)), hash(i + vec3(1, 0, 0)), f.x),
        mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x),
        mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}

float fbm(vec3 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    sum += amp * noise(p);
    p *= 2.03;
    amp *= 0.5;
  }
  return sum;
}

/**
 * The cloud field, in body space.
 *
 * Sampled anisotropically — five and a half times the frequency in latitude as in longitude —
 * so features come out smeared into belts without any explicit band function. The flow term shears
 * longitude by latitude, which is what gives a real gas giant its jets: neighbouring belts
 * travel at different speeds and drag their edges into curls.
 */
float clouds(vec3 b, vec3 flow) {
  float warp = fbm(b * 2.2 + flow) - 0.5;
  vec3 q = vec3(b.x * 0.70, b.y * 7.0 + warp * 1.55, b.z * 0.70);
  return fbm(q + flow);
}

void main() {
  vec2 p = vUV * 2.0 - 1.0;
  float r2 = dot(p, p);
  float d = sqrt(r2);

  // Coverage instead of a hard discard, so the silhouette has a clean edge at any size.
  float cov = 1.0 - smoothstep(1.0 - uEdge, 1.0, d);
  if (cov <= 0.0) discard;

  // The whole trick: recover the sphere's normal from the screen position.
  float z = sqrt(max(0.0, 1.0 - min(r2, 1.0)));
  vec3 n = vec3(p, z);

  // View space -> body space: tilt the pole towards us, then spin about it.
  float ct = cos(0.22), st = sin(0.22);
  vec3 t = vec3(n.x, ct * n.y - st * n.z, st * n.y + ct * n.z);
  float a = uTime * 0.075;
  float ca = cos(a), sa = sin(a);
  vec3 b = vec3(ca * t.x + sa * t.z, t.y, -sa * t.x + ca * t.z);

  float lat = b.y;
  // Differential rotation: fastest at the equator, near-still at the poles.
  vec3 flow = vec3(0.0, 0.0, uTime * 0.013 * (1.0 - 1.6 * lat * lat));

  float cloud = clouds(b, flow);
  // One extra tap in latitude gives the belts relief, so they self-shadow at the terminator.
  float slope = (clouds(b + vec3(0.0, 0.03, 0.0), flow) - cloud) * 5.0;
  vec3 nb = normalize(n + vec3(0.0, slope * 0.09, 0.0));

  float ndl = dot(nb, ${LIGHT});
  // Wrap lighting: a deep atmosphere scatters light past the geometric terminator, so the
  // day/night line on a gas giant is a gradient rather than the knife edge a rock would have.
  float diff = pow(clamp((ndl + 0.18) / 1.18, 0.0, 1.0), 0.85);
  // Limb darkening: at the edge you look through more atmosphere and see less deep cloud.
  float limb = mix(1.0, pow(z, 0.42), 0.55);

  // Three tones rather than two: dark belts, pale zones, and a bright crest on the zones,
  // which is what stops the banding reading as a smooth gradient.
  vec3 deep = uTint * 0.44;
  vec3 pale = uTint * 1.16 + vec3(0.05);
  vec3 crest = uTint * 1.55 + vec3(0.14);
  vec3 albedo = mix(deep, pale, smoothstep(0.34, 0.60, cloud));
  albedo = mix(albedo, crest, smoothstep(0.62, 0.78, cloud));

  // A storm, fixed in body space, so it rotates out of view and comes back.
  vec3 spot = normalize(vec3(0.58, -0.30, 0.76));
  float sd = distance(vec3(b.x, b.y * 2.4, b.z), vec3(spot.x, spot.y * 2.4, spot.z));
  albedo = mix(albedo, uTint * 1.45 + vec3(0.11, 0.04, 0.0), smoothstep(0.60, 0.14, sd) * 0.75);

  // Atmosphere: brightest where the limb is also lit, faint everywhere else.
  float fres = pow(1.0 - z, 3.2);
  vec3 haze = uTint * 0.45 + vec3(0.30, 0.43, 0.60);
  vec3 rim = haze * fres * (0.28 + 1.25 * clamp(ndl + 0.35, 0.0, 1.0));

  // A trace of ambient, so the night side is dark without being a hole in the screen.
  vec3 col = albedo * (diff * limb + 0.045) + rim;
  col += uFlash * 0.35 * (albedo + vec3(0.2));

  // Pixi's 2D state expects premultiplied alpha.
  float alpha = uAlpha * cov;
  finalColor = vec4(col * alpha, alpha);
}
`;

export interface Impostor {
  view: Mesh<MeshGeometry, Shader>;
  /** Advance the animation and set what the field wants shown. */
  update(time: number, state: { radius: number; tint: number; alpha: number; flash: number }): void;
  destroy(): void;
}

/**
 * Build the gas giant impostor, or return null if this renderer cannot run it.
 *
 * The shaders are GLSL, so a WebGPU renderer has nothing to compile. The app asks for WebGL,
 * but asking is not getting, and a caller that ignores the null would take the whole field
 * down over a cosmetic upgrade.
 */
export function createGasGiant(renderer: Renderer): Impostor | null {
  if (renderer.type !== RendererType.WEBGL) return null;

  // A unit quad. Local space is -1..1, so the mesh's own scale is the radius in pixels.
  const geometry = new MeshGeometry({
    positions: new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]),
    uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
  });

  // A UniformGroup flattens its structures into a plain `uniforms` map at construction, and
  // that map is what gets uploaded. Scalars are copied by value, so writing back to the
  // structure objects after this point changes nothing on the GPU — every frame's update has
  // to land on `group.uniforms`.
  const group = new UniformGroup({
    uTime: { value: 0, type: 'f32' },
    uAlpha: { value: 1, type: 'f32' },
    uFlash: { value: 0, type: 'f32' },
    uEdge: { value: 0.02, type: 'f32' },
    uTint: { value: new Float32Array([0.8, 0.7, 0.55]), type: 'vec3<f32>' },
  });

  const shader = new Shader({
    glProgram: GlProgram.from({ vertex: VERTEX, fragment: FRAGMENT, name: 'gas-giant' }),
    resources: { bodyUniforms: group },
  });

  const view = new Mesh<MeshGeometry, Shader>({ geometry, shader });
  view.visible = false;

  const live = group.uniforms;
  const tint = live.uTint as Float32Array;

  return {
    view,

    update(time, state): void {
      view.scale.set(state.radius);
      live.uTime = time;
      live.uAlpha = state.alpha;
      live.uFlash = state.flash;
      // Below a pixel or two of radius the rim would alias; above it this is a pixel wide.
      live.uEdge = Math.min(0.5, 1.5 / Math.max(2, state.radius));
      tint[0] = ((state.tint >> 16) & 0xff) / 255;
      tint[1] = ((state.tint >> 8) & 0xff) / 255;
      tint[2] = (state.tint & 0xff) / 255;
    },

    destroy(): void {
      view.destroy();
      shader.destroy(true);
      geometry.destroy();
    },
  };
}
