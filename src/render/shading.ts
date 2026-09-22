import type { BodyKind } from '../sim/stages';

/**
 * The GLSL that makes each stage an object rather than a picture of one.
 *
 * Every body is one quad. The fragment shader recovers the sphere's surface normal from the
 * fragment's own position -- `z = sqrt(1 - x^2 - y^2)` -- and everything else follows from
 * that normal, computed at the screen's resolution rather than baked into a texture at
 * start-up. So the terminator curves, the limb darkens, the surface turns, and none of it
 * stretches when the core grows.
 *
 * Each kind supplies one function:
 *
 *   vec4 shade(vec2 p, float d)
 *
 * where `p` is the fragment in body radii (so the body's surface is at |p| = 1, and the quad
 * reaches out to `uExtent` for anything that has an atmosphere, a corona or a disc around
 * it), and `d` is `length(p)`. It returns straight colour and coverage; `main` premultiplies.
 *
 * The house style is restraint. Everything turns slowly enough that you notice only by
 * looking away and back, nothing flickers, nothing is fully saturated, and every edge is soft
 * except the two the physics insists on: a black hole's shadow and its photon ring.
 */

/** Upper-left and slightly towards the viewer. One light, for the whole ladder. */
const LIGHT = 'vec3(-0.52, -0.58, 0.63)';

const PREAMBLE = `#version 300 es
precision highp float;

in vec2 vUV;
out vec4 finalColor;

uniform float uTime;
uniform float uAlpha;
uniform float uFlash;
/** One screen pixel, in body radii. Every soft edge is this wide, so nothing ever aliases. */
uniform float uEdge;
/** Half-width of the quad, in body radii. */
uniform float uExtent;
uniform vec3 uTint;
uniform float uSeed;

const vec3 LIGHT = normalize(${LIGHT});

/** Value noise. Hash from iq: cheap, seamless in 3D, and good enough under an fbm. */
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

/**
 * Every octave has to be rotated as well as scaled.
 *
 * Value noise is built on an axis-aligned lattice, and stacking octaves that all share those
 * axes lines their features up: the lattice planes cut the sphere in the same places at every
 * scale and show through as straight creases. On a star it came out as a bright Y across the
 * disc. Turning each octave off-axis scatters the planes instead of stacking them.
 */
const mat3 ROT = mat3(0.00, 0.80, 0.60, -0.80, 0.36, -0.48, -0.60, -0.48, 0.64);

float fbm2(vec3 p) {
  float s = noise(p) * 0.62;
  return (s + noise(ROT * p * 2.02 + vec3(0.13, 0.71, 0.29)) * 0.31) * 1.07;
}

/** A single ridged octave, for detail that only ever needed one. */
float crease(vec3 p) {
  return 1.0 - abs(2.0 * noise(p) - 1.0);
}

float fbm3(vec3 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) {
    s += a * noise(p);
    p = ROT * p * 2.02 + vec3(0.13, 0.71, 0.29);
    a *= 0.5;
  }
  return s * 1.14;
}

float fbm4(vec3 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * noise(p);
    p = ROT * p * 2.02 + vec3(0.13, 0.71, 0.29);
    a *= 0.5;
  }
  return s * 1.07;
}

/**
 * Ridged noise: fold the value noise about its midpoint so the peaks become creases. It is
 * what turns a smear into cells -- a bright top with a dark lane around it, which is what
 * convection looks like from outside.
 */
float ridged3(vec3 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) {
    s += a * (1.0 - abs(2.0 * noise(p) - 1.0));
    p = ROT * p * 2.06 + vec3(0.37, 0.11, 0.83);
    a *= 0.5;
  }
  return s * 1.14;
}

/** An antialiased "inside radius r" test. */
float disc(float d, float r) {
  return 1.0 - smoothstep(r - uEdge, r + uEdge, d);
}

/** The whole trick: the sphere's normal, recovered from where the fragment is. */
vec3 sphereNormal(vec2 p, float d) {
  return vec3(p, sqrt(max(0.0, 1.0 - min(d * d, 1.0))));
}

/**
 * View space -> body space: tilt the pole towards the viewer, then spin about it.
 *
 * Returned as a matrix rather than applied to a vector, because the light has to make the
 * same trip. Shading a turning body in view space means its own features are lit from a
 * direction that drifts as it rotates; doing it in body space keeps the sun where it is.
 */
mat3 toBody(float rate, float tilt) {
  float ct = cos(tilt), st = sin(tilt);
  mat3 T = mat3(1.0, 0.0, 0.0, 0.0, ct, st, 0.0, -st, ct);
  float a = uTime * rate + uSeed;
  float ca = cos(a), sa = sin(a);
  mat3 S = mat3(ca, 0.0, -sa, 0.0, 1.0, 0.0, sa, 0.0, ca);
  return S * T;
}
`;

