import { createField, type FieldRates } from '../src/render/Field';
import { STAGES } from '../src/sim/stages';

/**
 * A dev-only gallery for the shader bodies.
 *
 * The last two stages carry no mass threshold — they arrive with the supernova in Phase 3 —
 * so there is no way to see a neutron star or a black hole by playing. This mounts the field
 * on its own and drives it straight from a stage's look, which also makes it the fastest way
 * to iterate on a shader without grinding a ladder.
 *
 *   npx vite --port 4174     then open /bodies.html?stage=blackHole
 */

const parent = document.getElementById('field') as HTMLElement;
const label = document.getElementById('label') as HTMLElement;

const wanted = new URLSearchParams(location.search).get('stage') ?? 'dust';
const stage = STAGES.find((s) => s.id === wanted) ?? STAGES[0]!;
const scale = Number(new URLSearchParams(location.search).get('scale') ?? stage.look.scale);

label.textContent = `${stage.name}  ·  ${stage.look.body}`;

const field = await createField(parent, { onPulse: () => field.pulse() });

const rates: FieldRates = {
  spawnRate: 30,
  captureFraction: 0.45,
  coreScale: scale,
  coreColour: stage.look.core,
  particleColour: stage.look.particle,
  particleSize: stage.look.particleSize,
  particleCount: stage.look.particleCount,
  orbit: stage.look.orbit,
  drag: stage.look.drag,
  lifetime: stage.look.lifetime,
  width: stage.look.width,
  grain: stage.look.grain,
  tilt: stage.look.tilt,
  body: stage.look.body,
  budget: 1200,
  reducedMotion: false,
};
field.setRates(rates);

// ?cycle=<other stage> flips between the two every few seconds, which is the only way to
// watch a promotion without playing to it.
const other = new URLSearchParams(location.search).get('cycle');
if (other) {
  const second = STAGES.find((s) => s.id === other);
  if (second) {
    let showingFirst = true;
    setInterval(() => {
      showingFirst = !showingFirst;
      const look = (showingFirst ? stage : second).look;
      label.textContent = `${(showingFirst ? stage : second).name}  ·  ${look.body}`;
      field.setRates({
        ...rates,
        coreColour: look.core,
        particleColour: look.particle,
        particleSize: look.particleSize,
        particleCount: look.particleCount,
        orbit: look.orbit,
        drag: look.drag,
        lifetime: look.lifetime,
        width: look.width,
        grain: look.grain,
        tilt: look.tilt,
        body: look.body,
      });
    }, 4000);
  }
}
