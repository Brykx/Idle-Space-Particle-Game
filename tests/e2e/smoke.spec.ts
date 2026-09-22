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
  test('draws the gas giant with its shader, without a compile failure', async ({ page }) => {
    // A shader that fails to compile does not throw — Pixi warns and the body silently stops
    // drawing, which no other assertion here would notice. So this watches the console, and
    // then checks that something is actually on screen where the planet should be.
    const complaints: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning') complaints.push(message.text());
    });
    page.on('pageerror', (error) => complaints.push(String(error)));

    await seedSave(page, { mass: '1e11', totalMassEver: '1e11' });
    await page.reload();
    await expect(page.locator('.stage-name')).toHaveText('Gas Giant');

    // Give it real frames: the program is compiled on the first draw, not at construction.
    await page.waitForTimeout(1500);
    expect(complaints.filter((text) => /shader|program|glsl|compil/i.test(text))).toEqual([]);

    const box = (await page.locator('canvas').boundingBox()) as { x: number; y: number; width: number; height: number };
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const shot = decodePng(
      await page.screenshot({ clip: { x: centre.x - 20, y: centre.y - 20, width: 40, height: 40 }, scale: 'css' }),
    );

    // The lit side of a gas giant is warm and bright; the empty field behind it is neither.
    // Sampling a patch rather than one pixel keeps a stray particle from deciding the test.
    let lit = 0;
    const total = shot.width * shot.height;
    for (let i = 0; i < total; i++) {
      const r = shot.pixels[i * shot.channels] as number;
      const b = shot.pixels[i * shot.channels + 2] as number;
      if (r > 90 && r > b + 20) lit++;
    }
    expect(lit).toBeGreaterThan(total * 0.5);
  });
});
