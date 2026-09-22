import { inflateSync } from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';

/** Drop a save straight into storage, so a test can start anywhere on the ladder. */
async function seedSave(page: Page, fields: Record<string, unknown>): Promise<void> {
  await page.addInitScript((seed) => {
    localStorage.setItem(
      'idle-space-particle-game',
      JSON.stringify({ version: 1, lastSeen: Date.now(), ...seed }),
    );
  }, fields);
}

/** The readout is formatted ("3.60 K"), so tests cannot just call `Number()` on it. */
const SUFFIXES: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };

async function readMass(page: Page): Promise<number> {
  const text = (await page.locator('.mass').innerText()).trim();
  const match = /^(-?[\d.]+)\s*([A-Za-z]*)$/.exec(text);
  if (!match) throw new Error(`Could not parse mass readout: "${text}"`);
  const [, digits, suffix] = match;
  return Number(digits) * (suffix ? (SUFFIXES[suffix] ?? Number.NaN) : 1);
}

/**
 * Just enough PNG to read pixels back: 8-bit, non-interlaced, RGB or RGBA, which is what a
 * screenshot is. So this only has to inflate the image data and undo the scanline filters.
 */
function decodePng(png: Buffer): { width: number; height: number; channels: number; pixels: Buffer } {
  let width = 0;
  let height = 0;
  let channels = 4;
  const idat: Buffer[] = [];

  for (let at = 8; at < png.length; ) {
    const length = png.readUInt32BE(at);
    const type = png.toString('ascii', at + 4, at + 8);
    const body = png.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      if (body[8] !== 8) throw new Error(`expected 8 bits per channel, got ${body[8]}`);
      if (body[9] === 2) channels = 3;
      else if (body[9] === 6) channels = 4;
      else throw new Error(`expected RGB or RGBA, got colour type ${body[9]}`);
    } else if (type === 'IDAT') {
      idat.push(body);
    }
    at += length + 12;
  }

  const raw = inflateSync(Buffer.concat(idat));
  const pixels = Buffer.alloc(width * height * channels);
  const stride = width * channels;

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] as number;
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? (pixels[y * stride + x - channels] as number) : 0;
      const b = y > 0 ? (pixels[(y - 1) * stride + x] as number) : 0;
      const c = x >= channels && y > 0 ? (pixels[(y - 1) * stride + x - channels] as number) : 0;
      const value = line[x] as number;
      let out: number;
      switch (filter) {
        case 0: out = value; break;
        case 1: out = value + a; break;
        case 2: out = value + b; break;
        case 3: out = value + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          out = value + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`unknown PNG filter ${filter}`);
      }
      pixels[y * stride + x] = out & 0xff;
    }
  }

  return { width, height, channels, pixels };
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Mean and spread of perceived brightness across a screen patch, both 0..255. */
async function luminance(page: Page, clip: Box): Promise<{ mean: number; spread: number }> {
  const shot = decodePng(await page.screenshot({ clip, scale: 'css' }));
  const pixels = shot.width * shot.height;
  const values: number[] = [];
  let total = 0;
  for (let i = 0; i < pixels; i++) {
    const at = i * shot.channels;
    const l =
      0.2126 * (shot.pixels[at] as number) +
      0.7152 * (shot.pixels[at + 1] as number) +
      0.0722 * (shot.pixels[at + 2] as number);
    values.push(l);
    total += l;
  }
  const mean = total / pixels;
  let variance = 0;
  for (const l of values) variance += (l - mean) * (l - mean);
  return { mean, spread: Math.sqrt(variance / pixels) };
}