const MAIN = `
void main() {
  vec2 p = (vUV * 2.0 - 1.0) * uExtent;
  vec4 c = shade(p, length(p));
  float a = clamp(c.a, 0.0, 1.0) * uAlpha;
  if (a <= 0.002) discard;
  // Pixi's blend factors assume premultiplied alpha, for both 'normal' and 'add'.
  finalColor = vec4(max(c.rgb, 0.0) * a, a);
}
`;

/** Dust: not a body yet, and the only kind with no surface to find. */
const MOTE = `
vec4 shade(vec2 p, float d) {
  float drift = uTime * 0.02;
  vec3 q = vec3(p * 1.5, drift);
  float n = mix(fbm3(q), fbm2(q * 2.3 + vec3(0.0, drift * 0.8, 0.0)), 0.45);

  // A cloud has no edge. The density simply runs out, and where it runs out is where the
  // stage ends -- which is the point of starting here.
  // Raising the noise to a power opens gaps in it. Without that the cloud fills in evenly
  // and reads as smoke rather than as an enormous number of separate specks.
  float density = exp(-d * d * 1.35) * (0.04 + pow(max(n, 0.0), 1.7) * 2.0);
  vec3 col = mix(uTint * 0.60, uTint * 1.15 + vec3(0.05), n);
  col += uFlash * 0.35 * uTint;
  return vec4(col, clamp(density, 0.0, 1.0) * 0.55);
}
`;

/**
 * Rock. The one kind the sphere impostor is wrong about, so the silhouette is displaced:
 * the surface sits at a radius that depends on which way you are looking, and craters and
 * grain are cut into it as a height field.
 */
const ROCK = `
float rockHeight(vec3 b) {
  return fbm4(b * 5.0) * 0.55 - ridged3(b * 2.6) * 0.80;
}

vec4 shade(vec2 p, float d) {
  if (d > 1.45) return vec4(0.0);
  mat3 M = toBody(0.026, 0.5);

  // Guess the direction this pixel looks along, ask the lump field how far away the surface
  // is that way, and test against that instead of against a circle.
  vec3 gb = M * sphereNormal(p, min(d, 0.999));
  float R = 1.0 + (fbm3(gb * 1.6) - 0.5) * 0.34;
  float cov = disc(d, R);
  if (cov <= 0.0) return vec4(0.0);

  vec3 b = M * sphereNormal(p / R, min(d / R, 0.999));
  vec3 L = M * LIGHT;

  // Relief, from the gradient of the height field along two tangents. In body space, so the
  // craters keep being lit from the same side however far the rock has turned.
  vec3 t1 = normalize(cross(b, vec3(0.0, 1.0, 0.0)) + vec3(1e-3, 0.0, 0.0));
  vec3 t2 = cross(b, t1);
  float e = 0.045;
  float h = rockHeight(b);
  vec3 nb = normalize(
    b - (t1 * (rockHeight(b + t1 * e) - h) + t2 * (rockHeight(b + t2 * e) - h)) * 2.4);

  // Regolith scatters back towards the light rather than falling off like a billiard ball,
  // which is why the moon is a flat disc at full and not a shaded ball.
  float diff = pow(clamp(dot(nb, L), 0.0, 1.0), 0.70);
  float ao = 0.70 + 0.30 * smoothstep(-0.45, 0.50, h);

  vec3 albedo = mix(uTint * 0.52, uTint * 1.08 + vec3(0.04), fbm3(b * 9.0));
  vec3 col = albedo * (diff * ao + 0.030);
  col += uFlash * 0.30 * albedo;
  return vec4(col, cov);
}
`;

