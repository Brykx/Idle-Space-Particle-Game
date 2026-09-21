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
    await page.locator('.settings summary').click();

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

    await page.locator('.stages summary').click();
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
});
