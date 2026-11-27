// The front door, the run screen, the source drawer, questions, the column mapper and the KPO book,
// driven in a real browser.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
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
  // In-page navigation scrolls to its section; the docs page and FAQ are reachable.
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'FAQ' }).click();
  await expect(page.getByRole('heading', { name: 'Questions people ask first' })).toBeInViewport();
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Docs' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Using Headroom' })).toBeVisible();
  await page.goto('/');
  await noEmoji(page);
  await page.getByRole('main').getByRole('link', { name: 'Check my invoice' }).first().click();
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

  // The card gives a verdict only once every input is verified, and its headline counts the payment
  // that has no invoice; the crossing is attributed below it.
  const card = page.getByRole('region', { name: 'Headroom' });
  await expect(card.getByText(/over the limit if the payment with no invoice is invoiced/)).toBeVisible({
    timeout: 30_000,
  });
  await expect(card.getByText('Incomplete: no verdict')).toHaveCount(0);
  await expect(card.getByText('A correction changes the band')).toBeVisible();
  // A reload rebuilds the view from the snapshot: the crossing, which is not on the board, is kept.
  await page.reload();
  await expect(card.getByText('A correction changes the band')).toBeVisible({ timeout: 30_000 });

  // Planted discrepancies are listed with their type.
  for (const t of ['E1', 'E2', 'E3', 'E5', 'E9'])
    await expect(page.getByRole('tabpanel').getByText(t, { exact: true }).first()).toBeVisible();

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

test('the injected misread is labelled, rejected by the Verifier and replaced', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Catch a wrong number' }).click();
  await expect(page).toHaveURL(/\/runs\/run-/);
  await expect(page.getByRole('note', { name: 'Status of this run' })).toContainText('Injected fault');
  const rejected = page.getByRole('region', { name: 'Rejected by the Verifier' });
  await expect(rejected).toContainText('5.300,00 EUR', { timeout: 30_000 });
  await expect(rejected).toContainText('verified instead', { timeout: 30_000 });
  await expect(rejected).toContainText('does not show the amount 5300');
  // The same after a reload, from the snapshot.
  await page.reload();
  await expect(rejected).toContainText('does not show the amount 5300', { timeout: 30_000 });
  expect(errors).toEqual([]);
});