/** A world: ocean, land, ice where it is cold, and weather on its own clock. */
const WORLD = `
vec4 shade(vec2 p, float d) {
  vec3 n = sphereNormal(p, min(d, 1.0));
  float mu = max(n.z, 0.0);
  float ndl = dot(n, LIGHT);

  // Air reaches past the ground, so the glow is computed everywhere and the surface only
  // inside the limb. It is brightest where you are looking through the most lit atmosphere.
  float t = max(0.0, d - 1.0);
  float air = exp(-t * 10.0);
  vec3 sky = mix(uTint * 0.5, vec3(0.42, 0.62, 0.95), 0.62);
  vec3 glow = sky * air * (0.10 + 0.95 * smoothstep(-0.28, 0.55, ndl));

  float cov = disc(d, 1.0);
  if (cov <= 0.0) return vec4(glow, air * 0.55);

  mat3 M = toBody(0.024, 0.38);
  vec3 b = M * n;
  float lat = abs(b.y);

  float land = fbm4(b * 2.1 + vec3(uSeed));
  float shelf = smoothstep(0.46, 0.51, land);
  float high = smoothstep(0.58, 0.74, land);

  vec3 deepSea = uTint * 0.30 + vec3(0.01, 0.05, 0.13);
  vec3 shallow = uTint * 0.52 + vec3(0.02, 0.12, 0.18);
  vec3 soil = uTint * 0.70 + vec3(0.09, 0.09, 0.02);
  vec3 stone = uTint * 0.60 + vec3(0.06, 0.05, 0.04);
  vec3 ground = mix(mix(deepSea, shallow, smoothstep(0.40, 0.48, land)), mix(soil, stone, high), shelf);

  // Ice where it is cold: at the poles, and anywhere high enough to be cold on its own.
  ground = mix(ground, vec3(0.90, 0.94, 1.0), clamp(smoothstep(0.62, 0.88, lat) + high * 0.30, 0.0, 1.0) * 0.8);

  // Cloud turns slower than the ground under it. That difference is most of what stops a
  // planet reading as painted.
  float cloud = smoothstep(0.50, 0.70, fbm4(toBody(0.017, 0.38) * n * 2.7 + vec3(uSeed * 2.0)));
  ground = mix(ground, vec3(0.97), cloud * 0.82);

  // Water is a mirror at a glancing angle. Land is not, and cloud is in the way.
  float spec = pow(max(0.0, dot(n, normalize(LIGHT + vec3(0.0, 0.0, 1.0)))), 46.0)
    * (1.0 - shelf) * (1.0 - cloud) * 0.55;

  float diff = pow(clamp((ndl + 0.07) / 1.07, 0.0, 1.0), 0.9);
  float limb = mix(1.0, pow(mu, 0.35), 0.40);

  vec3 col = ground * (diff * limb + 0.028) + vec3(spec) * smoothstep(-0.1, 0.3, ndl);
  // The rim is the atmosphere seen edge on, so it is thickest and brightest at the limb.
  col += sky * pow(1.0 - mu, 3.4) * (0.22 + clamp(ndl + 0.3, 0.0, 1.0)) * 0.95;
  col += uFlash * 0.30 * ground;
  return vec4(mix(glow, col, cov), max(cov, air * 0.55));
}
`;

/**
 * A gas giant. The belts are not drawn: they fall out of sampling the cloud noise seven
 * times more finely in latitude than in longitude, and a latitude-dependent shear drags
 * their edges into curls the way real zonal jets do.
 */