test.describe('the game runs', () => {
  // Playwright gives each test a fresh context, so localStorage starts empty on its own.
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('starts the particle field', async ({ page }) => {
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
    // A zero-sized canvas means Pixi started and then failed to lay out.
    const size = await canvas.evaluate((el: HTMLCanvasElement) => ({ w: el.width, h: el.height }));
    expect(size.w).toBeGreaterThan(0);
    expect(size.h).toBeGreaterThan(0);
  });

  test('accrues mass on its own', async ({ page }) => {
    const first = await readMass(page);
    await page.waitForTimeout(3000);
    expect(await readMass(page)).toBeGreaterThan(first);
  });

  test('pays out a gravity pulse, then holds a cooldown', async ({ page }) => {
    const pulse = page.locator('.pulse');
    await expect(pulse).toBeEnabled();

    const before = await readMass(page);
    await pulse.click();

    await expect(pulse).toBeDisabled();
    await expect(pulse).toContainText('Recharging');
    expect(await readMass(page)).toBeGreaterThan(before);
  });

  test('buys an upgrade and raises income', async ({ page }) => {
    const buy = page.locator('.card .buy').first();
    await expect(buy).toBeEnabled({ timeout: 45_000 });

    const rateBefore = await page.locator('.rate').innerText();
    await buy.click();

    await expect(page.locator('.card .level').first()).toHaveText('Lv 1');
    await expect(page.locator('.rate')).not.toHaveText(rateBefore);
  });

  test('keeps progress across a reload', async ({ page }) => {
    const buy = page.locator('.card .buy').first();
    await expect(buy).toBeEnabled({ timeout: 45_000 });
    await buy.click();
    await expect(page.locator('.card .level').first()).toHaveText('Lv 1');

    // The save is written on `pagehide`, which a reload fires — no need to wait out the
    // 10s autosave interval.
    await page.waitForTimeout(1500);
    await page.reload();

    await expect(page.locator('.card .level').first()).toHaveText('Lv 1');
    expect(await readMass(page)).toBeGreaterThan(0);
  });

  test('round trips a save through the export string', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.getByRole('button', { name: 'Settings' }).click();

    await page.getByRole('button', { name: 'Export save' }).click();
    const saveString = await page.locator('textarea').inputValue();
    expect(saveString).toMatch(/^ISPG1\|/);

    await page.getByRole('button', { name: 'Import' }).click();
    await expect(page.locator('.message')).toContainText('Save imported');
  });

  test('credits an absence and reports it', async ({ page }) => {
    // Get a save on disk first: the reload's `pagehide` writes one.
    await page.waitForTimeout(1500);
    await page.reload();

    const massBefore = await readMass(page);

    // Wind the save's clock back an hour. Faking elapsed time is the only way to test this,
    // and it is worth the coupling to the storage key — offline progress is the feature most
    // likely to break silently.
    //
    // It has to run as an init script, not an evaluate: navigating away fires `pagehide`,
    // the running game saves, and a rewind written beforehand would be overwritten by it.
    // An init script runs in the new document, after that save and before the app boots.
    await page.addInitScript(() => {
      const KEY = 'idle-space-particle-game';
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const blob = JSON.parse(raw);
      blob.lastSeen = Date.now() - 3600_000;
      localStorage.setItem(KEY, JSON.stringify(blob));
    });

    await page.reload();

    const dialog = page.locator('dialog[open]');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('While you were away');
    await expect(dialog).toContainText('1:00:00');

    await dialog.getByRole('button', { name: 'Continue' }).click();
    await expect(dialog).toBeHidden();

    // An hour at ~1 mass/s should dwarf whatever the first few seconds earned.
    expect(await readMass(page)).toBeGreaterThan(massBefore + 3000);
  });

  test('shows where you are on the ladder, and what a collapse is for', async ({ page }) => {
    await seedSave(page, { mass: '1e9', totalMassEver: '1e9' });
    await page.reload();

    await expect(page.locator('.stage-name')).toHaveText('Planet');
    await expect(page.locator('.stage-analogue')).toContainText('Earth');
    await expect(page.locator('.goal')).toContainText('Gas Giant');

    await page.getByRole('button', { name: 'Progress' }).click();
    const rows = page.locator('.stages li');
    await expect(rows).toHaveCount(14);

    // Everything up to Planet is behind you; the collapse stages never count as reached,
    // however heavy you get, because accretion cannot take you there.
    await expect(page.locator('.stages li.reached')).toHaveCount(7);
    await expect(page.locator('.stages li.current .name')).toHaveText('Planet');
    await expect(page.locator('.stages li.collapse')).toHaveCount(2);
    await expect(page.locator('.stages li.collapse.reached')).toHaveCount(0);
  });

  test('announces a promotion once you cross a threshold', async ({ page }) => {
    // Just short of Pebble, at an opening income of about 1 mass/s.
    await seedSave(page, { mass: '90', totalMassEver: '90' });
    await page.reload();

    await expect(page.locator('.stage-name')).toHaveText('Dust');

    const banner = page.locator('.announce');
    await expect(banner).toBeVisible({ timeout: 20_000 });
    await expect(banner.locator('.title')).toHaveText('Pebble');
    await expect(page.locator('.stage-name')).toHaveText('Pebble');
  });

  test('unlocks auto-buy by investing, then spends on your behalf', async ({ page }) => {
    // Gravity Well one level short of its auto-buy threshold, with mass to spend.
    await seedSave(page, {
      mass: '1e9',
      totalMassEver: '1e9',
      levels: { gravity: 24 },
      achievements: [],
    });
    await page.reload();

    const card = page.locator('.card').first();
    await expect(card.locator('.auto.locked')).toContainText('auto at Lv 25');

    await card.locator('.buy').first().click();
    await expect(card.locator('.level')).toHaveText('Lv 25');

    const toggle = card.locator('.auto input');
    await expect(toggle).toBeVisible();
    await expect(toggle).not.toBeChecked();

    await toggle.check();
    // Once it is on, the level climbs with no further clicks.
    await expect
      .poll(async () => Number((await card.locator('.level').innerText()).replace('Lv ', '')), {
        timeout: 15_000,
      })
      .toBeGreaterThan(25);
  });

  test('shows what a level is worth, and unlocks achievements', async ({ page }) => {
    await seedSave(page, { mass: '1e6', totalMassEver: '1e6', levels: { gravity: 10 } });
    await page.reload();

    // Every card states the income a level would add, which is how a saturated upgrade shows.
    await expect(page.locator('.card .gain').first()).toContainText('%');

    await page.getByRole('button', { name: 'Progress' }).click();
    const unlockedBefore = await page.locator('.achievements li.unlocked').count();

    await page.locator('.pulse').click();
    await expect(page.locator('.achievements li.unlocked')).not.toHaveCount(unlockedBefore);

    const banner = page.locator('.announce');
    await expect(banner).toBeVisible();
    await expect(banner.locator('.eyebrow')).toHaveText('Achievement');
  });

  test('keeps the Energy tab hidden until there is a disk, then runs on energy', async ({ page }) => {
    await seedSave(page, { mass: '1e4', totalMassEver: '1e4' });
    await page.reload();
    await expect(page.getByRole('button', { name: 'Energy' })).toHaveCount(0);

    // Heavy enough to have a disk, with energy banked to spend.
    await seedSave(page, { mass: '1e12', totalMassEver: '1e12', energy: '1e9' });
    await page.reload();

    await page.getByRole('button', { name: 'Energy' }).click();
    await expect(page.locator('.chain .name')).toHaveText('Hydrogen');
    await expect(page.locator('.chain li')).toHaveCount(6);
    // Iron is listed and permanently out of reach.
    await expect(page.locator('.chain li.unreachable')).toHaveCount(1);
    await expect(page.locator('.chain li.unreachable .tier-req')).toHaveText('—');

    // The disk is bought out of energy, and mass is untouched by it.
    const massBefore = await page.locator('.mass').innerText();
    const card = page.locator('.upgrades .card').first();
    await expect(card.locator('h3')).toHaveText('Accretion Disk');
    await expect(card.locator('.gain')).toContainText('throughput');

    await card.locator('.buy').first().click();
    await expect(card.locator('.level')).toHaveText('Lv 1');
    expect(await page.locator('.mass').innerText()).not.toBe('');
    void massBefore;
  });
  test('shows what the ladder pays, and warns which card it will empty', async ({ page }) => {
    // The promotion multiplier is real whether or not it is visible, and an invisible one is
    // the exact problem it was built to fix. So both halves are asserted: what climbing pays,
    // and that the card it takes from says so before it happens.
    await seedSave(page, {
      mass: '4e9',
      totalMassEver: '4e9',
      levels: { density: 6 },
      levelsEver: { density: 90 },
      rebasedStage: 6,
      stageSeen: 6,
    });
    await page.reload();
    await expect(page.locator('.stage-name')).toHaveText('Planet');

    // What the next promotion is worth, stated before you make it.
    await expect(page.locator('.goal .pays')).toHaveText(/x[\d.]+/);

    // The card that resets says so.
    const density = page.locator('.upgrades .card', { hasText: 'Particle Density' });
    await expect(density.locator('.rebased')).toHaveText('resets');

    // And the breakdown attributes the ladder's share to the ladder, rather than hiding it
    // inside a line labelled "efficiency".
    const ladder = page.locator('.breakdown li.ladder');
    await expect(ladder.locator('.label')).toHaveText('the ladder');
    await expect(ladder.locator('.value')).toHaveText(/x[\d.]+/);
  });

  test('collapses the star, and the run after it survives a reload', async ({ page }) => {
    // The one flow in the game that deletes almost everything on purpose. If it is wrong it
    // is wrong in the worst possible way, so it is driven end to end rather than unit-tested
    // and hoped for: arm, confirm, and then reload to prove the wreckage was written down.
    await seedSave(page, {
      mass: '5e21',
      totalMassEver: '5e21',
      levels: { gravity: 80, radius: 60, density: 8, particleMass: 50, efficiency: 18 },
      levelsEver: { gravity: 80, radius: 60, density: 160, particleMass: 50, efficiency: 18 },
      rebasedStage: 11,
      stageSeen: 11,
    });
    await page.reload();
    await expect(page.locator('.stage-name')).toHaveText('Supergiant');

    await page.getByRole('button', { name: 'Collapse' }).click();
    await expect(page.locator('.offer .payout')).toContainText('stardust');

    // Two clicks, and the second only appears after the first has said what it costs.
    await expect(page.getByRole('button', { name: 'Collapse the star' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Collapse…' }).click();
    await expect(page.locator('.offer .cost')).toContainText('lose');
    await page.getByRole('button', { name: 'Collapse the star' }).click();

    // Back at the bottom, with something to show for it.
    await expect(page.locator('.stage-name')).toHaveText('Dust');
    const stardust = await page.locator('.readouts .value').first().innerText();
    expect(Number(stardust)).toBeGreaterThan(0);
    await expect(page.locator('.readouts .value').nth(1)).toHaveText('1');

    // Spend some of it, then come back in a fresh page: a collapse that is not on disk is a
    // collapse that closing the tab undoes, which is the worst bug this screen could have.
    await page.locator('.tree .card', { hasText: 'Enriched Nebula' }).locator('.buy').click();
    await expect(page.locator('.tree .card', { hasText: 'Enriched Nebula' }).locator('.level')).toHaveText('Lv 1');

    // A new page rather than a reload. `seedSave` installs an init script, and an init script
    // runs on every navigation — reloading here would helpfully write the pre-collapse save
    // back over the top and the test would be checking the fixture, not the game.
    const returning = await page.context().newPage();
    await returning.goto('/');
    await returning.getByRole('button', { name: 'Collapse' }).click();
    await expect(returning.locator('.readouts .value').nth(1)).toHaveText('1');
    await expect(returning.locator('.tree .card', { hasText: 'Enriched Nebula' }).locator('.level'))
      .toHaveText('Lv 1');
    await expect(returning.locator('.stage-name')).toHaveText('Dust');
    await returning.close();
  });

  // Every body kind the ladder can reach by mass. The last two stages, the neutron star and
  // the black hole, carry no threshold — they arrive with the supernova in Phase 3 — so they
  // are covered by `bodies.html` instead, which mounts the field on its own.
  const BODIES: Array<[string, string, string]> = [
    ['mote', '50', 'Dust'],
    ['rock', '5e3', 'Boulder'],
    ['world', '1e9', 'Planet'],
    ['gas', '1e11', 'Gas Giant'],
    ['ember', '1e13', 'Brown Dwarf'],
    ['star', '1e18', 'Star'],
  ];

  for (const [kind, mass, label] of BODIES) {
    test(`draws the ${kind} body with its shader`, async ({ page }) => {
      // A shader that fails to compile does not throw: Pixi warns and draws nothing, and the
      // core sprite is held at zero alpha while the mesh owns that slot. So this watches the
      // console for the failure, and then checks the screen for its consequence.
      const complaints: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error' || message.type() === 'warning') complaints.push(message.text());
      });
      page.on('pageerror', (error) => complaints.push(String(error)));

      // No particles and no motion. With the field running, a bright drift of infalling
      // specks across the middle of the screen is enough on its own to pass a brightness
      // check, so a body that silently draws nothing would sail through — which is exactly
      // what this is here to catch. Emptying the pool leaves only the body.
      await seedSave(page, {
        mass,
        totalMassEver: mass,
        settings: { particleBudget: 0, reducedMotion: true },
      });
      await page.reload();
      await expect(page.locator('.stage-name')).toHaveText(label);

      // Give it real frames: a program is compiled on its first draw, not at construction.
      await page.waitForTimeout(1500);
      expect(complaints.filter((text) => /shader|program|glsl|compil/i.test(text))).toEqual([]);

      const box = (await page.locator('canvas').boundingBox()) as Box;
      const centre = await luminance(page, {
        x: box.x + box.width / 2 - 20,
        y: box.y + box.height / 2 - 20,
        width: 40,
        height: 40,
      });
      const empty = await luminance(page, { x: box.x + 8, y: box.y + 8, width: 40, height: 40 });

      // Brighter than empty space, obviously. But brightness alone is not enough: the halo
      // sprite behind the core is bright too, and a body that compiled and then drew nothing
      // hides behind it — measured at 15 against a threshold of 13, which is a test that
      // passes for the wrong reason. So the patch also has to have *structure*: a
      // terminator, or craters, or belts, or granules. A glow is smooth; a body is not.
      //
      // Measured spread with the bodies working runs from 11 (dust, which really is a smooth
      // cloud) to 45 (the brown dwarf). With the body drawing nothing it is 1. The bound sits
      // between those, nearer the floor, so neither a dimmer dust cloud nor a smoother star
      // turns this red without something actually being wrong.
      expect(centre.mean).toBeGreaterThan(empty.mean * 2 + 6);
      expect(centre.spread).toBeGreaterThan(6);
    });
  }
});
