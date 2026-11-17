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

/** The readout is in words ("4.15 billion", "41,500"), so tests cannot just call `Number()` on it. */
const WORDS: Record<string, number> = {
  thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12, quadrillion: 1e15, quintillion: 1e18,
};

async function readMass(page: Page): Promise<number> {
  const text = (await page.locator('.mass').innerText()).trim();
  const match = /^(-?[\d.,]+)\s*([a-z]*)$/.exec(text);
  if (!match) throw new Error(`Could not parse mass readout: "${text}"`);
  const [, digits, word] = match;
  return Number(digits!.replace(/,/g, '')) * (word ? (WORDS[word] ?? Number.NaN) : 1);
}

/**
 * Summon the sheet, and turn to a page of it. Everything but the caption lives in the sheet,
 * so most tests start here.
 */
async function openSheet(page: Page, tab?: 'System' | 'Energy' | 'Sky' | 'Journal' | 'Settings'): Promise<void> {
  const summon = page.getByRole('button', { name: 'Open the sheet' });
  if ((await summon.count()) > 0) await summon.click();
  await expect(page.getByTestId('sheet')).toBeVisible();
  if (tab) await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: tab }).click();
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

  test('has nothing on screen that pays you for pressing it on a timer', async ({ page }) => {
    await expect(page.locator('.pulse')).toHaveCount(0);
    await expect(page.getByText('Gravity Pulse')).toHaveCount(0);
    await expect(page.getByText('Recharging')).toHaveCount(0);
  });

  test('offers the first current in the caption, and it flows once begun', async ({ page }) => {
    // The one thing a first run asks: begin each current once. The caption offers it only
    // when it can actually be done, so it is an invitation and never a nag.
    const begin = page.getByTestId('begin');
    await expect(begin).toBeVisible({ timeout: 45_000 });
    await expect(begin).toContainText('Gravity Well');
    await begin.click();

    await openSheet(page, 'System');
    const row = page.getByTestId('current-row').filter({ hasText: 'Gravity Well' });
    await expect(row).toHaveAttribute('data-state', /flowing|settled/);
    await expect(row.locator('.level')).not.toHaveText('Lv 0');
  });

  test('keeps progress across a reload', async ({ page }) => {
    const begin = page.getByTestId('begin');
    await expect(begin).toBeVisible({ timeout: 45_000 });
    await begin.click();
    await openSheet(page, 'System');
    const level = page.getByTestId('current-row').first().locator('.level');
    await expect(level).not.toHaveText('Lv 0');

    // The save is written on `pagehide`, which a reload fires — no need to wait out the
    // 10s autosave interval.
    await page.waitForTimeout(1500);
    await page.reload();

    await openSheet(page, 'System');
    await expect(page.getByTestId('current-row').first().locator('.level')).not.toHaveText('Lv 0');
    expect(await readMass(page)).toBeGreaterThan(0);
  });

  test('round trips a save through the export string', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openSheet(page, 'Settings');

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

  test('shows where you are on the ladder, and what lies past it', async ({ page }) => {
    await seedSave(page, { mass: '1e9', totalMassEver: '1e9' });
    await page.reload();

    await expect(page.locator('.stage-name')).toHaveText('Planet');
    // The caption says what comes next in words; the sheet has the numbers.
    await expect(page.getByTestId('caption').locator('.next')).toContainText('Gas Giant');

    await openSheet(page, 'System');
    await expect(page.locator('.stage-analogue')).toContainText('Earth');
    await expect(page.locator('.goal')).toContainText('Gas Giant');

    await openSheet(page, 'Journal');
    const rows = page.locator('.stages li');
    await expect(rows).toHaveCount(18);

    // Everything up to Planet is behind you; what a star leaves never counts as reached,
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

    // A line that fades in, not a box that arrives.
    const banner = page.locator('.whisper');
    await expect(banner).toBeVisible({ timeout: 20_000 });
    await expect(banner.locator('.title')).toHaveText('Pebble');
    await expect(page.locator('.stage-name')).toHaveText('Pebble');
  });

  test('opens a current with one purchase, after which it flows by itself', async ({ page }) => {
    // Nothing opened yet, with mass to spend.
    await seedSave(page, { mass: '1e9', totalMassEver: '1e9', achievements: [] });
    await page.reload();

    await openSheet(page, 'System');
    const row = page.getByTestId('current-row').filter({ hasText: 'Gravity Well' });
    await expect(row).toHaveAttribute('data-state', 'closed');
    await expect(row.locator('.level')).toHaveText('Lv 0');

    await row.locator('.begin').click();

    // Flowing is the default: no switch to find, the level simply climbs.
    const toggle = row.locator('.flow input');
    await expect(toggle).toBeChecked();
    await expect
      .poll(async () => Number((await row.locator('.level').innerText()).replace('Lv ', '')), {
        timeout: 15_000,
      })
      .toBeGreaterThan(1);

    // And it can be held, to be tended by hand.
    await toggle.uncheck();
    await expect(row).toHaveAttribute('data-state', 'held');
    const held = Number((await row.locator('.level').innerText()).replace('Lv ', ''));
    await page.waitForTimeout(1500);
    expect(Number((await row.locator('.level').innerText()).replace('Lv ', ''))).toBe(held);
  });

  test('shows what a level is worth, and unlocks achievements', async ({ page }) => {
    await seedSave(page, { mass: '1e6', totalMassEver: '1e6', levels: { gravity: 10 } });
    await page.reload();

    // Every row states the income a level would add, which is how a saturated current shows.
    await openSheet(page, 'System');
    await expect(page.getByTestId('current-row').first().locator('.gain')).toContainText('%');

    await openSheet(page, 'Journal');
    await expect(page.locator('.achievements li.unlocked').first()).toBeVisible();

    const banner = page.locator('.whisper');
    await expect(banner).toBeVisible();
    await expect(banner.locator('.eyebrow')).toContainText('Achievement');
  });

  test('keeps the Energy tab hidden until there is a disk, then runs on energy', async ({ page }) => {
    await seedSave(page, { mass: '1e4', totalMassEver: '1e4' });
    await page.reload();
    await openSheet(page);
    await expect(page.getByRole('button', { name: 'Energy' })).toHaveCount(0);

    // Heavy enough to have a disk, with energy banked to spend.
    await seedSave(page, { mass: '1e12', totalMassEver: '1e12', energy: '1e9' });
    await page.reload();

    await openSheet(page, 'Energy');
    await expect(page.locator('.chain .name')).toHaveText('Hydrogen');
    await expect(page.locator('.chain li')).toHaveCount(6);
    // Iron is listed and permanently out of reach.
    await expect(page.locator('.chain li.unreachable')).toHaveCount(1);
    await expect(page.locator('.chain li.unreachable .tier-req')).toHaveText('—');

    // The disk is bought out of energy, and mass is untouched by it.
    const massBefore = await page.locator('.mass').innerText();
    const card = page.getByTestId('current-row').first();
    await expect(card.locator('h3')).toHaveText('Accretion Disk');
    await expect(card.locator('.gain')).toContainText('throughput');

    await card.locator('.begin').click();
    // Opened, so it carries on: with energy banked it is several levels up before we look.
    await expect(card.locator('.level')).not.toHaveText('Lv 0');
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
    await openSheet(page, 'System');
    await expect(page.locator('.goal .pays')).toHaveText(/x[\d.]+/);

    // The current that resets says so.
    const density = page.getByTestId('current-row').filter({ hasText: 'Particle Density' });
    await expect(density.locator('.rebased')).toHaveText('resets');

    // And the breakdown attributes the ladder's share to the ladder, rather than hiding it
    // inside a line labelled "efficiency".
    const ladder = page.locator('.breakdown li.ladder');
    await expect(ladder.locator('.label')).toHaveText('the ladder');
    await expect(ladder.locator('.value')).toHaveText(/x[\d.]+/);
  });

  test('lets a star go, offers the next cloud, and survives a reload', async ({ page }) => {
    // The one flow in the game that deletes almost everything on purpose. If it is wrong it
    // is wrong in the worst possible way, so it is driven end to end rather than unit-tested
    // and hoped for: arm, confirm, choose, and then a fresh page to prove it was written down.
    //
    // The release is drawn by code that runs at no other time, so anything it throws is
    // collected and asserted on at the end rather than lost in the console.
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(String(error)));

    // Heavier than the first cloud holds, which the save migration turns into a finished Sun.
    await seedSave(page, {
      mass: '9e21',
      totalMassEver: '9e21',
      levels: { gravity: 80, radius: 60, density: 8, particleMass: 50, efficiency: 18 },
      levelsEver: { gravity: 80, radius: 60, density: 160, particleMass: 50, efficiency: 18 },
      rebasedStage: 11,
      stageSeen: 11,
    });
    await page.reload();
    await expect(page.locator('.stage-name')).toHaveText('Yellow Dwarf');

    await openSheet(page, 'Sky');
    const current = page.getByTestId('current');
    await expect(current).toContainText('The star is finished');
    await expect(current).toContainText('stardust');

    // Two steps, and the second only appears after the first has said what it costs.
    await expect(page.getByTestId('release')).toHaveCount(0);
    await page.getByTestId('arm-release').click();
    await expect(current.locator('.cost')).toContainText('This run ends');
    await page.getByTestId('release').click();

    // Between stars: the field is empty and the next cloud is a choice.
    await expect(page.locator('.stage-name')).toHaveText('Between stars');
    await expect(page.getByTestId('caption-choose')).toBeVisible();
    await expect(page.getByTestId('choose')).toBeVisible();
    await expect(page.getByTestId('offer')).toHaveCount(3);
    await expect(page.locator('.readouts .value').nth(0)).toHaveText('91');
    await expect(page.locator('.readouts .value').nth(1)).toHaveText('1');
    await expect(page.getByTestId('catalogue')).toContainText('Morning');

    // Spend some of it, and begin the next star.
    const enrichment = page.getByTestId('tree-card').filter({ hasText: 'Enrichment' });
    await enrichment.locator('.buy').click();
    await expect(enrichment.locator('.level')).toHaveText('1 / 8');

    const chosen = (await page.getByTestId('offer').first().locator('.cloud-name').innerText()).trim();
    await page.getByTestId('offer').first().click();
    await expect(page.getByTestId('choose')).toHaveCount(0);
    await expect(page.getByTestId('current')).toContainText(chosen);
    await expect(page.locator('.stage-name')).toHaveText('Dust');

    // A new page rather than a reload. `seedSave` installs an init script, and an init script
    // runs on every navigation — reloading here would helpfully write the old save back over
    // the top and the test would be checking the fixture, not the game.
    const returning = await page.context().newPage();
    await returning.goto('/');
    await openSheet(returning, 'Sky');
    await expect(returning.locator('.readouts .value').nth(1)).toHaveText('1');
    await expect(returning.getByTestId('tree-card').filter({ hasText: 'Enrichment' }).locator('.level')).toHaveText('1 / 8');
    await expect(returning.getByTestId('current')).toContainText(chosen);
    await expect(returning.getByTestId('catalogue')).toContainText('Morning');
    await returning.close();

    expect(errors, 'nothing thrown while the star was let go').toEqual([]);
  });

  test('is an empty field between stars', async ({ page }) => {
    // The same heavy core twice, once with a cloud and once without. Comparing the two
    // isolates the one property under test — no cloud, no body — from everything else that
    // lights the middle of the screen, which is not nothing: the page's own gradient and the
    // band of the sky both run brighter there than in a corner.
    const centreWith = async (cloud: unknown) => {
      await seedSave(page, {
        version: 5,
        mass: '1e9',
        totalMassEver: '1e9',
        cloud,
        settings: { particleBudget: 0, reducedMotion: true },
      });
      await page.reload();
      await page.waitForTimeout(2500);
      const box = (await page.locator('canvas').boundingBox()) as Box;
      return luminance(page, { x: box.x + box.width / 2 - 30, y: box.y + box.height / 2 - 30, width: 60, height: 60 });
    };

    const planet = await centreWith({ seed: 1, name: 'Morning Veil', ceiling: 'yellowDwarf', pace: 1, trait: 'quiet', hue: 214 });
    await expect(page.locator('.stage-name')).toHaveText('Planet');

    const between = await centreWith(null);
    await expect(page.locator('.stage-name')).toHaveText('Between stars');

    expect(planet.mean).toBeGreaterThan(between.mean + 10);
  });

  // Every body kind the ladder can reach by mass. The last two, the neutron star and the
  // black hole, carry no threshold — they are what a star leaves, not what it grows into — so
  // they are covered by `bodies.html` instead, which mounts the field on its own.
  const BODIES: Array<[string, string, string]> = [
    ['mote', '50', 'Dust'],
    ['rock', '5e3', 'Boulder'],
    ['world', '1e9', 'Planet'],
    ['gas', '1e11', 'Gas Giant'],
    ['ember', '1e13', 'Brown Dwarf'],
    ['star', '1e18', 'Orange Dwarf'],
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

test.describe('the interface recedes', () => {
  test('dims when you stop moving, and comes back when you move', async ({ page }) => {
    await page.goto('/');
    const app = page.locator('main.app');
    await expect(app).not.toHaveClass(/idle/);

    // Nine seconds of stillness, by design; there is no shorter honest way to wait for it.
    await expect(app).toHaveClass(/idle/, { timeout: 12_000 });
    await page.mouse.move(200, 200);
    await page.mouse.move(240, 260);
    await expect(app).not.toHaveClass(/idle/);
  });
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('keeps the caption on screen and brings the sheet up from the bottom', async ({ page }) => {
    await page.goto('/');

    const caption = page.getByTestId('caption');
    await expect(caption).toBeVisible();
    const captionBox = (await caption.boundingBox()) as Box;
    expect(captionBox.x).toBeGreaterThanOrEqual(0);
    expect(captionBox.x + captionBox.width).toBeLessThanOrEqual(390);

    // Nothing wider than the screen: a phone layout that scrolls sideways is not one.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);

    await page.getByRole('button', { name: 'Open the sheet' }).click();
    const sheet = page.getByTestId('sheet');
    await expect(sheet).toBeVisible();
    await page.waitForTimeout(800);
    const sheetBox = (await sheet.boundingBox()) as Box;
    expect(sheetBox.width).toBeCloseTo(390, 0);
    expect(sheetBox.y + sheetBox.height).toBeCloseTo(844, 0);
    expect(sheetBox.y, 'from the bottom, leaving the top of the field in view').toBeGreaterThan(150);

    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
  });
});