const GAS = `
float clouds(vec3 b, vec3 flow) {
  float warp = fbm3(b * 2.2 + flow) - 0.5;
  return fbm4(vec3(b.x * 0.70, b.y * 7.0 + warp * 1.55, b.z * 0.70) + flow);
}

vec4 shade(vec2 p, float d) {
  float t = max(0.0, d - 1.0);
  float air = exp(-t * 13.0);
  vec3 haze = uTint * 0.45 + vec3(0.30, 0.43, 0.60);

  vec3 n = sphereNormal(p, min(d, 1.0));
  float ndl = dot(n, LIGHT);
  vec3 glow = haze * air * (0.10 + 0.9 * smoothstep(-0.3, 0.5, ndl));

  float cov = disc(d, 1.0);
  if (cov <= 0.0) return vec4(glow, air * 0.45);

  mat3 M = toBody(0.075, 0.22);
  vec3 b = M * n;
  vec3 L = M * LIGHT;
  float mu = max(n.z, 0.0);

  // Differential rotation: fastest at the equator, near still at the poles.
  vec3 flow = vec3(0.0, 0.0, uTime * 0.013 * (1.0 - 1.6 * b.y * b.y));
  float cloud = clouds(b, flow);

  // One extra tap in latitude gives the belts relief, so they self-shadow at the terminator.
  vec3 nb = normalize(b + vec3(0.0, (clouds(b + vec3(0.0, 0.03, 0.0), flow) - cloud) * 0.45, 0.0));

  // Wrap lighting: a deep atmosphere scatters light past the geometric terminator, so the
  // day/night line on a gas giant is a gradient rather than the knife edge a rock has.
  float diff = pow(clamp((dot(nb, L) + 0.18) / 1.18, 0.0, 1.0), 0.85);
  float limb = mix(1.0, pow(mu, 0.42), 0.55);

  vec3 deep = uTint * 0.44;
  vec3 pale = uTint * 1.16 + vec3(0.05);
  vec3 crest = uTint * 1.55 + vec3(0.14);
  vec3 albedo = mix(deep, pale, smoothstep(0.34, 0.60, cloud));
  albedo = mix(albedo, crest, smoothstep(0.62, 0.78, cloud));

  // A storm, fixed in body space, so it turns out of view and comes back.
  vec3 spot = normalize(vec3(0.58, -0.30, 0.76));
  float sd = distance(vec3(b.x, b.y * 2.4, b.z), vec3(spot.x, spot.y * 2.4, spot.z));
  albedo = mix(albedo, uTint * 1.45 + vec3(0.11, 0.04, 0.0), smoothstep(0.60, 0.14, sd) * 0.75);

  vec3 col = albedo * (diff * limb + 0.045);
  col += haze * pow(1.0 - mu, 3.2) * (0.28 + 1.25 * clamp(dot(n, LIGHT) + 0.35, 0.0, 1.0));
  col += uFlash * 0.35 * (albedo + vec3(0.2));
  return vec4(mix(glow, col, cov), max(cov, air * 0.45));
}
`;

/**
 * A brown dwarf. The important thing is that there is no terminator: it is lit from inside,
 * so the disc is brightest where you look straight down into it and fades towards the limb,
 * which is the opposite of everything above it on the ladder.
 */
const EMBER = `
vec4 shade(vec2 p, float d) {
  float t = max(0.0, d - 1.0);
  float halo = exp(-t * 13.0);
  vec3 emberGlow = (uTint * 1.1 + vec3(0.18, 0.02, 0.0)) * halo * 0.20;

  float cov = disc(d, 1.0);
  if (cov <= 0.0) return vec4(emberGlow, halo * 0.30);

  vec3 n = sphereNormal(p, min(d, 1.0));
  mat3 M = toBody(0.030, 0.20);
  vec3 b = M * n;

  // What you see is how much glowing atmosphere you are looking through.
  float depth = pow(max(n.z, 0.0), 1.15);

  vec3 flow = vec3(0.0, 0.0, uTime * 0.008 * (1.0 - 1.4 * b.y * b.y));
  float warp = fbm3(b * 2.4 + flow) - 0.5;
  float cloud = fbm4(vec3(b.x * 0.8, b.y * 4.6 + warp * 1.3, b.z * 0.8) + flow);

  // Silicate weather: mineral cloud, cool enough to be opaque, drifting across the heat.
  vec3 hot = uTint * 1.25 + vec3(0.26, 0.04, 0.0);
  vec3 cool = uTint * 0.12 + vec3(0.02, 0.0, 0.01);
  vec3 col = mix(hot, cool, smoothstep(0.34, 0.66, cloud)) * (0.08 + depth * 0.78);
  col += uFlash * 0.40 * hot;
  return vec4(mix(emberGlow, col, cov), max(cov, halo * 0.30));
}
`;

