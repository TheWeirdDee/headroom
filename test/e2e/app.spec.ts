// The front door, the run screen, the source drawer, questions, the column mapper and the KPO book,
// driven in a real browser (PRD 20: Landing, mute test elements, mapping).
import { test, expect, type Page } from '@playwright/test';

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}]/u;

async function noEmoji(page: Page): Promise<void> {
  expect(EMOJI.test(await page.locator('body').innerText())).toBe(false);
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

test('landing states the problem with a source and routes to intake', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Every number proven');
  await expect(page.getByText('nije se menjao još od 2013')).toBeVisible();
  await expect(page.getByRole('link', { name: /Biznis\.rs/ }).first()).toHaveAttribute('href', /biznis\.rs/);
  await expect(page.getByText('Not financial or tax advice').first()).toBeVisible();
  await noEmoji(page);
  await page.getByRole('main').getByRole('link', { name: 'Check my invoice' }).click();
  await expect(page).toHaveURL(/\/check$/);
  expect(errors).toEqual([]);
});

test('sample run: lanes, verified board, headroom card, findings, drawer, questions, KPO', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Try with sample data' }).click();
  await expect(page).toHaveURL(/\/runs\/run-/);

  // Seven agent lanes and the always-visible top band.
  await expect(page.getByRole('list', { name: 'Agents' }).getByRole('listitem')).toHaveCount(7);
  await expect(page.getByRole('note', { name: 'Status of this run' })).toContainText('SAMPLE (SYNTHETIC)');

  // The card appears only once totals are verified, and shows the crossing attribution.
  const card = page.getByRole('region', { name: 'Headroom' });
  await expect(card.getByText('left after this invoice')).toBeVisible({ timeout: 30_000 });
  await expect(card.getByText('A correction changes the band')).toBeVisible();
  // A reload rebuilds the view from the snapshot: the crossing, which is not on the board, is kept.
  await page.reload();
  await expect(card.getByText('A correction changes the band')).toBeVisible({ timeout: 30_000 });

  // Planted discrepancies are listed with their type.
  for (const t of ['E1', 'E2', 'E3', 'E5', 'E9'])
    await expect(page.getByRole('tabpanel').getByText(t, { exact: true })).toBeVisible();

  // Every number opens its sources: the draft in RSD is derived from an NBS rate.
  await card.getByRole('button', { name: /RSD/ }).first().click();
  const drawer = page.getByRole('dialog', { name: 'Figure sources' });
  await expect(drawer.getByText('Verifier checks')).toBeVisible();
  await expect(drawer.getByText('Computed from')).toBeVisible();
  await drawer.getByRole('button', { name: /fx:EUR/ }).click();
  await expect(drawer.getByRole('link', { name: /kurs/i }).first()).toBeVisible();
  await drawer.getByRole('button', { name: 'Back' }).click();
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();

  // Questions: answer one; it shows as answered.
  await page.getByRole('tab', { name: /Questions/ }).click();
  const first = page.getByRole('tabpanel').getByRole('listitem').first();
  await first.getByRole('button').first().click();
  await expect(first.getByText('Answered. You can change it.')).toBeVisible();

  // The board filters.
  await page.getByRole('textbox', { name: 'Search by key' }).fill('total:limit6m');
  await expect(
    page.getByRole('region', { name: 'Figure Board' }).getByText('total:limit6m:committed'),
  ).toBeVisible();

  await noEmoji(page);
  await page.getByRole('link', { name: 'KPO book' }).click();
  await expect(
    page.getByRole('region', { name: 'KPO book' }).getByText('Svega prihodi od delatnosti (3 + 4)'),
  ).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Correction log' }).getByText('E3', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Correction log' }).getByText('E9', { exact: true }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('an unrecognised CSV opens the column mapper before the check can start', async ({ page }) => {
  await page.goto('/check');
  const csv =
    'Kol1|ignored\nWhen;What;How much\n05.01.2026;Uplata 2026-001;120.000,00\n06.01.2026;Provizija;-150,50\n';
  await page
    .getByLabel('Choose files')
    .setInputFiles({ name: 'izvod.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  const dialog = page.getByRole('dialog', { name: 'Which column is which?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Save mapping' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Choose a column');
  // The header is on line 2 here: the user says so and the preview is re-read.
  await dialog.getByLabel('Header is on line').fill('2');
  await expect(dialog.getByRole('columnheader', { name: '3. How much' })).toBeVisible();
  await dialog.getByLabel('Date (required)').selectOption({ label: '1. When' });
  await dialog.getByLabel(/^Amount/).selectOption({ label: '3. How much' });
  await dialog.getByLabel('Account currency (if no column)').selectOption('RSD');
  await dialog.getByRole('button', { name: 'Save mapping' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Columns mapped')).toBeVisible();
  await page.getByRole('button', { name: 'Delete my files' }).click();
  await expect(page.getByText('izvod.csv')).toHaveCount(0);
});

test('about lists every rule with its status and sources; evidence says when there are no results', async ({
  page,
}) => {
  await page.goto('/about#R-VAT-8M-BASIS');
  const rule = page.locator('#R-VAT-8M-BASIS');
  await expect(rule.getByText('Assumption')).toBeVisible();
  await expect(rule.getByRole('link').first()).toHaveAttribute('href', /^https:\/\//);
  await page.goto('/evidence');
  await expect(page.getByText('No evaluation results yet')).toBeVisible();
  await noEmoji(page);
});
