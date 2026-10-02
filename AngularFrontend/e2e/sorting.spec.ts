import { test, expect, Page, Locator } from '@playwright/test';

async function setup(page: Page, role: 'User' | 'Admin', interests = [' science ']) {
  await page.addInitScript(() => sessionStorage.setItem('data4life.accessToken', 'token'));
  await page.route('**/api/users/me', route => route.fulfill({ json: { role, email: 'me@example.com', interests } }));
  await page.route('**/api/time/retrieve', route => route.fulfill({ json: { current_time: '2026-09-29T00:00:00Z' } }));
  const books = [
    { _id: 'b1', title: 'Zulu', authors: ['Amy', 'Zed'], topics: ['History'], archivedAt: null },
    { _id: 'b2', title: 'alpha', authors: ['Zoe'], topics: ['SCIENCE'], archivedAt: null },
    { _id: 'b3', title: 'Beta', authors: ['Ben'], topics: ['Art'], archivedAt: null },
  ];
  await page.route('**/api/book/retrieve', route => route.fulfill({ json: books }));
  await page.route('**/api/copy/retrieve', route => route.fulfill({ json: [{ _id: 'c' + route.request().postDataJSON()._id, status: 'available' }] }));
  await page.route('**/api/users/lookup', route => route.fulfill({ json: { email: ({ u1: 'z@example.com', u2: 'a@example.com', u3: 'm@example.com' } as Record<string, string>)[route.request().postDataJSON().user_id] } }));
  const suffix = role === 'Admin' ? 'retrieve_all' : 'retrieve';
  const days = ['2026-09-02', '2026-09-10', '2026-09-01'];
  await page.route(`**/api/loan/${suffix}`, route => route.fulfill({ json: books.flatMap((book, i) => [false, true].map(history => ({ _id: 'l' + i + history, userId: 'u' + (i + 1), copyId: 'c' + book._id, borrowedAt: days[i], dueAt: days[2 - i], returnedAt: history ? { $date: days[i] } : null }))) }));
  await page.route(`**/api/reservation/${suffix}`, route => route.fulfill({ json: books.flatMap((book, i) => [false, true].map(history => ({ _id: 'r' + i + history, userId: 'u' + (i + 1), bookId: book._id, status: history ? 'fulfilled' : i === 1 ? 'ready' : 'waiting' }))) }));
  await page.route(`**/api/fine/${suffix}`, route => route.fulfill({ json: books.flatMap((book, i) => [false, true].map(history => ({ _id: 'f' + i + history, userId: 'u' + (i + 1), loanId: book.title, amount: [1000, 50, 200][i], assessedAt: { $date: days[i] }, paidAt: history ? '2026-09-29' : null }))) }));
}

async function sorted(section: Locator, key: string, expected: string[]) {
  const label = ({ title: 'Title', authors: 'Authors', topics: 'Topics', borrowedAt: 'Borrow date', dueAt: 'Due date', returnedAt: 'Return date', amount: 'Amount', assessedAt: 'Assessed at', userEmail: 'User email' } as Record<string, string>)[key];
  await section.getByRole('button', { name: 'Sort ' + label + ' ascending', exact: true }).click();
  await expect(section.locator('tbody th')).toHaveText(expected);
  await section.getByRole('button', { name: 'Sort ' + label + ' descending', exact: true }).click();
  await expect(section.locator('tbody th')).toHaveText([...expected].reverse());
}

test('catalogue sorts arrays and filters using any matching user interest', async ({ page }) => {
  await setup(page, 'User');
  await page.goto('/books');
  const section = page.locator('app-books');
  await sorted(section, 'title', ['alpha', 'Beta', 'Zulu']);
  await sorted(section, 'authors', ['Zulu', 'Beta', 'alpha']);
  await sorted(section, 'topics', ['Beta', 'Zulu', 'alpha']);
  await page.getByRole('button', { name: 'Filter topics', exact: true }).click();
  await page.getByRole('dialog', { name: 'Filter topics', exact: true }).getByRole('button', { name: 'Filter by my interests', exact: true }).click();
  await page.getByRole('dialog', { name: 'Filter topics', exact: true }).getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(section.locator('tbody th')).toHaveText(['alpha']);
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(section.locator('tbody th')).toHaveText(['alpha']);
  await expect(page.getByRole('button', { name: 'Filter topics', exact: true })).toHaveClass(/active/);
  await page.getByRole('button', { name: 'Filter topics', exact: true }).click();
  await page.getByRole('dialog', { name: 'Filter topics', exact: true }).getByRole('button', { name: 'Select all', exact: true }).click();
  await page.getByRole('dialog', { name: 'Filter topics', exact: true }).getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(section.locator('tbody th')).toHaveCount(3);
});