/**
 * A star.
 *
 * Four things do the work, and all four are real: granulation (the tops of convection cells),
 * limb darkening (you see shallower, cooler gas at the edge), starspots (cool, magnetically
 * held, carried round as the star turns), and faculae (the bright walls of the granules,
 * which only show up near the limb where you are looking sideways into them). Outside the
 * surface there is a thin chromosphere and a corona that fans out further in some directions
 * than others.
 *
 * Everything moves, nothing flickers. The granules churn over about a minute; the spots take
 * several minutes to cross the disc.
 */
const STAR = `
/**
 * Starspots sit in two activity belts either side of the equator, and each is a dark umbra
 * inside a softer penumbra -- the same structure as a sunspot, at the same rough contrast.
 */
float spotField(vec3 b) {
  float s = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float lon = uSeed * 3.1 + fi * 2.37;
    float lat = (mod(fi, 2.0) < 1.0 ? 0.30 : -0.26) + fi * 0.04;
    vec3 c = vec3(cos(lat) * cos(lon), sin(lat), cos(lat) * sin(lon));
    float dd = distance(b, c);
    s = max(s, smoothstep(0.30, 0.11, dd) * 0.55 + smoothstep(0.14, 0.04, dd) * 0.45);
  }
  return clamp(s, 0.0, 1.0);
}

vec4 shade(vec2 p, float d) {
  float t = max(0.0, d - 1.0);
  float ang = atan(p.y, p.x);

  // The corona reaches further along some directions than others, and the pattern turns
  // over slowly enough that you only notice by looking away and back.
  // Both of these depend only on the angle, but they are evaluated per pixel over the whole
  // quad -- and the quad outside the star is several times the area of the star. It is the
  // most expensive part of the most expensive body, so the corona gets one cheap fbm and the
  // prominences get a single octave, and the falloff is steep enough to fit a smaller quad.
  float fan = fbm2(vec3(cos(ang) * 2.6, sin(ang) * 2.6, uTime * 0.012 + uSeed));
  float corona = exp(-t * mix(9.0, 3.2, fan)) * 0.34;
  float chromo = exp(-t * 26.0) * 0.40;

  // Prominences: loops of cooler gas held up off the surface by the magnetic field, which
  // is why they cluster in a few places round the limb instead of ringing it evenly.
  float arch = smoothstep(0.50, 0.84, noise(vec3(cos(ang) * 3.6, sin(ang) * 3.6, uTime * 0.018 + uSeed * 3.0)));
  float loops = arch * exp(-t * 14.0) * 0.70;

  vec3 hotAir = uTint * 1.15 + vec3(0.22, 0.09, 0.02);
  vec3 flame = uTint * 0.85 + vec3(0.30, 0.02, 0.0);
  vec3 outer = hotAir * (corona + chromo) + flame * loops;
  float outerA = clamp(corona * 0.9 + chromo + loops * 0.8, 0.0, 1.0);

  float cov = disc(d, 1.0);
  if (cov <= 0.0) return vec4(outer, outerA);

  vec3 n = sphereNormal(p, min(d, 1.0));
  vec3 b = toBody(0.011, 0.22) * n;
  float mu = max(n.z, 1e-3);

  // Granulation. Two scales, drifting in different directions, so the surface is never
  // still and never twitches.
  // The fine scale is a single ridged octave: it is detail on top of detail, and three
  // octaves of it cost more than the whole rest of the star for something nobody can see.
  float g = mix(ridged3(b * 9.0 + vec3(0.0, uTime * 0.05, 0.0)),
                crease(b * 20.0 - vec3(uTime * 0.04, 0.0, 0.0)), 0.45);
  // Supergranulation: a far larger, far slower cell pattern underneath the small one. It is
  // what stops the surface reading as an evenly dimpled ball.
  g *= 0.62 + noise(b * 2.6 + vec3(0.0, uTime * 0.008, 0.0)) * 0.82;

  // Limb darkening, the real law: I(mu)/I(0) = 1 - u(1 - mu), u about 0.6 in the visible.
  // It is the reason the edge of the Sun looks like an edge at all.
  float limb = 1.0 - 0.68 * (1.0 - mu);
  float faculae = smoothstep(0.55, 0.92, fbm2(b * 7.0 + vec3(uSeed))) * (1.0 - mu) * 0.30;

  float bright = limb * (0.76 + g * 0.44) * (1.0 - spotField(b) * 0.72) + faculae;

  // A star's colour is its temperature, and the limb is genuinely cooler than the centre --
  // you are looking at shallower, cooler gas. So the ramp runs from ember red at the edge
  // through the stage's own colour to near-white in the hottest granules, multiplied by the
  // tint rather than mixed towards it, which keeps a red dwarf red and a supergiant amber
  // while giving all three the same physics.
  vec3 cold = uTint * vec3(0.80, 0.30, 0.09);
  vec3 warm = uTint * vec3(1.12, 0.82, 0.44);
  vec3 hot = mix(uTint, vec3(1.0), 0.50) * 1.05;
  vec3 col = bright < 0.56
    ? mix(cold, warm, smoothstep(0.16, 0.58, bright))
    : mix(warm, hot, smoothstep(0.54, 1.06, bright));

  // The exposure matters more here than anywhere else on the ladder. A star is the one body
  // bright enough to clip, and everything worth looking at -- the granules, the spots, the
  // limb itself -- lives in the top fifth of the range that clipping throws away.
  col *= 0.14 + bright * 0.62;
  col += uFlash * 0.40 * hot;
  return vec4(mix(outer, col, cov), max(cov, outerA));
}
`;