test('your own files: upload, check, contract details kept, KPO book, delete', async ({ page }) => {
  const errors = watchErrors(page);
  const dir = join('data', 'profiles', 'p07');
  const invoices = readdirSync(join(dir, 'invoices')).map((f) => join(dir, 'invoices', f));
  await page.goto('/check');
  // Two batches: the second adds to the first.
  await page.getByLabel('Choose files').setInputFiles(invoices);
  await expect(page.getByText('Invoice PDF', { exact: true })).toHaveCount(invoices.length);
  await page
    .getByLabel('Choose files')
    .setInputFiles([join(dir, 'statement.csv'), join(dir, 'kpo.csv'), join(dir, 'clients.json')]);
  await expect(page.getByText('Columns mapped')).toHaveCount(2);
  await expect(page.getByText('Invoice PDF', { exact: true })).toHaveCount(invoices.length);
  // The client file fills the form.
  await expect(page.getByLabel('Client name').first()).toHaveValue('Heron Systems GmbH');
  await page.getByLabel('Name or business name').fill('Proba PR');
  await page.getByLabel('PIB (9 digits)').fill('109424584');
  await page.getByLabel('Check as of').fill('2026-11-26');
  const draft = page.getByRole('region', { name: '4. The invoice you are about to send' });
  await draft.locator('select').nth(0).selectOption({ label: 'Heron Systems GmbH' });
  await draft.locator('input[inputmode="decimal"]').fill('8550');
  await draft.locator('select').nth(1).selectOption('EUR');
  await draft.locator('input[type="date"]').fill('2026-11-26');
  await page.getByRole('button', { name: 'Check this invoice' }).click();
  await expect(page).toHaveURL(/\/runs\/run-/);
  await expect(page.getByRole('note', { name: 'Status of this run' })).toContainText('YOUR FILES');
  const card = page.getByRole('region', { name: 'Headroom', exact: true });
  await expect(card.getByText(/over the limit if the payment with no invoice is invoiced/)).toBeVisible({
    timeout: 45_000,
  });
  // The contract details of the client file reached the agents: criteria were judged from them.
  await page.getByRole('textbox', { name: 'Search by key' }).fill('criterion:heron:1');
  await page.getByRole('region', { name: 'Figure Board' }).getByRole('row').nth(1).click();
  await expect(page.getByRole('dialog', { name: 'Figure sources' })).toContainText(
    'the client sets core working hours',
  );
  await page.keyboard.press('Escape');
  await expect(page.getByRole('contentinfo')).not.toContainText('Synthetic data only. Not financial', {
    useInnerText: true,
  });
  await page.getByRole('link', { name: 'KPO book' }).click();
  await expect(page.getByRole('region', { name: 'KPO book' })).toContainText('Faktura 2026-001');
  await expect(page.getByText('Do not use this as your KPO book')).toHaveCount(0);
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

test('about lists every rule with its status and sources', async ({ page }) => {
  await page.goto('/about#R-VAT-8M-BASIS');
  const rule = page.locator('#R-VAT-8M-BASIS');
  await expect(rule.getByText('Assumption')).toBeVisible();
  await expect(rule.getByRole('link').first()).toHaveAttribute('href', /^https:\/\//);
  await noEmoji(page);
});

const PAGES: Array<[string, string]> = [
  ['/', 'Every number proven'],
  ['/agents', 'Who does what'],
  ['/proof', 'times sooner'],
  ['/evidence', 'What has been measured'],
  ['/docs', 'Using Headroom'],
  ['/about', 'About Headroom'],
  ['/check', 'Check my invoice'],
];

test('every page opens from the navigation and fits a phone and a desktop', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  for (const [link, heading] of [
    ['Agents', 'Who does what'],
    ['Proof', 'times sooner'],
    ['Evidence', 'What has been measured'],
    ['Docs', 'Using Headroom'],
  ] as const) {
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: link }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(heading);
  }
  for (const width of [390, 1366]) {
    await page.setViewportSize({ width, height: 850 });
    for (const [path, heading] of PAGES) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toContainText(heading);
      const over = await page.evaluate<number>('document.documentElement.scrollWidth - window.innerWidth');
      expect([path, width, over]).toEqual([path, width, 0]);
      await noEmoji(page);
    }
  }
  expect(errors).toEqual([]);
});

test('the first question answers what Headroom does, and the long pages carry their evidence', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('#faq summary').first()).toHaveText('What does Headroom do for me?');
  await page.goto('/agents');
  for (const name of [
    'InvoiceReader',
    'StatementReader',
    'KpoReader',
    'RateClerk',
    'LimitKeeper',
    'IndependenceChecker',
    'Verifier',
  ])
    await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
  await page.goto('/proof');
  await expect(page.getByRole('region', { name: 'Concurrency pays' })).toContainText(
    'One model request at a time',
  );
  await expect(page.getByRole('region', { name: 'A wrong number, caught' })).toContainText('CONTESTED');
  await page.goto('/evidence');
  await expect(page.getByRole('region', { name: 'The sample files' }).getByRole('row')).not.toHaveCount(0);
  await expect(page.getByRole('region', { name: 'What has not been measured' })).toBeVisible();
});

test('an invoice amount typed on the home page is the one the agents answer for', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  const box = page.getByRole('form', { name: 'Try an invoice amount on the sample' });
  await box.getByRole('textbox').fill('6000');
  await box.getByRole('button', { name: 'Show my headroom' }).click();
  await expect(page).toHaveURL(/\/runs\/run-/);
  const card = page.getByRole('region', { name: 'Headroom', exact: true });
  // The card appears once the totals are verified; only then does it show the amount.
  await expect(card).toContainText('6.000,00 EUR', { timeout: 45_000 });
  // With 6,000 EUR the total stays under the limit even once the unbilled payment is invoiced.
  await expect(card.getByText(/left if the payment with no invoice is invoiced/)).toBeVisible({
    timeout: 45_000,
  });
  expect(errors).toEqual([]);
});