test('interest filter explains missing interests and can be cleared', async ({ page }) => {
  await setup(page, 'User', []);
  await page.goto('/books');
  await page.getByRole('button', { name: 'Filter topics', exact: true }).click();
  await expect(page.getByText(/You have no interests set/)).toBeVisible();
  await page.getByRole('dialog', { name: 'Filter topics', exact: true }).getByRole('button', { name: 'Filter by my interests', exact: true }).click();
  await page.getByRole('dialog', { name: 'Filter topics', exact: true }).getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(0);
  await page.getByRole('button', { name: 'Filter topics', exact: true }).click();
  await page.getByRole('dialog', { name: 'Filter topics', exact: true }).getByRole('button', { name: 'Select all', exact: true }).click();
  await page.getByRole('dialog', { name: 'Filter topics', exact: true }).getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(3);
});

for (const role of ['User', 'Admin'] as const) {
  test(`${role} active lists support all requested sorts and reservation status filtering`, async ({ page }) => {
    await setup(page, role);
    await page.goto('/loans');
    const loans = page.locator('app-loans');
    await sorted(loans, 'title', ['alpha', 'Beta', 'Zulu']);
    await sorted(loans, 'authors', ['Zulu', 'Beta', 'alpha']);
    await sorted(loans, 'topics', ['Beta', 'Zulu', 'alpha']);
    await sorted(loans, 'borrowedAt', ['Beta', 'Zulu', 'alpha']);
    await sorted(loans, 'dueAt', ['Zulu', 'Beta', 'alpha']);
    if (role === 'Admin') await sorted(loans, 'userEmail', ['alpha', 'Beta', 'Zulu']);
    else await expect(loans.getByRole('button', { name: 'Sort User email ascending', exact: true })).toHaveCount(0);
    await page.goto('/reservations');
    const reservations = page.locator('app-reservations');
    await sorted(reservations, 'title', ['alpha', 'Beta', 'Zulu']);
    await sorted(reservations, 'authors', ['Zulu', 'Beta', 'alpha']);
    await sorted(reservations, 'topics', ['Beta', 'Zulu', 'alpha']);
    if (role === 'Admin') await sorted(reservations, 'userEmail', ['alpha', 'Beta', 'Zulu']);
    await reservations.getByRole('button', { name: 'Filter reservation status', exact: true }).click();
    await page.getByRole('dialog', { name: 'Filter reservation status', exact: true }).getByRole('button', { name: 'Clear all', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Filter reservation status', exact: true }).getByRole('checkbox', { name: 'Ready', exact: true })).not.toBeChecked();
    await page.getByRole('dialog', { name: 'Filter reservation status', exact: true }).getByRole('checkbox', { name: 'Ready', exact: true }).check();
    await page.getByRole('dialog', { name: 'Filter reservation status', exact: true }).getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(reservations.locator('tbody th')).toHaveText(['alpha']);
    await reservations.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(reservations.locator('tbody th')).toHaveText(['alpha']);
    await reservations.getByRole('button', { name: 'Filter reservation status', exact: true }).click();
    await page.getByRole('dialog', { name: 'Filter reservation status', exact: true }).getByRole('button', { name: 'Clear all', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Filter reservation status', exact: true }).getByRole('checkbox', { name: 'Waiting', exact: true })).not.toBeChecked();
    await page.getByRole('dialog', { name: 'Filter reservation status', exact: true }).getByRole('checkbox', { name: 'Waiting', exact: true }).check();
    await page.getByRole('dialog', { name: 'Filter reservation status', exact: true }).getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(reservations.locator('tbody tr')).toHaveCount(2);
    await reservations.getByRole('button', { name: 'Filter reservation status', exact: true }).click();
    await page.getByRole('dialog', { name: 'Filter reservation status', exact: true }).getByRole('button', { name: 'Select all', exact: true }).click();
    await page.getByRole('dialog', { name: 'Filter reservation status', exact: true }).getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(reservations.locator('tbody tr')).toHaveCount(3);
    await page.goto('/fines');
    const fines = page.locator('app-fines');
    await sorted(fines, 'amount', ['alpha', 'Beta', 'Zulu']);
    await sorted(fines, 'assessedAt', ['Beta', 'Zulu', 'alpha']);
    if (role === 'Admin') await sorted(fines, 'userEmail', ['alpha', 'Beta', 'Zulu']);
  });

  test(`${role} history sorts independently and uses return date`, async ({ page }) => {
    await setup(page, role);
    await page.goto('/history');
    const loans = page.locator('app-loans'), reservations = page.locator('app-reservations'), fines = page.locator('app-fines');
    await sorted(loans, 'returnedAt', ['Beta', 'Zulu', 'alpha']);
    await expect(loans.getByRole('button', { name: 'Sort Due date ascending', exact: true })).toHaveCount(0);
    await sorted(reservations, 'title', ['alpha', 'Beta', 'Zulu']);
    await sorted(fines, 'amount', ['alpha', 'Beta', 'Zulu']);
    await expect(loans.locator('tbody th')).toHaveText(['alpha', 'Zulu', 'Beta']);
    await expect(reservations.getByRole('button', { name: 'Filter reservation status', exact: true })).toBeVisible();
    if (role === 'Admin') {
      for (const section of [loans, reservations, fines]) await sorted(section, 'userEmail', ['alpha', 'Beta', 'Zulu']);
    }
  });
}


test('checkbox popups cancel drafts, combine filters and preserve header width', async ({ page }) => {
  await setup(page, 'Admin');
  await page.goto('/books');
  await page.getByRole('button', { name: 'Filter authors', exact: true }).click();
  const authors = page.getByRole('dialog', { name: 'Filter authors', exact: true });
  await expect(authors.locator('label')).toHaveText(['Amy', 'Ben', 'Zed', 'Zoe']);
  await authors.getByRole('button', { name: 'Clear all', exact: true }).click();
  await expect(authors.getByRole('checkbox', { name: 'Amy', exact: true })).not.toBeChecked();
  await authors.getByRole('checkbox', { name: 'Amy', exact: true }).check();
  await authors.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(3);
  await page.getByRole('button', { name: 'Filter authors', exact: true }).click();
  await expect(authors.getByRole('checkbox', { name: 'Zoe', exact: true })).toBeChecked();
  await authors.getByRole('button', { name: 'Clear all', exact: true }).click();
  await expect(authors.getByRole('checkbox', { name: 'Amy', exact: true })).not.toBeChecked();
  await authors.getByRole('checkbox', { name: 'Amy', exact: true }).check();
  await authors.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.locator('tbody th')).toHaveText(['Zulu']);
  await page.getByRole('button', { name: 'Filter topics', exact: true }).click();
  const topics = page.getByRole('dialog', { name: 'Filter topics', exact: true });
  await expect(topics.locator('label')).toHaveText(['Art', 'History', 'SCIENCE']);
  await topics.getByRole('button', { name: 'Filter by my interests', exact: true }).click();
  await topics.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(0);
  await page.goto('/reservations');
  const header = page.getByRole('columnheader').filter({ has: page.getByRole('button', { name: 'Filter reservation status', exact: true }) });
  const before = await header.boundingBox();
  await page.getByRole('button', { name: 'Filter reservation status', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Filter reservation status', exact: true });
  await expect(dialog.getByRole('checkbox')).toHaveCount(2);
  expect((await header.boundingBox())?.width).toBe(before?.width);
  await dialog.getByRole('checkbox', { name: 'Waiting', exact: true }).uncheck();
  await dialog.press('Escape');
  await expect(page.locator('tbody tr')).toHaveCount(3);
});