/**
 * A neutron star is the size of a city, so none of the drama is on its surface. It is a hard
 * point, a trapped ring of plasma, and two beams along a magnetic axis tilted away from the
 * spin axis -- which is the entire reason a pulsar pulses rather than just shines.
 */
const REMNANT = `
vec4 shade(vec2 p, float d) {
  // The surface is not flat white: it runs up to white-hot at the centre and falls away, or
  // the whole body clips to a paper disc and the thing looks like a hole in the screen.
  float edge = disc(d, 0.30);
  float core = edge * (0.52 + 0.80 * exp(-d * d * 9.0));
  // Gravity bends light round it hard enough that you see past the horizon of the sphere,
  // and the far surface piles up as a thin bright ring at the limb.
  float halo = exp(-abs(d - 0.30) * 38.0) * 0.40;
  float glow = exp(-max(0.0, d - 0.30) * 5.2);

  // The real thing turns hundreds of times a second. Here it sweeps, because a strobe at
  // that rate would be unwatchable and would say less about what is happening.
  float a = uTime * 0.30 + uSeed;
  vec2 axis = normalize(vec2(cos(a) * 0.94, -0.36));
  vec2 dir = d > 1e-4 ? p / d : vec2(0.0, 1.0);
  float beam = pow(smoothstep(0.87, 1.0, abs(dot(dir, axis))), 3.0) * exp(-d * 1.0) * 0.85;
  // Brightest side on, dimmest pointing at you: the beam sweeps past rather than blinking.
  beam *= 0.35 + 0.65 * abs(cos(a));

  float torus = exp(-abs(d - 0.72) * 7.0) * 0.15;

  vec3 white = mix(uTint, vec3(0.88, 0.94, 1.0), 0.80);
  vec3 col = white * (core + halo + glow * 0.55 + beam + torus);
  col += uFlash * 0.50 * white;
  return vec4(col, clamp(edge + halo + glow * 0.5 + beam * 0.8 + torus, 0.0, 1.0));
}
`;

/**
 * A black hole, seen from a shallow angle.
 *
 * The disc runs across the middle as an ellipse, and the far side of it is bent up over the
 * shadow and down under it, because light leaving the back of the disc curves round and
 * reaches you anyway. The near edge is brighter than the far edge: the side rotating towards
 * you is beamed. Inside it all is the shadow, which is not dark so much as absent, and the
 * photon ring at its edge -- light that went round and came back.
 */
const HOLE = `
vec4 shade(vec2 p, float d) {
  const float SHADOW = 0.42;
  const float SQUASH = 0.19;

  float a = uTime * 0.05 + uSeed;

  // The flat disc in its own plane. Squashing y turns the circle into the ellipse you see
  // from nearly edge on.
  vec2 e = vec2(p.x, p.y / SQUASH);
  float er = length(e);
  float eang = atan(e.y, e.x);
  float swirl = fbm2(vec3(cos(eang + er * 1.6) * 1.4, sin(eang + er * 1.6) * 1.4, a * 2.0));

  float band = smoothstep(0.64, 0.84, er) * (1.0 - smoothstep(1.50, 2.30, er));
  band *= 0.50 + swirl * 0.95;
  // Doppler beaming, which is why one side of the ring is so much brighter than the other.
  band *= 0.30 + 1.55 * smoothstep(-1.0, 1.0, cos(eang));

  // The far side, lensed over the top and under the bottom.
  float arc = exp(-abs(d - 0.78) * 12.0) * smoothstep(0.0, 0.32, abs(p.y)) * (0.5 + swirl * 0.7) * 0.5;

  float ring = exp(-abs(d - SHADOW - 0.035) * 90.0) * 0.9;

  vec3 warm = mix(uTint, vec3(1.0, 0.86, 0.62), 0.55);
  vec3 col = warm * (band * 0.8 + arc + ring * 1.4);
  float alpha = clamp(band * 0.8 + arc + ring, 0.0, 1.0);
  col += uFlash * 0.4 * warm * (1.0 - step(0.0, -alpha));

  // Nothing behind the shadow reaches you, so it is drawn opaque black rather than left out.
  float shadow = disc(d, SHADOW);
  return vec4(mix(col, vec3(0.0), shadow), max(alpha, shadow));
}
`;

export interface BodyShader {
  /** The whole fragment program for this kind. */
  fragment: string;
  /** Half-width of the quad, in body radii -- room for atmosphere, corona or a disc. */
  extent: number;
  /** Luminous kinds add their light to the scene; solid ones sit in front of it. */
  blend: 'add' | 'normal';
  /** Decorrelates each kind's noise, so two rocky stages are not the same rock. */
  seed: number;
}

function shader(surface: string, extent: number, blend: 'add' | 'normal', seed: number): BodyShader {
  return { fragment: PREAMBLE + surface + MAIN, extent, blend, seed };
}

/**
 * The eight kinds.
 *
 * `hole` is normal-blended although it is the brightest thing on the ladder, because the one
 * thing it must be able to do is be darker than the space behind it, and additive light
 * cannot subtract.
 */
export const BODY_SHADERS: Record<BodyKind, BodyShader> = {
  mote: shader(MOTE, 2.0, 'add', 1.7),
  rock: shader(ROCK, 1.5, 'normal', 4.1),
  world: shader(WORLD, 1.35, 'normal', 9.3),
  gas: shader(GAS, 1.25, 'normal', 2.6),
  ember: shader(EMBER, 1.35, 'add', 6.4),
  star: shader(STAR, 2.0, 'add', 3.8),
  remnant: shader(REMNANT, 2.4, 'add', 8.2),
  hole: shader(HOLE, 2.8, 'normal', 5.5),
};

export const VERTEX = `#version 300 es
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
